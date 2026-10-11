/**
 * Gate orchestration: camera detection → entry ticket / exit decision →
 * barrier command. Kiosks subscribe to `gate:<id>` and render whatever state
 * the server pushes; they never decide on their own whether to open.
 */
import { provinceByCode, type IdentificationResult } from '@pp/shared';
import { q, json, nowIso, type Row } from '../db/index.ts';
import { HttpError, notFound } from '../lib/http.ts';
import { emit } from '../lib/realtime.ts';
import { raiseAlert } from '../lib/alerts.ts';
import { getSetting } from '../lib/settings.ts';
import { recordDetection, detectionView, type DetectionInput } from './detections.ts';
import {
  createSession,
  closeSession,
  customerUrl,
  findActiveByKey,
  findActiveLoose,
  getSession,
  quote,
  sessionByToken,
  sessionSummary,
  fmtMinutes,
  type PlateInput,
} from './sessions.ts';
import { rateForVersion } from './rates.ts';
import { openBarrier } from './barrier.ts';
import { plateStatus } from './plates.ts';

export type GateState =
  | { kind: 'IDLE'; at: string }
  | { kind: 'ENTRY_CONFIRM'; at: string; detection: ReturnType<typeof detectionView>; decision: string; allowUnplated: boolean }
  | { kind: 'ENTRY_REVIEW'; at: string; detection: ReturnType<typeof detectionView> | null; allowUnplated: boolean; message: string }
  | { kind: 'TICKET_ISSUED'; at: string; session: ReturnType<typeof sessionSummary>; ticket: TicketPayload | null; ticketless: boolean }
  | { kind: 'ENTRY_DENIED'; at: string; reason: string; message: string }
  | { kind: 'EXIT_OPEN'; at: string; session: ReturnType<typeof sessionSummary>; message: string }
  | { kind: 'EXIT_PAYMENT'; at: string; session: ReturnType<typeof sessionSummary>; quote: ReturnType<typeof quote>; overstay: boolean }
  | { kind: 'EXIT_NOT_FOUND'; at: string; detection: ReturnType<typeof detectionView> | null; message: string }
  | { kind: 'EXIT_MISMATCH'; at: string; session: ReturnType<typeof sessionSummary>; detection: ReturnType<typeof detectionView> | null; message: string };

const states = new Map<number, GateState>();

export function gateState(gateId: number): GateState {
  return states.get(gateId) ?? { kind: 'IDLE', at: nowIso() };
}

function setState(gateId: number, s: GateState) {
  states.set(gateId, s);
  emit.gate(gateId, 'gate:state', s);
  emit.staff('gate:state', { gateId, state: s });
}

export function resetGate(gateId: number) {
  setState(gateId, { kind: 'IDLE', at: nowIso() });
}

export function getGate(gateId: number): Row {
  const g = q.get('SELECT * FROM gates WHERE id=? AND active=1', gateId);
  if (!g) throw notFound('GATE_NOT_FOUND');
  return g;
}

function gateSettings(g: Row) {
  const op = getSetting('operation');
  const s = json<{ autoIssueTicket?: boolean; allowTicketWithoutPlate?: boolean }>(g.settings_json, {});
  return {
    autoIssueTicket: s.autoIssueTicket ?? op.autoIssueTicket,
    allowTicketWithoutPlate: s.allowTicketWithoutPlate ?? op.allowTicketWithoutPlate,
  };
}

export interface TicketPayload {
  paperWidth: '58' | '80';
  title: string;
  subtitle: string;
  logoUrl: string;
  plate: string | null;
  province: string | null;
  parkingNo: string;
  entryAt: string;
  freeTime: string | null;
  rateText: string | null;
  qrUrl: string;
  qrCount: number;
  qrSize: number;
  footerText: string;
  extraLines: string[];
  fontScale: number;
}

export function ticketPayload(session: Row, token: string): TicketPayload {
  const t = getSetting('ticket');
  const cfg = rateForVersion(session.rate_version_id);
  return {
    paperWidth: t.paperWidth,
    title: t.title,
    subtitle: t.subtitle,
    logoUrl: t.logoUrl,
    plate: session.plate_text,
    province: t.showProvince ? (provinceByCode(session.province)?.th ?? null) : null,
    parkingNo: session.parking_no,
    entryAt: session.entry_at,
    freeTime: t.showFreeTime ? fmtMinutes(cfg.freeMinutes) : null,
    rateText: t.showRate ? `${cfg.hourlyRate} บาท/ชั่วโมง` : null,
    qrUrl: customerUrl(token),
    qrCount: t.qrCount,
    qrSize: t.qrSize,
    footerText: t.footerText,
    extraLines: t.extraLines,
    fontScale: t.fontScale,
  };
}

function plateFromDetection(d: Row): PlateInput | null {
  if (!d.plate_prefix || !d.plate_number) return null;
  return {
    prefix: d.plate_prefix,
    number: d.plate_number,
    provinceCode: d.province,
    key: d.plate_key,
    text: `${d.plate_prefix} ${d.plate_number}`,
    source: d.source_type ?? 'REAL_PLATE',
  };
}

// --------------------------------------------------------------- ENTRY -----

export async function onEntryDetection(input: DetectionInput) {
  const gate = getGate(input.gateId);
  if (gate.direction !== 'ENTRY') throw new HttpError(400, 'NOT_ENTRY_GATE');
  const { detection, result } = recordDetection(input);
  const view = detectionView(detection);
  const gs = gateSettings(gate);

  if (result.decision === 'NO_READ' || result.decision === 'MANUAL_REVIEW') {
    setState(gate.id, {
      kind: 'ENTRY_REVIEW',
      at: nowIso(),
      detection: view,
      allowUnplated: gs.allowTicketWithoutPlate,
      message: result.decision === 'NO_READ' ? 'ไม่สามารถอ่านป้ายทะเบียนได้' : 'กรุณารอเจ้าหน้าที่ตรวจสอบ',
    });
    return { detection: view, result, state: gateState(gate.id) };
  }
  const plate = plateFromDetection(detection);
  if (plate && plateStatus(plate.key, gate.site_id).blacklisted) {
    try {
      createSession({ siteId: gate.site_id, gateId: gate.id, plate, detectionId: detection.id });
    } catch {
      /* raises the BLACKLIST alert */
    }
    setState(gate.id, { kind: 'ENTRY_DENIED', at: nowIso(), reason: 'BLACKLISTED', message: getSetting('branding').messages.callStaff });
    return { detection: view, result, state: gateState(gate.id) };
  }
  // Pass holders / whitelisted / AUTO with auto-issue → create the session immediately.
  const isTicketless = !!(plate && (q.get("SELECT 1 FROM passes WHERE plate_key=? AND active=1 AND ticketless=1 AND valid_from<=? AND valid_to>=?", plate.key, nowIso(), nowIso()) || q.get("SELECT 1 FROM plate_lists WHERE plate_key=? AND list_type='WHITELIST' AND active=1", plate.key)));
  if (result.decision === 'AUTO_CONFIRM' && (gs.autoIssueTicket || isTicketless)) {
    await issueEntry(gate.id, { detectionId: detection.id });
  } else {
    setState(gate.id, { kind: 'ENTRY_CONFIRM', at: nowIso(), detection: view, decision: result.decision, allowUnplated: gs.allowTicketWithoutPlate });
  }
  return { detection: view, result, state: gateState(gate.id) };
}

/**
 * Create the session and print/issue the ticket. Called automatically
 * (auto-issue) or when the customer presses "รับบัตร" on the kiosk, or by staff.
 */
export async function issueEntry(
  gateId: number,
  opts: { detectionId?: number | null; plate?: PlateInput | null; vehicleType?: string; userId?: number | null; unplated?: boolean; force?: boolean; idempotencyKey?: string | null },
) {
  const gate = getGate(gateId);
  const det = opts.detectionId ? q.get('SELECT * FROM detections WHERE id=?', opts.detectionId) : null;
  if (opts.detectionId && !det) throw notFound('DETECTION_NOT_FOUND');
  if (det?.session_id) throw new HttpError(409, 'ALREADY_ISSUED');
  let plate = opts.plate ?? (det ? plateFromDetection(det) : null);
  if (!plate && !opts.unplated) throw new HttpError(400, 'PLATE_REQUIRED');
  if (opts.unplated) {
    if (!gateSettings(gate).allowTicketWithoutPlate && !opts.userId) throw new HttpError(403, 'UNPLATED_TICKET_NOT_ALLOWED');
    plate = null;
  }
  // A booked reservation for this plate (±30 min window) checks in automatically and bypasses "lot full".
  const reservation = plate?.key
    ? q.get("SELECT id FROM reservations WHERE plate_key=? AND status='BOOKED' AND start_at<=? AND end_at>=? ORDER BY start_at LIMIT 1", plate.key, new Date(Date.now() + 30 * 60_000).toISOString(), nowIso())
    : undefined;
  let res;
  try {
    res = createSession({
      reservationId: reservation?.id ?? null,
      siteId: gate.site_id,
      zoneId: gate.zone_id,
      gateId: gate.id,
      plate,
      vehicleType: opts.vehicleType ?? det?.vehicle_type ?? 'CAR',
      detectionId: det?.id ?? null,
      createdBy: opts.userId ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
      force: opts.force,
    });
  } catch (e) {
    if (e instanceof HttpError && ['BLACKLISTED', 'LOT_FULL', 'ACTIVE_SESSION_EXISTS'].includes(e.code)) {
      const msg = getSetting('branding').messages;
      setState(gate.id, {
        kind: 'ENTRY_DENIED',
        at: nowIso(),
        reason: e.code,
        message: e.code === 'LOT_FULL' ? msg.lotFull : msg.callStaff,
      });
    }
    throw e;
  }
  const { session, token, ticketless } = res;
  const ticket = !ticketless && token ? ticketPayload(session, token) : null;
  setState(gate.id, { kind: 'TICKET_ISSUED', at: nowIso(), session: sessionSummary(session), ticket, ticketless });
  // Ticketless vehicles go straight through; ticketed ones open after the ticket is taken (kiosk calls ticketTaken).
  if (ticketless || gateSettings(gate).autoIssueTicket) {
    await openBarrier(gate.id, { reason: ticketless ? 'TICKETLESS_ENTRY' : 'ENTRY', sessionId: session.id });
  }
  return { session, token, ticket, ticketless, warnings: res.warnings };
}

// ---------------------------------------------------------------- EXIT -----

export async function onExitDetection(input: DetectionInput) {
  const gate = getGate(input.gateId);
  if (gate.direction !== 'EXIT') throw new HttpError(400, 'NOT_EXIT_GATE');
  const { detection, result } = recordDetection(input);
  const view = detectionView(detection);
  const op = getSetting('operation');
  if (!result.selected) {
    setState(gate.id, { kind: 'EXIT_NOT_FOUND', at: nowIso(), detection: view, message: 'อ่านทะเบียนไม่สำเร็จ กรุณาสแกนบัตรจอดรถหรือเรียกเจ้าหน้าที่' });
    return { detection: view, state: gateState(gate.id) };
  }
  let session = detection.plate_key ? findActiveByKey(detection.plate_key) : undefined;
  let mismatch = false;
  if (!session && detection.plate_prefix) {
    const loose = findActiveLoose(detection.plate_prefix, detection.plate_number);
    if (loose.length === 1) {
      session = loose[0];
      // same letters+number but province differs or unknown on one side
      mismatch = !!(detection.province && session.province && detection.province !== session.province) || op.exitRequireProvinceMatch;
    } else if (loose.length > 1) {
      setState(gate.id, { kind: 'EXIT_NOT_FOUND', at: nowIso(), detection: view, message: 'พบทะเบียนซ้ำหลายรายการ กรุณาสแกนบัตรจอดรถ' });
      return { detection: view, state: gateState(gate.id) };
    }
  }
  if (!session) {
    setState(gate.id, { kind: 'EXIT_NOT_FOUND', at: nowIso(), detection: view, message: 'ไม่พบรายการจอด กรุณาสแกนบัตรจอดรถหรือเรียกเจ้าหน้าที่' });
    return { detection: view, state: gateState(gate.id) };
  }
  if (mismatch) return flagMismatch(gate, session, detection);
  return decideExit(gate.id, session.id, detection.id);
}

function flagMismatch(gate: Row, session: Row, detection: Row | null) {
  q.run('UPDATE parking_sessions SET flags=? WHERE id=?', JSON.stringify([...new Set([...json<string[]>(session.flags, []), 'PLATE_MISMATCH'])]), session.id);
  raiseAlert({
    type: 'PLATE_MISMATCH',
    severity: 'CRITICAL',
    siteId: gate.site_id,
    refType: 'session',
    refId: session.id,
    message: `ทะเบียนไม่ตรงที่ทางออก ${gate.name}: เข้า ${session.plate_text ?? '-'} / ออก ${detection?.plate_prefix ?? '-'} ${detection?.plate_number ?? ''}`,
    data: { gateId: gate.id, sessionId: session.id, detectionId: detection?.id },
    dedupeKey: `PLATE_MISMATCH:${session.id}`,
  });
  setState(gate.id, {
    kind: 'EXIT_MISMATCH',
    at: nowIso(),
    session: sessionSummary(session),
    detection: detection ? detectionView(detection) : null,
    message: 'ทะเบียนไม่ตรงกับบัตร กรุณารอเจ้าหน้าที่ตรวจสอบ',
  });
  return { state: gateState(gate.id) };
}

export async function decideExit(gateId: number, sessionId: number, detectionId?: number | null) {
  const gate = getGate(gateId);
  const s = getSession(sessionId);
  if (s.status !== 'ACTIVE') {
    setState(gate.id, { kind: 'EXIT_NOT_FOUND', at: nowIso(), detection: null, message: 'บัตรนี้ถูกใช้ออกไปแล้ว' });
    return { state: gateState(gate.id) };
  }
  const qt = quote(s);
  if (qt.canExit) {
    const closed = closeSession(s.id, { exitGateId: gate.id, detectionId: detectionId ?? null });
    await openBarrier(gate.id, { reason: 'EXIT_PAID', sessionId: s.id });
    setState(gate.id, { kind: 'EXIT_OPEN', at: nowIso(), session: sessionSummary(closed), message: getSetting('branding').messages.exitThanks });
  } else {
    if (detectionId) q.run('UPDATE parking_sessions SET exit_detection_id=? WHERE id=?', detectionId, s.id);
    const overstay = !!(s.last_paid_at && !qt.withinGrace);
    setState(gate.id, { kind: 'EXIT_PAYMENT', at: nowIso(), session: sessionSummary(s), quote: qt, overstay });
  }
  return { state: gateState(gate.id), quote: qt };
}

/** Customer scans the ticket QR at the exit kiosk (plate unreadable / not found). */
export async function exitByTicket(gateId: number, token: string) {
  const gate = getGate(gateId);
  const s = sessionByToken(token);
  if (!s) {
    setState(gate.id, { kind: 'EXIT_NOT_FOUND', at: nowIso(), detection: null, message: 'บัตรไม่ถูกต้องหรือถูกใช้แล้ว กรุณาเรียกเจ้าหน้าที่' });
    return { state: gateState(gate.id) };
  }
  // Compare with the latest exit-camera read at this gate.
  const last = q.get("SELECT * FROM detections WHERE gate_id=? AND captured_at>=? ORDER BY id DESC LIMIT 1", gate.id, new Date(Date.now() - 2 * 60_000).toISOString());
  if (last?.plate_key && s.plate_key && last.plate_prefix && (last.plate_prefix !== s.plate_prefix || last.plate_number !== s.plate_number)) {
    return flagMismatch(gate, s, last);
  }
  return decideExit(gate.id, s.id, last?.id ?? null);
}

/** Called by the entry kiosk once the printed ticket was taken. */
export async function ticketTaken(gateId: number, sessionId: number) {
  const st = gateState(gateId);
  if (st.kind !== 'TICKET_ISSUED' || st.session.id !== sessionId) throw new HttpError(409, 'NO_TICKET_PENDING');
  await openBarrier(gateId, { reason: 'ENTRY', sessionId });
  return { ok: true };
}

export function gateOverview() {
  return q.all('SELECT g.*, s.name site_name FROM gates g JOIN sites s ON s.id=g.site_id WHERE g.active=1 ORDER BY g.site_id, g.id').map((g) => ({
    id: g.id,
    name: g.name,
    siteId: g.site_id,
    siteName: g.site_name,
    zoneId: g.zone_id,
    direction: g.direction,
    settings: json(g.settings_json, {}),
    state: gateState(g.id),
    devices: q.all('SELECT id, type, name, status, last_seen_at FROM devices WHERE gate_id=? AND active=1', g.id),
  }));
}

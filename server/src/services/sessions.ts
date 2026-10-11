/**
 * Parking sessions: entry, quoting (server-side fee calculation), exit.
 * The quote is the single source of truth for every screen — customer web,
 * counters, kiosks, exit gate, dashboard — so they always agree.
 */
import { calculateFee, nextFeeChangeAt, provinceByCode, type FeeLine } from '@pp/shared';
import { q, json, tx, nowIso, type Row } from '../db/index.ts';
import { config } from '../config.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import { nextSequence, ymd } from '../lib/sequence.ts';
import { conflict, forbidden, HttpError, notFound, r2 } from '../lib/http.ts';
import { emit } from '../lib/realtime.ts';
import { raiseAlert } from '../lib/alerts.ts';
import { getSetting } from '../lib/settings.ts';
import { holidayDates, rateForVersion, resolveRate } from './rates.ts';
import { plateStatus } from './plates.ts';

export interface PlateInput {
  prefix: string;
  number: string;
  provinceCode: string | null;
  key: string;
  text: string;
  source: string;
}

export interface CreateSessionInput {
  siteId: number;
  zoneId?: number | null;
  gateId?: number | null;
  plate: PlateInput | null;
  vehicleType?: string;
  entryAt?: string;
  detectionId?: number | null;
  createdBy?: number | null;
  idempotencyKey?: string | null;
  /** Token generated offline by an edge device (already printed on the ticket). */
  presetToken?: string | null;
  presetParkingNo?: string | null;
  offline?: boolean;
  reservationId?: number | null;
  force?: boolean; // staff override (e.g. allow despite duplicate)
}

export interface EntryResult {
  session: Row;
  token: string | null;
  ticketless: boolean;
  allowed: boolean;
  denyReason?: string;
  warnings: string[];
}

export function sitePublic(siteId: number) {
  return q.get('SELECT id, code, name, tz_offset, capacity FROM sites WHERE id=?', siteId);
}

export function occupancy(siteId: number) {
  const site = q.get('SELECT capacity FROM sites WHERE id=?', siteId);
  const used = q.get<{ n: number }>("SELECT COUNT(*) n FROM parking_sessions WHERE site_id=? AND status='ACTIVE'", siteId)!.n;
  const capacity = site?.capacity ?? 0;
  return { used, capacity, available: capacity ? Math.max(0, capacity - used) : null, full: capacity > 0 && used >= capacity };
}

function generateParkingNo(siteId: number, at: Date): string {
  const site = q.get('SELECT tz_offset FROM sites WHERE id=?', siteId);
  const day = ymd(at, site?.tz_offset ?? 420);
  const n = nextSequence('parking_no', day);
  return `PK${day}${String(n).padStart(4, '0')}`;
}

export function findActiveByKey(plateKey: string) {
  return q.get("SELECT * FROM parking_sessions WHERE status='ACTIVE' AND plate_key=? ORDER BY entry_at DESC LIMIT 1", plateKey);
}

/** Active sessions with same prefix+number regardless of province. */
export function findActiveLoose(prefix: string, number: string) {
  return q.all("SELECT * FROM parking_sessions WHERE status='ACTIVE' AND plate_prefix=? AND plate_number=? ORDER BY entry_at DESC", prefix, number);
}

export function sessionByToken(token: string) {
  if (!token || token.length < 16) return undefined;
  return q.get('SELECT * FROM parking_sessions WHERE token_hash=?', sha256(token));
}

export function getSession(id: number) {
  const s = q.get('SELECT * FROM parking_sessions WHERE id=?', id);
  if (!s) throw notFound('SESSION_NOT_FOUND');
  return s;
}

export function createSession(input: CreateSessionInput): EntryResult {
  if (input.idempotencyKey) {
    const existing = q.get('SELECT * FROM parking_sessions WHERE idempotency_key=?', input.idempotencyKey);
    if (existing) return { session: existing, token: null, ticketless: !!existing.ticketless, allowed: true, warnings: ['DUPLICATE_REQUEST'] };
  }
  const op = getSetting('operation');
  const warnings: string[] = [];
  const at = input.entryAt ?? nowIso();
  const plate = input.plate;
  const status = plateStatus(plate?.key ?? null, input.siteId, at);

  if (status.blacklisted && !input.force) {
    raiseAlert({
      type: 'BLACKLIST',
      severity: 'CRITICAL',
      siteId: input.siteId,
      message: `รถในบัญชีดำพยายามเข้า: ${plate?.text ?? ''} ${provinceByCode(plate?.provinceCode)?.th ?? ''} (${status.blacklistReason ?? ''})`,
      refType: 'gate',
      refId: input.gateId ?? undefined,
      data: { plate, detectionId: input.detectionId },
    });
    throw new HttpError(403, 'BLACKLISTED', status.blacklistReason ?? 'vehicle is blacklisted');
  }

  const passHolder = !!status.pass;
  const occ = occupancy(input.siteId);
  if (occ.full && !passHolder && !status.whitelisted && !input.reservationId && !input.force) {
    raiseAlert({ type: 'LOT_FULL', siteId: input.siteId, message: 'ลานจอดเต็ม', dedupeKey: `LOT_FULL:${input.siteId}` });
    throw new HttpError(409, 'LOT_FULL');
  }

  return tx(() => {
    if (plate?.key && !plate.key.endsWith('|?')) {
      const dup = findActiveByKey(plate.key);
      if (dup) {
        if (op.duplicateEntryPolicy === 'DENY' && !input.force) throw conflict('ACTIVE_SESSION_EXISTS', 'vehicle already has an open session', { parkingNo: dup.parking_no });
        if (op.duplicateEntryPolicy === 'CLOSE_PREVIOUS') {
          q.run("UPDATE parking_sessions SET status='CANCELLED', token_hash=NULL, flags=?, updated_at=? WHERE id=?", JSON.stringify([...json<string[]>(dup.flags, []), 'AUTO_CLOSED_DUPLICATE']), nowIso(), dup.id);
          warnings.push('PREVIOUS_SESSION_CLOSED');
        } else {
          q.run('UPDATE parking_sessions SET flags=?, updated_at=? WHERE id=?', JSON.stringify([...json<string[]>(dup.flags, []), 'DUPLICATE_ENTRY']), nowIso(), dup.id);
          warnings.push('DUPLICATE_ACTIVE_SESSION');
        }
      }
    }
    const vehicleType = input.vehicleType ?? 'CAR';
    const rate = resolveRate(input.siteId, input.zoneId ?? null, vehicleType, at, status.specialRatePlanId);
    const token = input.presetToken ?? randomToken(24);
    const parkingNo = input.presetParkingNo ?? generateParkingNo(input.siteId, new Date(at));
    const ticketless = passHolder ? !!status.pass.ticketless : status.whitelisted;
    const exempt = status.exempt || (passHolder && !!status.pass.free_parking);
    const id = q.insert('parking_sessions', {
      parking_no: parkingNo,
      site_id: input.siteId,
      zone_id: input.zoneId ?? null,
      entry_gate_id: input.gateId ?? null,
      plate_prefix: plate?.prefix ?? null,
      plate_number: plate?.number ?? null,
      province: plate?.provinceCode ?? null,
      plate_text: plate?.text ?? null,
      plate_key: plate?.key ?? null,
      plate_source: plate?.source ?? null,
      vehicle_type: vehicleType,
      entry_at: at,
      token_hash: sha256(token),
      rate_plan_id: rate.planId,
      rate_version_id: rate.versionId,
      member_id: status.member?.id ?? null,
      pass_id: status.pass?.id ?? null,
      reservation_id: input.reservationId ?? null,
      ticketless: ticketless ? 1 : 0,
      unread_plate: plate ? 0 : 1,
      exempt: exempt ? 1 : 0,
      payment_status: exempt ? 'FREE' : 'UNPAID',
      entry_detection_id: input.detectionId ?? null,
      offline_origin: input.offline ? 1 : 0,
      idempotency_key: input.idempotencyKey ?? null,
      created_by: input.createdBy ?? null,
      flags: JSON.stringify(warnings.includes('DUPLICATE_ACTIVE_SESSION') ? ['DUPLICATE_ENTRY'] : []),
    });
    if (input.detectionId) q.run('UPDATE detections SET session_id=? WHERE id=?', id, input.detectionId);
    if (input.reservationId) q.run("UPDATE reservations SET status='CHECKED_IN', session_id=? WHERE id=?", id, input.reservationId);
    const session = getSession(id);
    broadcastSession(session);
    const o = occupancy(input.siteId);
    emit.staff('occupancy', { siteId: input.siteId, ...o });
    return { session, token, ticketless, allowed: true, warnings };
  });
}

/** Rotate the QR token (reprint / lost ticket). The old QR stops working. */
export function rotateToken(sessionId: number): string {
  const token = randomToken(24);
  q.run('UPDATE parking_sessions SET token_hash=?, token_version=token_version+1, updated_at=? WHERE id=?', sha256(token), nowIso(), sessionId);
  return token;
}

export interface QuoteDiscount {
  id: number;
  type: string;
  label: string;
  amount: number;
  freeMinutes: number;
  full: boolean;
  status: string;
  createdAt: string;
  totalSpend: number | null;
}

export interface Quote {
  sessionId: number;
  parkingNo: string;
  status: string;
  paymentStatus: string;
  plate: { prefix: string | null; number: string | null; text: string | null; provinceCode: string | null; province: string | null; source: string | null };
  vehicleType: string;
  entryAt: string;
  exitAt: string | null;
  now: string;
  chargedUntil: string;
  durationSeconds: number;
  rate: { planName: string; freeMinutes: number; hourlyRate: number; billingUnitMinutes: number; graceAfterPaymentMinutes: number };
  gross: number;              // fee with base free time only
  feeLines: FeeLine[];
  extraFreeMinutes: number;
  discountFromFreeTime: number;
  discountAmount: number;     // amount-type discounts actually applied
  memberDiscount: number;
  discountTotal: number;      // gross - net
  net: number;                // fee after all discounts
  paid: number;
  due: number;
  exempt: boolean;
  fullWaiver: boolean;
  discounts: QuoteDiscount[];
  lastPaidAt: string | null;
  exitDeadlineAt: string | null;
  withinGrace: boolean;
  nextChangeAt: string | null;
  canExit: boolean;
}

export function quote(sessionOrId: Row | number, at: Date = new Date()): Quote {
  const s = typeof sessionOrId === 'number' ? getSession(sessionOrId) : sessionOrId;
  const site = q.get('SELECT tz_offset FROM sites WHERE id=?', s.site_id);
  const tz = site?.tz_offset ?? 420;
  const cfg = rateForVersion(s.rate_version_id);
  const vset = getSetting('validation');
  const op = getSetting('operation');
  const endIso = s.exit_at ?? at.toISOString();
  const deadline = s.exit_deadline_at as string | null;
  const withinGrace = !!(s.last_paid_at && deadline && endIso <= deadline);
  // Billing clock stops at payment time while inside the grace window.
  const chargedUntil = withinGrace ? s.last_paid_at : endIso;

  const discountsRows = q.all("SELECT * FROM parking_discounts WHERE session_id=? AND status IN ('ACTIVE','PENDING_REVIEW') ORDER BY id", s.id);
  const discounts: QuoteDiscount[] = discountsRows.map((d) => ({
    id: d.id,
    type: d.type,
    label: discountLabel(d),
    amount: d.amount,
    freeMinutes: d.free_minutes,
    full: !!d.full_waiver,
    status: d.status,
    createdAt: d.created_at,
    totalSpend: d.total_spend,
  }));
  const active = discountsRows.filter((d) => d.status === 'ACTIVE');
  let extraFree = active.reduce((a, d) => a + (d.free_minutes || 0), 0);
  let amountOff = active.reduce((a, d) => a + (d.amount || 0), 0);
  const fullWaiver = active.some((d) => d.full_waiver);

  // member tier benefits
  let memberPercent = 0;
  if (op.memberBenefitsEnabled && s.member_id) {
    const m = q.get('SELECT t.benefits_json FROM members m JOIN member_tiers t ON t.code=m.tier WHERE m.id=?', s.member_id);
    const b = json<{ extraFreeMinutes?: number; discountPercent?: number }>(m?.benefits_json, {});
    extraFree += b.extraFreeMinutes ?? 0;
    memberPercent = b.discountPercent ?? 0;
  }
  if (vset.maxFreeMinutesPerSession > 0) extraFree = Math.min(extraFree, vset.maxFreeMinutesPerSession);
  if (vset.maxDiscountAmountPerSession > 0) amountOff = Math.min(amountOff, vset.maxDiscountAmountPerSession);

  const holidays = holidayDates(s.site_id);
  const feeInput = { entryAt: new Date(s.entry_at), endAt: new Date(chargedUntil), config: cfg, holidays, tzOffsetMinutes: tz, lostTicket: !!s.lost_ticket };
  const base = calculateFee(feeInput);
  const withFree = extraFree > 0 ? calculateFee({ ...feeInput, extraFreeMinutes: extraFree }) : base;
  const gross = base.amount;
  let net = withFree.amount;
  const discountFromFreeTime = r2(gross - net);
  const memberDiscount = memberPercent > 0 ? r2((net * memberPercent) / 100) : 0;
  net = Math.max(0, r2(net - memberDiscount));
  const appliedAmount = Math.min(net, r2(amountOff));
  net = r2(net - appliedAmount);
  const exempt = !!s.exempt;
  if (fullWaiver || exempt) net = 0;

  const paidRow = q.get<{ paid: number }>("SELECT COALESCE(SUM(amount - refunded_amount),0) paid FROM payments WHERE session_id=? AND status IN ('PAID','PARTIALLY_REFUNDED')", s.id)!;
  const paid = r2(paidRow.paid);
  const due = Math.max(0, r2(net - paid));
  let nextChange: number | null = null;
  if (s.status === 'ACTIVE' && !exempt && !fullWaiver && !withinGrace) {
    nextChange = nextFeeChangeAt({ ...feeInput, extraFreeMinutes: extraFree }, 48 * 60);
  } else if (withinGrace && deadline) {
    nextChange = new Date(deadline).getTime();
  }
  const prov = provinceByCode(s.province);
  return {
    sessionId: s.id,
    parkingNo: s.parking_no,
    status: s.status,
    paymentStatus: s.payment_status,
    plate: { prefix: s.plate_prefix, number: s.plate_number, text: s.plate_text, provinceCode: s.province, province: prov?.th ?? null, source: s.plate_source },
    vehicleType: s.vehicle_type,
    entryAt: s.entry_at,
    exitAt: s.exit_at,
    now: at.toISOString(),
    chargedUntil,
    durationSeconds: Math.max(0, Math.floor((new Date(endIso).getTime() - new Date(s.entry_at).getTime()) / 1000)),
    rate: {
      planName: q.get('SELECT name FROM rate_plans WHERE id=?', s.rate_plan_id)?.name ?? 'Default',
      freeMinutes: cfg.freeMinutes,
      hourlyRate: cfg.hourlyRate,
      billingUnitMinutes: cfg.billingUnitMinutes,
      graceAfterPaymentMinutes: cfg.graceAfterPaymentMinutes ?? 15,
    },
    gross,
    feeLines: base.lines,
    extraFreeMinutes: extraFree,
    discountFromFreeTime,
    discountAmount: appliedAmount,
    memberDiscount,
    discountTotal: r2(gross - net),
    net,
    paid,
    due,
    exempt,
    fullWaiver,
    discounts,
    lastPaidAt: s.last_paid_at,
    exitDeadlineAt: deadline,
    withinGrace,
    nextChangeAt: nextChange ? new Date(nextChange).toISOString() : null,
    canExit: s.status === 'ACTIVE' && due <= 0,
  };
}

function discountLabel(d: Row): string {
  const base: Record<string, string> = {
    RECEIPT_VALIDATION: 'ส่วนลดจากใบเสร็จ',
    MANUAL_STAMP: 'แสตมป์',
    MANUAL_DISCOUNT: 'ส่วนลดโดยเจ้าหน้าที่',
    MEMBER: 'สิทธิ์สมาชิก',
    PROMOTION: 'โปรโมชั่น',
    WAIVER: 'ยกเว้นค่าจอด',
  };
  const parts = [base[d.type] ?? d.type];
  if (d.full_waiver) parts.push('(ฟรีทั้งหมด)');
  else if (d.free_minutes) parts.push(`(+${fmtMinutes(d.free_minutes)})`);
  return parts.join(' ');
}

export function fmtMinutes(m: number) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h && mm ? `${h} ชม. ${mm} นาที` : h ? `${h} ชม.` : `${mm} นาที`;
}

/** Recompute payment_status after payments/discounts change, and push updates. */
export function refreshPaymentStatus(sessionId: number) {
  const s = getSession(sessionId);
  if (s.status !== 'ACTIVE') return quote(s);
  const qt = quote(s);
  let status = s.payment_status;
  if (qt.exempt || qt.fullWaiver) status = qt.fullWaiver ? 'WAIVED' : 'FREE';
  else if (qt.due <= 0 && qt.paid > 0) status = 'PAID';
  else if (qt.due <= 0 && qt.net === 0) status = s.payment_status === 'PAID' ? 'PAID' : 'UNPAID';
  else status = 'UNPAID';
  if (status !== s.payment_status) q.run('UPDATE parking_sessions SET payment_status=?, updated_at=? WHERE id=?', status, nowIso(), s.id);
  const fresh = getSession(sessionId);
  broadcastSession(fresh);
  return quote(fresh);
}

export function sessionSummary(s: Row) {
  return {
    id: s.id,
    parkingNo: s.parking_no,
    siteId: s.site_id,
    zoneId: s.zone_id,
    plateText: s.plate_text,
    province: provinceByCode(s.province)?.th ?? null,
    provinceCode: s.province,
    plateKey: s.plate_key,
    plateSource: s.plate_source,
    vehicleType: s.vehicle_type,
    entryAt: s.entry_at,
    exitAt: s.exit_at,
    status: s.status,
    paymentStatus: s.payment_status,
    ticketless: !!s.ticketless,
    unreadPlate: !!s.unread_plate,
    lostTicket: !!s.lost_ticket,
    exempt: !!s.exempt,
    memberId: s.member_id,
    passId: s.pass_id,
    flags: json<string[]>(s.flags, []),
    entryGateId: s.entry_gate_id,
    exitGateId: s.exit_gate_id,
    lastPaidAt: s.last_paid_at,
    exitDeadlineAt: s.exit_deadline_at,
  };
}

/** Push the latest quote to the customer page and staff screens. */
export function broadcastSession(s: Row) {
  const qt = quote(s);
  emit.session(s.id, 'session:update', qt);
  emit.staff('session:update', { ...sessionSummary(s), due: qt.due, net: qt.net });
  emit.site(s.site_id, 'session:update', { ...sessionSummary(s), due: qt.due });
}

export function closeSession(sessionId: number, opts: { exitGateId?: number | null; detectionId?: number | null; exitAt?: string; reason?: string }) {
  return tx(() => {
    const s = getSession(sessionId);
    if (s.status !== 'ACTIVE') throw conflict('SESSION_NOT_ACTIVE');
    const exitAt = opts.exitAt ?? nowIso();
    // QR access token is revoked on exit: the ticket cannot be reused.
    q.run(
      "UPDATE parking_sessions SET status='EXITED', exit_at=?, exit_gate_id=?, exit_detection_id=?, token_hash=NULL, updated_at=? WHERE id=?",
      exitAt,
      opts.exitGateId ?? null,
      opts.detectionId ?? null,
      nowIso(),
      sessionId,
    );
    if (s.reservation_id) q.run("UPDATE reservations SET status='COMPLETED' WHERE id=?", s.reservation_id);
    const closed = getSession(sessionId);
    emit.session(sessionId, 'session:closed', { sessionId, exitAt });
    emit.staff('session:update', sessionSummary(closed));
    emit.staff('occupancy', { siteId: s.site_id, ...occupancy(s.site_id) });
    return closed;
  });
}

export function assertActive(s: Row) {
  if (s.status !== 'ACTIVE') throw forbidden('SESSION_NOT_ACTIVE', 'parking session is closed');
}

export function customerUrl(token: string) {
  return `${config.publicUrl.replace(/\/$/, '')}/p/${token}`;
}

/**
 * LPR ingestion + gate control.
 *   POST /api/lpr/events[/:format]   camera / edge agent (device key)
 *   GET  /api/gates                  overview (staff)
 *   GET  /api/gates/:id/state        kiosk polling fallback
 *   POST /api/gates/:id/entry/issue  kiosk button "รับบัตร" / staff manual entry
 *   POST /api/gates/:id/ticket-taken kiosk → opens barrier
 *   POST /api/gates/:id/exit/scan    exit kiosk scans ticket QR
 *   POST /api/gates/:id/exit/approve staff resolves mismatch / not found
 *   POST /api/gates/:id/barrier/open manual barrier open (reason + approval)
 *   POST /api/gates/:id/simulate     test a camera read without hardware
 */
import { Router, type Request } from 'express';
import { manualPlate, type RawCandidate } from '@pp/shared';
import { q } from '../db/index.ts';
import { body, bool, h, HttpError, int, reqStr, str, forbidden } from '../lib/http.ts';
import { requirePerm, requireUserOrDevice, verifyApproval, assertSite } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { raiseAlert, resolveAlerts } from '../lib/alerts.ts';
import { cameraAdapters } from '../adapters/camera/index.ts';
import {
  decideExit,
  exitByTicket,
  gateOverview,
  gateState,
  getGate,
  issueEntry,
  onEntryDetection,
  onExitDetection,
  resetGate,
  ticketTaken,
} from '../services/gates.ts';
import { openBarrier } from '../services/barrier.ts';
import { getSession, quote, sessionByToken } from '../services/sessions.ts';

export const router = Router();

const KIOSK_TYPES = ['ENTRY_KIOSK', 'EXIT_KIOSK', 'EDGE', 'CAMERA'];

/** Kiosk/edge devices may only act on their own gate. */
function checkGateAccess(req: Request, gateId: number) {
  const g = getGate(gateId);
  if (req.device) {
    if (req.device.type !== 'EDGE' && req.device.gateId && req.device.gateId !== gateId) throw forbidden('GATE_FORBIDDEN');
    if (req.device.siteId && req.device.siteId !== g.site_id) throw forbidden('SITE_FORBIDDEN');
  } else assertSite(req, g.site_id);
  return g;
}

async function ingest(req: Request, format: string) {
  const adapter = cameraAdapters[format];
  if (!adapter) throw new HttpError(400, 'UNKNOWN_FORMAT');
  const b = body(req);
  const ev = adapter(b);
  const gateId = Number(b.gateId ?? req.device?.gateId);
  if (!gateId) throw new HttpError(400, 'GATE_REQUIRED');
  const g = checkGateAccess(req, gateId);
  const cameraId = req.device?.type === 'CAMERA' ? req.device.id : (int(b, 'cameraId') ?? null);
  const input = {
    gateId,
    cameraId,
    capturedAt: ev.capturedAt,
    image: ev.image ?? null,
    candidates: ev.candidates.map((c, i) => ({ ...c, cropImage: (b.candidates as any[])?.[i]?.cropImage ?? ev.crops?.[i] ?? null })),
    vehicleType: ev.vehicleType,
    edgeEventId: ev.eventId ? `${req.device?.id ?? 'x'}:${ev.eventId}` : null,
  };
  return g.direction === 'ENTRY' ? onEntryDetection(input) : onExitDetection(input);
}

router.post('/lpr/events', requireUserOrDevice(['devices.manage'], ['CAMERA', 'EDGE']), h(async (req, res) => res.json(await ingest(req, 'generic'))));
router.post('/lpr/events/:format', requireUserOrDevice(['devices.manage'], ['CAMERA', 'EDGE']), h(async (req, res) => res.json(await ingest(req, String(req.params.format)))));

router.get('/gates', requireUserOrDevice(['dashboard.view', 'gate.control', 'sessions.view'], KIOSK_TYPES), h((_req, res) => res.json({ gates: gateOverview() })));

router.get(
  '/gates/:id/state',
  requireUserOrDevice(['gate.control', 'sessions.view'], KIOSK_TYPES),
  h((req, res) => {
    const g = checkGateAccess(req, Number(req.params.id));
    res.json({ gate: { id: g.id, name: g.name, direction: g.direction, siteId: g.site_id }, state: gateState(g.id) });
  }),
);

router.post(
  '/gates/:id/entry/issue',
  requireUserOrDevice(['sessions.create_manual', 'gate.control'], ['ENTRY_KIOSK', 'EDGE']),
  h(async (req, res) => {
    const g = checkGateAccess(req, Number(req.params.id));
    const b = body(req);
    const detectionId = int(b, 'detectionId') ?? null;
    const unplated = bool(b, 'unplated') ?? false;
    let plate = null;
    // Staff may key in a plate (camera could not read it).
    if (req.user && b.prefix && b.number) {
      const p = manualPlate(String(b.prefix), String(b.number), str(b, 'province') ?? null);
      plate = { prefix: p.prefix, number: p.number, provinceCode: p.provinceCode, key: p.key, text: p.plateText, source: 'MANUAL_ENTRY' };
    }
    const force = !!(req.user && bool(b, 'force'));
    const r = await issueEntry(g.id, {
      detectionId,
      plate,
      unplated,
      vehicleType: str(b, 'vehicleType'),
      userId: req.user?.id ?? null,
      force,
      idempotencyKey: str(b, 'idempotencyKey', { max: 80 }) ?? null,
    });
    if (req.user) {
      audit(req, {
        action: plate ? 'session.manual_entry' : unplated ? 'session.unplated_ticket' : 'session.entry_confirm',
        entityType: 'session',
        entityId: r.session.id,
        sessionId: r.session.id,
        parkingNo: r.session.parking_no,
        siteId: g.site_id,
        after: { plate: r.session.plate_text, province: r.session.province, force },
        reason: str(b, 'reason') ?? null,
      });
    }
    res.json({ session: { id: r.session.id, parkingNo: r.session.parking_no }, ticket: r.ticket, ticketless: r.ticketless, warnings: r.warnings });
  }),
);

router.post(
  '/gates/:id/ticket-taken',
  requireUserOrDevice(['gate.control'], ['ENTRY_KIOSK', 'EDGE']),
  h(async (req, res) => {
    const g = checkGateAccess(req, Number(req.params.id));
    res.json(await ticketTaken(g.id, int(body(req), 'sessionId', { required: true })!));
  }),
);

router.post(
  '/gates/:id/reset',
  requireUserOrDevice(['gate.control'], ['ENTRY_KIOSK', 'EXIT_KIOSK', 'EDGE']),
  h((req, res) => {
    const g = checkGateAccess(req, Number(req.params.id));
    resetGate(g.id);
    res.json({ ok: true });
  }),
);

router.post(
  '/gates/:id/exit/scan',
  requireUserOrDevice(['gate.control'], ['EXIT_KIOSK', 'EDGE']),
  h(async (req, res) => {
    const g = checkGateAccess(req, Number(req.params.id));
    const raw = reqStr(body(req), 'code', 400);
    const token = raw.includes('/p/') ? raw.slice(raw.lastIndexOf('/p/') + 3).split(/[?#]/)[0] : raw;
    res.json(await exitByTicket(g.id, token));
  }),
);

/** Exit kiosk asks to re-evaluate (e.g. after the customer paid on the exit screen). */
router.post(
  '/gates/:id/exit/recheck',
  requireUserOrDevice(['gate.control'], ['EXIT_KIOSK', 'EDGE']),
  h(async (req, res) => {
    const g = checkGateAccess(req, Number(req.params.id));
    const st = gateState(g.id);
    if (st.kind !== 'EXIT_PAYMENT') return res.json({ state: st });
    res.json(await decideExit(g.id, st.session.id));
  }),
);

router.post(
  '/gates/:id/exit/approve',
  requirePerm('gate.control'),
  h(async (req, res) => {
    const g = checkGateAccess(req, Number(req.params.id));
    const b = body(req);
    const sessionId = int(b, 'sessionId', { required: true })!;
    const reason = reqStr(b, 'reason');
    const s = getSession(sessionId);
    q.run('UPDATE parking_sessions SET flags=? WHERE id=?', JSON.stringify([...(JSON.parse(s.flags ?? '[]') as string[]).filter((f) => f !== 'PLATE_MISMATCH'), 'MISMATCH_APPROVED']), s.id);
    resolveAlerts(`PLATE_MISMATCH:${s.id}`);
    audit(req, { action: 'gate.exit_approve', entityType: 'session', entityId: s.id, sessionId: s.id, parkingNo: s.parking_no, siteId: g.site_id, reason });
    res.json(await decideExit(g.id, s.id));
  }),
);

router.post(
  '/gates/:id/barrier/open',
  requirePerm('gate.open_manual'),
  h(async (req, res) => {
    const g = checkGateAccess(req, Number(req.params.id));
    const b = body(req);
    const reason = reqStr(b, 'reason');
    const approval = verifyApproval(req, b.approval as any, 'gate.open_manual');
    const r = await openBarrier(g.id, { reason: 'MANUAL', userId: req.user!.id, sessionId: int(b, 'sessionId') ?? null });
    audit(req, { action: 'gate.manual_open', entityType: 'gate', entityId: g.id, siteId: g.site_id, sessionId: int(b, 'sessionId') ?? null, reason, approvedBy: approval, after: r });
    raiseAlert({ type: 'MANUAL_BARRIER', severity: 'INFO', siteId: g.site_id, refType: 'gate', refId: g.id, message: `เปิดไม้กั้นด้วยมือ ${g.name} โดย ${req.user!.username}: ${reason}` });
    res.json(r);
  }),
);

/** Simulate a camera read (commissioning / training without live hardware). */
router.post(
  '/gates/:id/simulate',
  requirePerm('devices.manage', 'gate.control'),
  h(async (req, res) => {
    const g = checkGateAccess(req, Number(req.params.id));
    const b = body(req);
    const candidates = (Array.isArray(b.candidates) ? b.candidates : []) as RawCandidate[];
    const input = { gateId: g.id, candidates, image: (b.image as string) ?? null, vehicleType: str(b, 'vehicleType') };
    audit(req, { action: 'gate.simulate_detection', entityType: 'gate', entityId: g.id, siteId: g.site_id, meta: { candidates } });
    res.json(g.direction === 'ENTRY' ? await onEntryDetection(input) : await onExitDetection(input));
  }),
);

/** Exit kiosk: quote for the session shown on screen (amount from server). */
router.get(
  '/gates/:id/exit/quote',
  requireUserOrDevice(['gate.control'], ['EXIT_KIOSK', 'EDGE']),
  h((req, res) => {
    const g = checkGateAccess(req, Number(req.params.id));
    const st = gateState(g.id);
    if (st.kind !== 'EXIT_PAYMENT') throw new HttpError(409, 'NO_PAYMENT_PENDING');
    res.json({ quote: quote(st.session.id) });
  }),
);

export function tokenFromCode(raw: string) {
  return raw.includes('/p/') ? raw.slice(raw.lastIndexOf('/p/') + 3).split(/[?#]/)[0] : raw;
}
export { sessionByToken };

/**
 * Kiosk APIs (entry / exit / payment kiosks authenticate with X-Device-Key;
 * staff can open kiosk screens for testing with gate.control).
 */
import { Router, type Request } from 'express';
import QRCode from 'qrcode';
import { q, json } from '../db/index.ts';
import { body, h, HttpError, num, oneOf, str, forbidden } from '../lib/http.ts';
import { requireUserOrDevice } from '../auth/middleware.ts';
import { getSetting } from '../lib/settings.ts';
import { findSessions } from '../services/lookup.ts';
import { getSession, quote, sessionSummary } from '../services/sessions.ts';
import { createPayment, payCash, publicPayment } from '../services/payments.ts';
import { audit } from '../lib/audit.ts';

export const router = Router();
const KIOSKS = ['ENTRY_KIOSK', 'EXIT_KIOSK', 'PAYMENT_KIOSK', 'DISPLAY', 'COUNTER', 'CAMERA'];
router.use(requireUserOrDevice(['gate.control', 'kiosk_content.manage', 'payment.cash'], KIOSKS));

function sessionForKiosk(req: Request, id: number) {
  const s = getSession(id);
  if (req.device?.siteId && req.device.siteId !== s.site_id) throw forbidden('SITE_FORBIDDEN');
  if (s.status !== 'ACTIVE') throw new HttpError(409, 'SESSION_NOT_ACTIVE');
  return s;
}

router.get(
  '/bootstrap',
  h((req, res) => {
    const d = req.device;
    const device = d ? q.get('SELECT id, type, name, site_id, gate_id, settings_json FROM devices WHERE id=?', d.id) : null;
    const gate = d?.gateId ? q.get('SELECT id, name, direction, site_id, zone_id FROM gates WHERE id=?', d.gateId) : null;
    const site = q.get('SELECT id, code, name FROM sites WHERE id=?', d?.siteId ?? gate?.site_id ?? 1);
    const printers = d?.gateId ? q.all("SELECT id, name, connection_json FROM devices WHERE type='PRINTER' AND gate_id=? AND active=1", d.gateId).map((p) => ({ id: p.id, name: p.name, connection: json(p.connection_json, {}) })) : [];
    res.json({
      device: device ? { ...device, settings: json(device.settings_json, {}) } : null,
      gate,
      site,
      printers,
      branding: getSetting('branding'),
      ticket: getSetting('ticket'),
      receipt: getSetting('receipt'),
      operation: { autoIssueTicket: getSetting('operation').autoIssueTicket, allowTicketWithoutPlate: getSetting('operation').allowTicketWithoutPlate },
      validation: { selfServiceKiosk: getSetting('validation').selfServiceKiosk, allowMultipleReceipts: getSetting('validation').allowMultipleReceipts },
      paymentMethods: getSetting('payment').methods,
      design: getSetting('design'),
    });
  }),
);

/** Active promotional playlist for this kiosk. */
router.get(
  '/content',
  h((req, res) => {
    const nowIso = new Date().toISOString();
    const site = q.get('SELECT tz_offset FROM sites WHERE id=?', req.device?.siteId ?? 1);
    const local = new Date(Date.now() + (site?.tz_offset ?? 420) * 60_000);
    const hm = local.toISOString().slice(11, 16);
    const type = req.device?.type ?? String(req.query.type ?? 'PAYMENT_KIOSK');
    const rows = q.all(
      `SELECT * FROM kiosk_content WHERE active=1 AND (start_at IS NULL OR start_at<=?) AND (end_at IS NULL OR end_at>=?) ORDER BY sort, id`,
      nowIso,
      nowIso,
    );
    const items = rows.filter((c) => {
      if (c.daily_start && c.daily_end && !(c.daily_start <= c.daily_end ? hm >= c.daily_start && hm < c.daily_end : hm >= c.daily_start || hm < c.daily_end)) return false;
      const sites = json<number[] | null>(c.site_ids, null);
      if (sites?.length && req.device?.siteId && !sites.includes(req.device.siteId)) return false;
      const devs = json<number[] | null>(c.device_ids, null);
      if (devs?.length && req.device && !devs.includes(req.device.id)) return false;
      const types = json<string[] | null>(c.kiosk_types, null);
      if (types?.length && !types.includes(type)) return false;
      return true;
    });
    res.json({
      items: items.map((c) => ({ id: c.id, title: c.title, kind: c.kind, category: c.category, url: c.media_url, layout: c.layout, durationSec: c.duration_sec })),
    });
  }),
);

router.post(
  '/sessions/find',
  h((req, res) => {
    const b = body(req);
    const rows = findSessions({ code: str(b, 'code'), prefix: str(b, 'prefix'), number: str(b, 'number'), plate: str(b, 'plate'), province: str(b, 'province'), siteId: req.device?.siteId ?? null });
    // Customers searching by plate get only enough to pick their own car.
    res.json({ items: rows.map((s) => ({ id: s.id, parkingNo: s.parking_no, plateText: s.plate_text, province: sessionSummary(s).province, entryAt: s.entry_at })) });
  }),
);

router.get('/sessions/:id/quote', h((req, res) => res.json({ quote: quote(sessionForKiosk(req, Number(req.params.id))) })));

router.post(
  '/sessions/:id/payments',
  h(async (req, res) => {
    const s = sessionForKiosk(req, Number(req.params.id));
    const b = body(req);
    const method = oneOf(b, 'method', ['PROMPTPAY', 'CARD', 'EWALLET'] as const, true)!;
    const channel = req.device?.type === 'EXIT_KIOSK' ? 'EXIT_KIOSK' : 'PAYMENT_KIOSK';
    const p = await createPayment({ sessionId: s.id, method, channel, deviceId: req.device?.id ?? null, userId: req.user?.id ?? null, idempotencyKey: str(b, 'idempotencyKey') ?? null });
    res.json({ payment: p, qrDataUrl: p.qrPayload ? await QRCode.toDataURL(p.qrPayload, { margin: 1, width: 420 }) : null });
  }),
);

router.get(
  '/payments/:id',
  h((req, res) => {
    const p = q.get('SELECT * FROM payments WHERE id=?', Number(req.params.id));
    if (!p) throw new HttpError(404, 'NOT_FOUND');
    sessionForKioskAny(req, p.session_id);
    res.json({ payment: publicPayment(p), quote: quote(p.session_id) });
  }),
);

function sessionForKioskAny(req: Request, id: number) {
  const s = getSession(id);
  if (req.device?.siteId && req.device.siteId !== s.site_id) throw forbidden('SITE_FORBIDDEN');
  return s;
}

/** Cash acceptor on the payment kiosk reports inserted cash. */
router.post(
  '/sessions/:id/cash',
  h((req, res) => {
    if (req.device && req.device.type !== 'PAYMENT_KIOSK') throw forbidden();
    const s = sessionForKiosk(req, Number(req.params.id));
    const b = body(req);
    const p = payCash({ sessionId: s.id, received: num(b, 'received', { required: true, min: 0 })!, deviceId: req.device?.id ?? null, userId: req.user?.id ?? null, channel: 'PAYMENT_KIOSK', idempotencyKey: str(b, 'idempotencyKey') ?? null });
    audit(req, { action: 'payment.cash', entityType: 'payment', entityId: p.id, sessionId: s.id, parkingNo: s.parking_no, after: p });
    res.json({ payment: p, quote: quote(s.id) });
  }),
);

/** Parking receipt data after payment (kiosk prints it). */
router.get(
  '/sessions/:id/receipt',
  h((req, res) => {
    const s = sessionForKioskAny(req, Number(req.params.id));
    const p = q.get("SELECT * FROM payments WHERE session_id=? AND status='PAID' ORDER BY id DESC LIMIT 1", s.id);
    if (!p) throw new HttpError(404, 'NO_PAYMENT');
    res.json({ session: sessionSummary(s), payment: publicPayment(p), quote: quote(s), template: getSetting('receipt') });
  }),
);

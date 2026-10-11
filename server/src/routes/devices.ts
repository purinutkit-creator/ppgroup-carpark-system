import { Router } from 'express';
import { q, nowIso } from '../db/index.ts';
import { body, h, HttpError, reqStr, str } from '../lib/http.ts';
import { requireDevice, requireUserOrDevice, requirePerm } from '../auth/middleware.ts';
import { printRaw } from '../services/printers.ts';
import { markDevice } from '../realtime-server.ts';

export const router = Router();

/** Device heartbeat (HTTP fallback for devices without websockets). */
router.post(
  '/heartbeat',
  requireDevice(),
  h((req, res) => {
    markDevice(req.device!.id, 'ONLINE');
    const st = (body(req).status ?? {}) as Record<string, string>;
    for (const [id, s] of Object.entries(st)) {
      const d = q.get('SELECT site_id FROM devices WHERE id=?', Number(id));
      if (d && d.site_id === req.device!.siteId) markDevice(Number(id), s === 'ONLINE' ? 'ONLINE' : 'OFFLINE');
    }
    res.json({ ok: true, serverTime: nowIso() });
  }),
);

/** Send rendered ESC/POS bytes (base64) to a printer. */
router.post(
  '/:id/print',
  requireUserOrDevice(['sessions.lost_ticket', 'devices.manage', 'payment.cash'], ['ENTRY_KIOSK', 'EXIT_KIOSK', 'PAYMENT_KIOSK', 'COUNTER']),
  h(async (req, res) => {
    const id = Number(req.params.id);
    const printer = q.get('SELECT site_id, gate_id FROM devices WHERE id=?', id);
    if (!printer) throw new HttpError(404, 'NOT_FOUND');
    if (req.device?.siteId && printer.site_id !== req.device.siteId) throw new HttpError(403, 'SITE_FORBIDDEN');
    const b = body(req);
    const data = Buffer.from(reqStr(b, 'data', 4_000_000), 'base64');
    res.json(await printRaw(id, data, { job: str(b, 'job') ?? 'print', ref: str(b, 'ref') }));
  }),
);

router.get(
  '/status',
  requirePerm('dashboard.view', 'devices.manage'),
  h((_req, res) => {
    res.json({ items: q.all('SELECT id, site_id, gate_id, type, name, status, last_seen_at, last_error FROM devices WHERE active=1 ORDER BY site_id, gate_id, type') });
  }),
);

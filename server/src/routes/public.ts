/**
 * Customer-facing endpoints (no login). Access is by the unguessable QR token
 * printed on the ticket; the token stops working once the car exits.
 */
import { Router } from 'express';
import QRCode from 'qrcode';
import { q } from '../db/index.ts';
import { body, h, HttpError, notFound, oneOf, str } from '../lib/http.ts';
import { getSetting } from '../lib/settings.ts';
import { quote, sessionByToken } from '../services/sessions.ts';
import { createPayment, paymentsForSession, publicPayment } from '../services/payments.ts';
import { sessionValidations } from '../services/validation.ts';

export const router = Router();

const hits = new Map<string, { n: number; t: number }>();
router.use((req, _res, next) => {
  // basic per-IP throttle against token guessing
  const k = req.ip ?? 'x';
  const now = Date.now();
  const e = hits.get(k);
  if (!e || now - e.t > 60_000) hits.set(k, { n: 1, t: now });
  else if (++e.n > 240) return next(new HttpError(429, 'RATE_LIMITED'));
  next();
});

router.get(
  '/config',
  h((_req, res) => {
    const b = getSetting('branding');
    res.json({
      branding: b,
      design: getSetting('design'),
      paymentMethods: getSetting('payment').methods,
      privacyNotice: getSetting('pdpa').privacyNotice,
      provider: process.env.PAYMENT_PROVIDER ?? 'mock',
    });
  }),
);

function sessionOr404(token: string) {
  const s = sessionByToken(token);
  if (!s) throw notFound('TICKET_INVALID', 'ticket not found or already used');
  return s;
}

router.get(
  '/sessions/:token',
  h((req, res) => {
    const s = sessionOr404(String(req.params.token));
    const qt = quote(s);
    const validations = sessionValidations(s.id).map((v) => ({
      receipt: v.external ? v.receipt_ref.replace(/^EXT:/, '') : v.receipt_ref,
      merchant: v.merchant_name,
      amount: v.amount,
      status: v.status,
      at: v.created_at,
    }));
    const payments = paymentsForSession(s.id).map(({ quote: _q, ...p }) => p);
    res.json({ quote: qt, validations, payments, site: q.get('SELECT name FROM sites WHERE id=?', s.site_id) });
  }),
);

router.post(
  '/sessions/:token/payments',
  h(async (req, res) => {
    const s = sessionOr404(String(req.params.token));
    const b = body(req);
    // Only the method is taken from the client — never an amount.
    const method = oneOf(b, 'method', ['PROMPTPAY', 'CARD', 'EWALLET'] as const, true)!;
    const p = await createPayment({ sessionId: s.id, method, channel: 'WEB', idempotencyKey: str(b, 'idempotencyKey', { max: 80 }) });
    res.json({ payment: p, qrDataUrl: p.qrPayload ? await QRCode.toDataURL(p.qrPayload, { margin: 1, width: 360 }) : null });
  }),
);

router.get(
  '/sessions/:token/payments/:id',
  h((req, res) => {
    const s = sessionOr404(String(req.params.token));
    const p = q.get('SELECT * FROM payments WHERE id=? AND session_id=?', Number(req.params.id), s.id);
    if (!p) throw notFound();
    res.json({ payment: publicPayment(p), quote: quote(s) });
  }),
);

/** QR image for any text (used by kiosks / tickets that render QR client-side as fallback). */
router.get(
  '/qr',
  h(async (req, res) => {
    const text = String(req.query.text ?? '').slice(0, 1000);
    if (!text) throw notFound();
    res.type('image/svg+xml').send(await QRCode.toString(text, { type: 'svg', margin: 1 }));
  }),
);

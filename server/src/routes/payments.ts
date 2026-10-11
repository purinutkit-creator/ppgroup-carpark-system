import { Router } from 'express';
import { q, json } from '../db/index.ts';
import { config } from '../config.ts';
import { h, HttpError, notFound, paging } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { gateway } from '../adapters/payment/index.ts';
import { signMock } from '../adapters/payment/mock.ts';
import { handleGatewayEvents, publicPayment } from '../services/payments.ts';
import { audit } from '../lib/audit.ts';

export const router = Router();

/** Gateway → server confirmation. The only path that can mark a charge PAID. */
router.post(
  '/webhook/:gateway',
  h(async (req, res) => {
    const name = String(req.params.gateway);
    const gw = gateway(name);
    let events;
    try {
      events = await gw.verifyWebhook(req as any);
    } catch (e) {
      q.insert('payment_events', { gateway: name, event_type: 'REJECTED', external_id: `rejected:${Date.now()}:${Math.random()}`, verified: 0, payload: JSON.stringify(req.body ?? {}).slice(0, 5000), result: (e as Error).message });
      throw e;
    }
    res.json({ results: await handleGatewayEvents(name, events) });
  }),
);

/**
 * Development helper: simulate the customer completing a mock charge.
 * Builds a signed webhook and feeds it through the same verification path.
 * Disabled when PAYMENT_PROVIDER is not "mock" or in production unless ALLOW_MOCK_PAY=1.
 */
router.post(
  '/mock/:id/complete',
  h(async (req, res) => {
    if (config.payment.provider !== 'mock' || (config.env === 'production' && process.env.ALLOW_MOCK_PAY !== '1')) throw new HttpError(404, 'NOT_FOUND');
    const p = q.get("SELECT * FROM payments WHERE id=? AND gateway='mock'", Number(req.params.id));
    if (!p) throw notFound();
    const status = (req.body?.status as string) === 'FAILED' ? 'FAILED' : 'PAID';
    const payload = JSON.stringify({ eventId: `evt_${p.id}_${Date.now()}`, chargeId: p.gateway_ref, status, amount: p.amount, transactionId: `TX${Date.now()}` });
    const fake = { headers: { 'x-mock-signature': signMock(payload) }, rawBody: Buffer.from(payload), body: JSON.parse(payload) };
    const events = await gateway('mock').verifyWebhook(fake as any);
    res.json({ results: await handleGatewayEvents('mock', events) });
  }),
);

router.get(
  '/',
  requirePerm('payment.view', 'reports.view'),
  h((req, res) => {
    const { limit, offset } = paging(req);
    const Q = req.query as Record<string, string>;
    const where: string[] = [];
    const params: unknown[] = [];
    if (Q.status) (where.push('p.status=?'), params.push(Q.status));
    if (Q.method) (where.push('p.method=?'), params.push(Q.method));
    if (Q.from) (where.push('p.created_at>=?'), params.push(Q.from));
    if (Q.to) (where.push('p.created_at<=?'), params.push(Q.to));
    if (Q.needsRefund) where.push('p.needs_refund=1');
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = q.all(`SELECT p.*, s.parking_no, s.plate_text FROM payments p JOIN parking_sessions s ON s.id=p.session_id ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
    const total = q.get<{ n: number }>(`SELECT COUNT(*) n FROM payments p ${w}`, ...params)!.n;
    res.json({ total, items: rows.map((p) => ({ ...publicPayment(p), parkingNo: p.parking_no, plateText: p.plate_text, needsRefund: !!p.needs_refund, refundedAmount: p.refunded_amount, failureReason: p.failure_reason, sessionId: p.session_id })) });
  }),
);

router.get(
  '/events',
  requirePerm('audit.view'),
  h((req, res) => {
    const { limit, offset } = paging(req);
    res.json({ items: q.all('SELECT * FROM payment_events ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset).map((e) => ({ ...e, payload: json(e.payload, null) })) });
  }),
);

router.post(
  '/:id/mark-refunded',
  requirePerm('payment.refund_approve'),
  h((req, res) => {
    q.run('UPDATE payments SET needs_refund=0 WHERE id=?', Number(req.params.id));
    audit(req, { action: 'payment.duplicate_resolved', entityType: 'payment', entityId: Number(req.params.id), reason: String(req.body?.reason ?? '') });
    res.json({ ok: true });
  }),
);

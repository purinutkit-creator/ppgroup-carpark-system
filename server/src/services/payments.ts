/**
 * Parking payments. Amounts are always computed server-side from the latest
 * quote; the client only chooses a method. Confirmation comes exclusively from
 * a verified gateway webhook (or a staff cash entry) and is idempotent.
 */
import { q, tx, nowIso, json, type Row } from '../db/index.ts';
import { config } from '../config.ts';
import { conflict, HttpError, notFound, r2 } from '../lib/http.ts';
import { raiseAlert } from '../lib/alerts.ts';
import { emit } from '../lib/realtime.ts';
import { getSetting } from '../lib/settings.ts';
import { gateway } from '../adapters/payment/index.ts';
import type { WebhookEvent } from '../adapters/payment/types.ts';
import { getSession, quote, refreshPaymentStatus, assertActive } from './sessions.ts';
import { rateForVersion } from './rates.ts';

export type Method = 'PROMPTPAY' | 'CARD' | 'EWALLET' | 'CASH';
export type Channel = 'WEB' | 'PAYMENT_KIOSK' | 'EXIT_KIOSK' | 'COUNTER';

export function publicPayment(p: Row) {
  return {
    id: p.id,
    amount: p.amount,
    method: p.method,
    gateway: p.gateway,
    status: p.status,
    qrPayload: p.qr_payload,
    qrImageUrl: p.qr_image_url,
    expiresAt: p.expires_at,
    paidAt: p.paid_at,
    createdAt: p.created_at,
    channel: p.channel,
    cashReceived: p.cash_received,
    changeGiven: p.change_given,
  };
}

function expireStale(sessionId: number) {
  q.run("UPDATE payments SET status='EXPIRED' WHERE session_id=? AND status='PENDING' AND expires_at IS NOT NULL AND expires_at<?", sessionId, nowIso());
}

export async function createPayment(opts: {
  sessionId: number;
  method: Method;
  channel: Channel;
  deviceId?: number | null;
  userId?: number | null;
  idempotencyKey?: string | null;
}) {
  const methods = getSetting('payment').methods;
  const allowed = { PROMPTPAY: methods.promptpay, CARD: methods.card, EWALLET: methods.ewallet, CASH: methods.cash }[opts.method];
  if (!allowed) throw new HttpError(400, 'METHOD_DISABLED');
  if (opts.method === 'CASH') throw new HttpError(400, 'USE_CASH_ENDPOINT');

  if (opts.idempotencyKey) {
    const existing = q.get('SELECT * FROM payments WHERE idempotency_key=?', opts.idempotencyKey);
    if (existing) return publicPayment(existing);
  }
  const s = getSession(opts.sessionId);
  assertActive(s);
  expireStale(s.id);
  const qt = quote(s);
  if (qt.due <= 0) throw conflict('NOTHING_DUE', 'no outstanding amount');

  // Reuse an open charge for the same amount + method (prevents double QR / double pay).
  const open = q.get(
    "SELECT * FROM payments WHERE session_id=? AND status='PENDING' AND method=? AND amount=? AND (expires_at IS NULL OR expires_at>?) ORDER BY id DESC LIMIT 1",
    s.id,
    opts.method,
    qt.due,
    nowIso(),
  );
  if (open) return publicPayment(open);
  // A different amount means the quote changed: cancel older pending charges.
  q.run("UPDATE payments SET status='CANCELLED', failure_reason='SUPERSEDED' WHERE session_id=? AND status='PENDING'", s.id);

  const gw = gateway();
  const id = q.insert('payments', {
    session_id: s.id,
    amount: qt.due,
    method: opts.method,
    gateway: gw.name,
    status: 'PENDING',
    quote_json: JSON.stringify(qt),
    idempotency_key: opts.idempotencyKey ?? null,
    channel: opts.channel,
    device_id: opts.deviceId ?? null,
    created_by: opts.userId ?? null,
  });
  try {
    const ch = await gw.createCharge({
      paymentId: id,
      reference: s.parking_no,
      amount: qt.due,
      method: opts.method,
      description: `Parking ${s.parking_no} ${s.plate_text ?? ''}`.trim(),
      returnUrl: `${config.publicUrl}/pay/return/${id}`,
    });
    const expires = ch.expiresAt ?? new Date(Date.now() + getSetting('operation').pendingPaymentExpiryMinutes * 60_000).toISOString();
    q.update('payments', id, { gateway_ref: ch.gatewayRef, qr_payload: ch.qrPayload ?? null, qr_image_url: ch.qrImageUrl ?? ch.authorizeUrl ?? null, expires_at: expires });
  } catch (e) {
    q.update('payments', id, { status: 'FAILED', failure_reason: (e as Error).message });
    throw e;
  }
  const p = q.get('SELECT * FROM payments WHERE id=?', id)!;
  emit.session(s.id, 'payment:update', publicPayment(p));
  return publicPayment(p);
}

/** Mark a payment PAID and update the session (inside a transaction). */
function settle(p: Row, paidAt: string, gatewayRef?: string) {
  const s = getSession(p.session_id);
  const before = quote(s);
  // Paid while nothing was due (double payment) → keep money, flag for refund.
  const duplicate = s.status !== 'ACTIVE' || before.due <= 0;
  q.update('payments', p.id, { status: 'PAID', paid_at: paidAt, needs_refund: duplicate ? 1 : 0, gateway_ref: gatewayRef ?? p.gateway_ref });
  if (duplicate) {
    raiseAlert({
      type: 'DUPLICATE_PAYMENT',
      severity: 'CRITICAL',
      siteId: s.site_id,
      refType: 'payment',
      refId: p.id,
      message: `ได้รับชำระซ้ำ ${p.amount} บาท (${s.parking_no}) — ต้องคืนเงิน`,
    });
    return;
  }
  const grace = rateForVersion(s.rate_version_id).graceAfterPaymentMinutes ?? getSetting('payment').graceMinutes;
  const after = quote(getSession(s.id));
  if (after.due <= 0) {
    q.run(
      "UPDATE parking_sessions SET payment_status='PAID', last_paid_at=?, exit_deadline_at=?, updated_at=? WHERE id=?",
      paidAt,
      new Date(new Date(paidAt).getTime() + grace * 60_000).toISOString(),
      nowIso(),
      s.id,
    );
  }
}

export async function handleGatewayEvents(gatewayName: string, events: WebhookEvent[]) {
  const results: Array<{ externalId: string; result: string }> = [];
  for (const ev of events) {
    const result = tx(() => {
      const dupe = q.get('SELECT id FROM payment_events WHERE gateway=? AND external_id=?', gatewayName, ev.externalId);
      if (dupe) return 'DUPLICATE_EVENT';
      const p = q.get('SELECT * FROM payments WHERE gateway=? AND gateway_ref=?', gatewayName, ev.gatewayRef);
      let outcome: string;
      if (!p) outcome = 'UNKNOWN_CHARGE';
      else if (ev.status === 'PAID') {
        if (p.status === 'PAID') outcome = 'ALREADY_PAID';
        else if (Math.round(ev.amount * 100) !== Math.round(p.amount * 100)) {
          q.update('payments', p.id, { status: 'FAILED', failure_reason: `AMOUNT_MISMATCH expected ${p.amount} got ${ev.amount}` });
          raiseAlert({ type: 'PAYMENT_FAILED', severity: 'CRITICAL', refType: 'payment', refId: p.id, message: `ยอดชำระไม่ตรง payment #${p.id}: คาด ${p.amount} ได้ ${ev.amount}` });
          outcome = 'AMOUNT_MISMATCH';
        } else {
          settle(p, nowIso(), ev.gatewayRef);
          outcome = 'PAID';
        }
      } else if (ev.status === 'FAILED' || ev.status === 'EXPIRED') {
        if (p.status === 'PENDING') q.update('payments', p.id, { status: ev.status, failure_reason: ev.failureReason ?? null });
        outcome = ev.status;
      } else outcome = 'IGNORED';
      q.insert('payment_events', {
        payment_id: p?.id ?? null,
        gateway: gatewayName,
        event_type: ev.status,
        external_id: ev.externalId,
        verified: 1,
        payload: JSON.stringify(ev.raw),
        result: outcome,
      });
      return outcome;
    });
    const p = q.get('SELECT * FROM payments WHERE gateway=? AND gateway_ref=?', gatewayName, ev.gatewayRef);
    if (p) {
      emit.session(p.session_id, 'payment:update', publicPayment(p));
      refreshPaymentStatus(p.session_id);
    }
    results.push({ externalId: ev.externalId, result });
  }
  return results;
}

/** Staff / cash-acceptor payment. Amount due is taken from the server quote. */
export function payCash(opts: { sessionId: number; received: number; userId?: number | null; deviceId?: number | null; channel: Channel; idempotencyKey?: string | null }) {
  if (!getSetting('payment').methods.cash) throw new HttpError(400, 'METHOD_DISABLED');
  if (opts.idempotencyKey) {
    const existing = q.get('SELECT * FROM payments WHERE idempotency_key=?', opts.idempotencyKey);
    if (existing) return publicPayment(existing);
  }
  const p = tx(() => {
    const s = getSession(opts.sessionId);
    assertActive(s);
    const qt = quote(s);
    if (qt.due <= 0) throw conflict('NOTHING_DUE');
    if (opts.received < qt.due) throw new HttpError(400, 'INSUFFICIENT_CASH', `due ${qt.due}`);
    q.run("UPDATE payments SET status='CANCELLED', failure_reason='PAID_BY_CASH' WHERE session_id=? AND status='PENDING'", s.id);
    const id = q.insert('payments', {
      session_id: s.id,
      amount: qt.due,
      method: 'CASH',
      gateway: 'cash',
      gateway_ref: `CASH-${s.id}-${Date.now()}`,
      status: 'PENDING',
      quote_json: JSON.stringify(qt),
      idempotency_key: opts.idempotencyKey ?? null,
      channel: opts.channel,
      device_id: opts.deviceId ?? null,
      created_by: opts.userId ?? null,
      cash_received: opts.received,
      change_given: r2(opts.received - qt.due),
    });
    const row = q.get('SELECT * FROM payments WHERE id=?', id)!;
    settle(row, nowIso());
    return q.get('SELECT * FROM payments WHERE id=?', id)!;
  });
  refreshPaymentStatus(opts.sessionId);
  emit.session(opts.sessionId, 'payment:update', publicPayment(p));
  return publicPayment(p);
}

export async function refundPayment(opts: { paymentId: number; amount: number; reason: string; userId: number; approvedBy: number }) {
  const p = q.get('SELECT * FROM payments WHERE id=?', opts.paymentId);
  if (!p) throw notFound('PAYMENT_NOT_FOUND');
  if (!['PAID', 'PARTIALLY_REFUNDED'].includes(p.status)) throw conflict('NOT_REFUNDABLE');
  const remaining = r2(p.amount - p.refunded_amount);
  if (opts.amount <= 0 || opts.amount > remaining) throw new HttpError(400, 'INVALID_REFUND_AMOUNT', `max ${remaining}`);
  let ref: string | null = null;
  if (p.gateway !== 'cash') {
    const gw = gateway(p.gateway);
    if (gw.refund) ref = (await gw.refund(p.gateway_ref, opts.amount)).refundRef;
  }
  tx(() => {
    q.insert('refunds', { payment_id: p.id, amount: opts.amount, reason: opts.reason, requested_by: opts.userId, approved_by: opts.approvedBy, gateway_ref: ref });
    const refunded = r2(p.refunded_amount + opts.amount);
    q.update('payments', p.id, { refunded_amount: refunded, status: refunded >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED', needs_refund: 0 });
  });
  refreshPaymentStatus(p.session_id);
  return q.get('SELECT * FROM payments WHERE id=?', p.id)!;
}

/** Expire stale pending charges; ask gateway for status of those near expiry. */
export async function reconcilePending() {
  const rows = q.all("SELECT * FROM payments WHERE status='PENDING' AND gateway NOT IN ('mock','cash') AND created_at < ?", new Date(Date.now() - 60_000).toISOString());
  for (const p of rows) {
    const gw = gateway(p.gateway);
    if (!gw.fetchCharge) continue;
    try {
      const c = await gw.fetchCharge(p.gateway_ref);
      if (c && c.status !== 'PENDING') await handleGatewayEvents(p.gateway, [{ ...c, externalId: `reconcile:${p.gateway_ref}:${c.status}` }]);
    } catch (e) {
      console.warn('reconcile failed', p.id, (e as Error).message);
    }
  }
  q.run("UPDATE payments SET status='EXPIRED' WHERE status='PENDING' AND expires_at IS NOT NULL AND expires_at<?", nowIso());
}

export function paymentsForSession(sessionId: number) {
  return q.all('SELECT * FROM payments WHERE session_id=? ORDER BY id DESC', sessionId).map((p) => ({ ...publicPayment(p), needsRefund: !!p.needs_refund, refundedAmount: p.refunded_amount, failureReason: p.failure_reason, quote: json(p.quote_json, null) }));
}

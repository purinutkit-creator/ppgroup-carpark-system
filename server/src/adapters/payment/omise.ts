/**
 * Omise (Opn Payments) adapter — PromptPay and card charges.
 * Webhooks are NOT trusted as-is: the charge is re-fetched from the Omise API
 * with the secret key and its status/amount used as the source of truth.
 */
import { config } from '../../config.ts';
import { HttpError } from '../../lib/http.ts';
import type { PaymentGateway, WebhookEvent } from './types.ts';

const API = 'https://api.omise.co';

async function omise(path: string, init: RequestInit = {}) {
  if (!config.payment.omiseSecretKey) throw new HttpError(503, 'GATEWAY_NOT_CONFIGURED');
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: 'Basic ' + Buffer.from(config.payment.omiseSecretKey + ':').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json()) as any;
  if (!res.ok || body.object === 'error') throw new HttpError(502, 'GATEWAY_ERROR', body.message ?? res.statusText);
  return body;
}

function mapStatus(s: string): WebhookEvent['status'] {
  if (s === 'successful') return 'PAID';
  if (s === 'failed') return 'FAILED';
  if (s === 'expired' || s === 'reversed') return 'EXPIRED';
  return 'PENDING';
}

export const omiseGateway: PaymentGateway = {
  name: 'omise',
  async createCharge(input) {
    const form = new URLSearchParams({
      amount: String(Math.round(input.amount * 100)),
      currency: 'thb',
      description: input.description,
      'metadata[payment_id]': String(input.paymentId),
      'metadata[reference]': input.reference,
      return_uri: input.returnUrl,
    });
    if (input.method === 'PROMPTPAY') form.set('source[type]', 'promptpay');
    else if (input.method === 'EWALLET') form.set('source[type]', 'truemoney');
    else throw new HttpError(400, 'CARD_REQUIRES_TOKEN', 'card charges are created with an Omise.js token on the client');
    const charge = await omise('/charges', { method: 'POST', body: form });
    return {
      gatewayRef: charge.id,
      qrImageUrl: charge.source?.scannable_code?.image?.download_uri,
      authorizeUrl: charge.authorize_uri ?? undefined,
      expiresAt: charge.expires_at ?? undefined,
    };
  },
  async verifyWebhook(req) {
    const evt = req.body as any;
    if (evt?.object !== 'event' || !evt?.data?.id) throw new HttpError(400, 'INVALID_EVENT');
    if (!String(evt.key).startsWith('charge.')) return [];
    const charge = await omise(`/charges/${encodeURIComponent(evt.data.id)}`);
    return [
      {
        externalId: evt.id,
        gatewayRef: charge.id,
        status: mapStatus(charge.status),
        amount: charge.amount / 100,
        transactionId: charge.transaction ?? charge.id,
        failureReason: charge.failure_message ?? undefined,
        raw: { event: evt.key, charge: { id: charge.id, status: charge.status, amount: charge.amount } },
      },
    ];
  },
  async fetchCharge(ref) {
    const c = await omise(`/charges/${encodeURIComponent(ref)}`);
    return { gatewayRef: c.id, status: mapStatus(c.status), amount: c.amount / 100, transactionId: c.transaction, raw: c };
  },
  async refund(ref, amount) {
    const r = await omise(`/charges/${encodeURIComponent(ref)}/refunds`, { method: 'POST', body: new URLSearchParams({ amount: String(Math.round(amount * 100)) }) });
    return { refundRef: r.id };
  },
};

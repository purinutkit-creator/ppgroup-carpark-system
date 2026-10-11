/**
 * Development gateway. Produces a real, scannable PromptPay EMV payload and a
 * webhook signed with HMAC-SHA256 (header x-mock-signature) so the production
 * confirmation path (signature check → amount check → PAID) is exercised.
 */
import crypto from 'node:crypto';
import { config } from '../../config.ts';
import { promptPayPayload } from '../../lib/promptpay.ts';
import { HttpError } from '../../lib/http.ts';
import type { PaymentGateway } from './types.ts';

export function signMock(body: string) {
  return crypto.createHmac('sha256', config.payment.mockWebhookSecret).update(body).digest('hex');
}

export const mockGateway: PaymentGateway = {
  name: 'mock',
  async createCharge(input) {
    const ref = `MOCK-${input.paymentId}-${crypto.randomBytes(4).toString('hex')}`;
    return {
      gatewayRef: ref,
      qrPayload: input.method === 'PROMPTPAY' ? promptPayPayload(config.payment.promptPayId, input.amount, input.reference) : undefined,
      authorizeUrl: input.method === 'CARD' ? `/pay/mock-card/${ref}` : undefined,
      expiresAt: new Date(Date.now() + config.payment.qrExpiryMinutes * 60_000).toISOString(),
    };
  },
  async verifyWebhook(req) {
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body);
    const sig = String(req.headers['x-mock-signature'] ?? '');
    const expected = signMock(raw);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new HttpError(401, 'INVALID_SIGNATURE');
    }
    const b = JSON.parse(raw);
    return [
      {
        externalId: String(b.eventId),
        gatewayRef: String(b.chargeId),
        status: b.status,
        amount: Number(b.amount),
        transactionId: b.transactionId,
        failureReason: b.failureReason,
        raw: b,
      },
    ];
  },
  async refund(gatewayRef) {
    return { refundRef: `MOCKREF-${gatewayRef}` };
  },
};

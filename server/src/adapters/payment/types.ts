import type { Request } from 'express';

export interface CreateChargeInput {
  paymentId: number;
  reference: string;
  amount: number; // THB
  method: 'PROMPTPAY' | 'CARD' | 'EWALLET';
  description: string;
  returnUrl: string;
}

export interface CreateChargeResult {
  gatewayRef: string;
  qrPayload?: string;    // EMV payload to render as QR
  qrImageUrl?: string;   // gateway-hosted QR image
  authorizeUrl?: string; // card / wallet redirect
  expiresAt?: string;
}

export interface WebhookEvent {
  externalId: string;      // unique event id (dedupe)
  gatewayRef: string;      // charge id
  status: 'PAID' | 'FAILED' | 'EXPIRED' | 'PENDING';
  amount: number;          // THB, as verified with the gateway
  transactionId?: string;
  failureReason?: string;
  raw: unknown;
}

export interface PaymentGateway {
  name: string;
  createCharge(input: CreateChargeInput): Promise<CreateChargeResult>;
  /**
   * Verify authenticity (signature or re-fetch from the gateway API) and
   * normalise the event. Must throw if the request cannot be verified.
   */
  verifyWebhook(req: Request & { rawBody?: Buffer }): Promise<WebhookEvent[]>;
  /** Query the gateway for the authoritative charge status (used by reconciliation). */
  fetchCharge?(gatewayRef: string): Promise<Omit<WebhookEvent, 'externalId'> | null>;
  refund?(gatewayRef: string, amount: number): Promise<{ refundRef: string }>;
}

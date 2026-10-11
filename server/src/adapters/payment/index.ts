import { config } from '../../config.ts';
import { HttpError } from '../../lib/http.ts';
import { mockGateway } from './mock.ts';
import { omiseGateway } from './omise.ts';
import type { PaymentGateway } from './types.ts';

const gateways: Record<string, PaymentGateway> = { mock: mockGateway, omise: omiseGateway };

export function gateway(name = config.payment.provider): PaymentGateway {
  const g = gateways[name];
  if (!g) throw new HttpError(500, 'UNKNOWN_GATEWAY');
  return g;
}
export type { PaymentGateway };

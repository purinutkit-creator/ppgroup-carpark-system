import { describe, expect, it } from 'vitest';
import { evaluateRewards, rewardFor, ruleIsLive, type ValidationRule } from '../src/validation.ts';

const tiers: ValidationRule = {
  id: 1, name: 'tiers', scope: 'GLOBAL', kind: 'TIER',
  tiers: [
    { minSpend: 300, reward: { type: 'AMOUNT', value: 20 } },
    { minSpend: 500, reward: { type: 'AMOUNT', value: 40 } },
    { minSpend: 1000, reward: { type: 'AMOUNT', value: 100 } },
    { minSpend: 2000, reward: { type: 'MINUTES', value: 180 } },
    { minSpend: 3000, reward: { type: 'FULL' } },
  ],
};
const value = (r: any) => (r.type === 'FULL' ? 120 : r.type === 'AMOUNT' ? Math.min(120, r.value) : r.value / 3);
const now = new Date('2026-10-12T07:00:00Z'); // Monday 14:00 local

describe('rewards', () => {
  it('picks the highest tier met (spec: ฿1,250 → −฿100)', () => {
    const r = evaluateRewards([{ receiptRef: 'a', merchantId: 1, amount: 1250 }], [tiers], value, { now });
    expect(r.amount).toBe(100);
  });
  it('sums multiple receipts', () => {
    const r = evaluateRewards(
      [
        { receiptRef: 'a', merchantId: 1, amount: 450 },
        { receiptRef: 'b', merchantId: 2, amount: 700 },
        { receiptRef: 'c', merchantId: 3, amount: 850 },
      ],
      [tiers],
      value,
      { now },
    );
    expect(r.totalSpend).toBe(2000);
    expect(r.freeMinutes).toBe(180);
  });
  it('step rule: every 500 = 1 hour with cap', () => {
    const step: ValidationRule = { id: 2, name: 's', scope: 'GLOBAL', kind: 'STEP', step: { every: 500, reward: { type: 'MINUTES', value: 60 }, max: 120 } };
    expect(rewardFor(step, 1250)).toEqual({ type: 'MINUTES', value: 120 });
    expect(rewardFor(step, 499)).toBeNull();
  });
  it('merchant-specific rules apply only to that merchant', () => {
    const cinema: ValidationRule = { id: 3, name: 'cinema', scope: 'MERCHANT', merchantIds: [9], kind: 'ANY_PURCHASE', anyPurchase: { reward: { type: 'MINUTES', value: 240 } } };
    const r = evaluateRewards([{ receiptRef: 'x', merchantId: 9, amount: 200 }], [cinema], value, { now });
    expect(r.freeMinutes).toBe(240);
    expect(evaluateRewards([{ receiptRef: 'x', merchantId: 8, amount: 200 }], [cinema], value, { now }).applied).toHaveLength(0);
  });
  it('weekend campaign is only live on Sat/Sun and non-combinable picks the best single option', () => {
    const weekend: ValidationRule = { id: 4, name: 'weekend', scope: 'CAMPAIGN', kind: 'TIER', daysOfWeek: [0, 6], tiers: [{ minSpend: 1500, reward: { type: 'FULL' } }], combinable: false, priority: 10 };
    expect(ruleIsLive(weekend, now)).toBe(false);
    const sat = new Date('2026-10-17T07:00:00Z');
    const r = evaluateRewards([{ receiptRef: 'a', merchantId: 1, amount: 1600 }], [tiers, weekend], value, { now: sat });
    expect(r.full).toBe(true);
    expect(r.applied).toHaveLength(1);
  });
});

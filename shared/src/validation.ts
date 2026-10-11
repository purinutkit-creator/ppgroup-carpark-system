/**
 * Parking Validation Engine: converts verified purchase amounts into parking
 * rewards (amount off, extra free minutes, or full waiver) using admin rules.
 * Purchase amounts must come from the server's receipt records — never from a
 * client-supplied barcode payload.
 */

export type Reward =
  | { type: 'AMOUNT'; value: number }
  | { type: 'MINUTES'; value: number }
  | { type: 'FULL' };

export interface ValidationRule {
  id: number;
  name: string;
  scope: 'GLOBAL' | 'MERCHANT' | 'CAMPAIGN';
  merchantIds?: number[] | null;
  siteIds?: number[] | null;
  kind: 'TIER' | 'STEP' | 'ANY_PURCHASE';
  tiers?: Array<{ minSpend: number; reward: Reward }>;
  step?: { every: number; reward: { type: 'AMOUNT' | 'MINUTES'; value: number }; max?: number | null };
  anyPurchase?: { minSpend?: number; reward: Reward };
  daysOfWeek?: number[] | null; // 0=Sun..6=Sat
  startDate?: string | null;    // YYYY-MM-DD local
  endDate?: string | null;
  startTime?: string | null;    // HH:mm local
  endTime?: string | null;
  priority?: number;
  combinable?: boolean;
  active?: boolean;
}

export type RefundPolicy = 'REVOKE_IF_ACTIVE' | 'RECALCULATE' | 'AUDIT_ONLY' | 'MANAGER_REVIEW';

export interface ValidationSettings {
  allowMultipleReceipts: boolean;
  maxFreeMinutesPerSession: number;     // 0 = unlimited
  maxDiscountAmountPerSession: number;  // 0 = unlimited
  maxValidationsPerDayPerPlate: number; // 0 = unlimited
  receiptMaxAgeHours: number;           // receipts older than this are rejected
  selfServiceKiosk: boolean;
  refundPolicy: RefundPolicy;
  combineWithPromotions: boolean;
  requireSameSite: boolean;
  allowManualAmountEntry: boolean;      // counter may key in amounts for external receipts
}

export const DEFAULT_VALIDATION_SETTINGS: ValidationSettings = {
  allowMultipleReceipts: true,
  maxFreeMinutesPerSession: 0,
  maxDiscountAmountPerSession: 0,
  maxValidationsPerDayPerPlate: 0,
  receiptMaxAgeHours: 24,
  selfServiceKiosk: true,
  refundPolicy: 'REVOKE_IF_ACTIVE',
  combineWithPromotions: true,
  requireSameSite: true,
  allowManualAmountEntry: false,
};

export interface ReceiptInput {
  receiptRef: string;
  merchantId: number | null;
  amount: number;
}

export interface RewardOption {
  ruleId: number;
  ruleName: string;
  scope: ValidationRule['scope'];
  merchantId: number | null;
  spend: number;
  reward: Reward;
  combinable: boolean;
  value: number; // money value of the reward against the current fee
}

export interface RewardResult {
  totalSpend: number;
  options: RewardOption[];
  applied: RewardOption[];
  freeMinutes: number;
  amount: number;
  full: boolean;
}

const MIN = 60_000;

function localParts(now: Date, tz: number) {
  const d = new Date(now.getTime() + tz * MIN);
  return {
    date: d.toISOString().slice(0, 10),
    dow: d.getUTCDay(),
    hm: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}
const toMin = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function ruleIsLive(rule: ValidationRule, now: Date, tz = 420, siteId?: number | null): boolean {
  if (rule.active === false) return false;
  const p = localParts(now, tz);
  if (rule.daysOfWeek?.length && !rule.daysOfWeek.includes(p.dow)) return false;
  if (rule.startDate && p.date < rule.startDate) return false;
  if (rule.endDate && p.date > rule.endDate) return false;
  if (rule.startTime && rule.endTime) {
    const s = toMin(rule.startTime);
    const e = toMin(rule.endTime);
    const inside = s <= e ? p.hm >= s && p.hm < e : p.hm >= s || p.hm < e;
    if (!inside) return false;
  }
  if (siteId != null && rule.siteIds?.length && !rule.siteIds.includes(siteId)) return false;
  return true;
}

export function rewardFor(rule: ValidationRule, spend: number): Reward | null {
  if (spend <= 0) return null;
  if (rule.kind === 'TIER') {
    const tiers = [...(rule.tiers ?? [])].sort((a, b) => b.minSpend - a.minSpend);
    const hit = tiers.find((t) => spend >= t.minSpend);
    return hit ? hit.reward : null;
  }
  if (rule.kind === 'STEP' && rule.step && rule.step.every > 0) {
    const n = Math.floor(spend / rule.step.every);
    if (n <= 0) return null;
    let value = n * rule.step.reward.value;
    if (rule.step.max && rule.step.max > 0) value = Math.min(value, rule.step.max);
    return { type: rule.step.reward.type, value };
  }
  if (rule.kind === 'ANY_PURCHASE' && rule.anyPurchase) {
    if (spend >= (rule.anyPurchase.minSpend ?? 0.01)) return rule.anyPurchase.reward;
  }
  return null;
}

/**
 * @param valueOf money value of a reward for the session (server computes it
 *   from the current fee, so options can be compared fairly).
 */
export function evaluateRewards(
  receipts: ReceiptInput[],
  rules: ValidationRule[],
  valueOf: (r: Reward) => number,
  opts: { now: Date; tzOffsetMinutes?: number; siteId?: number | null },
): RewardResult {
  const tz = opts.tzOffsetMinutes ?? 420;
  const live = rules.filter((r) => ruleIsLive(r, opts.now, tz, opts.siteId));
  const totalSpend = round2(receipts.reduce((s, r) => s + r.amount, 0));
  const options: RewardOption[] = [];

  // merchant-specific: per merchant subtotal, best rule per merchant
  const byMerchant = new Map<number, number>();
  for (const r of receipts) if (r.merchantId != null) byMerchant.set(r.merchantId, (byMerchant.get(r.merchantId) ?? 0) + r.amount);
  for (const [merchantId, spend] of byMerchant) {
    let best: RewardOption | null = null;
    for (const rule of live.filter((r) => r.scope === 'MERCHANT' && r.merchantIds?.includes(merchantId))) {
      const reward = rewardFor(rule, spend);
      if (!reward) continue;
      const opt = mk(rule, merchantId, spend, reward, valueOf);
      if (!best || better(opt, best, rule, live)) best = opt;
    }
    if (best) options.push(best);
  }
  // site-wide rules and campaigns: on total spend
  let bestTotal: RewardOption | null = null;
  for (const rule of live.filter((r) => r.scope !== 'MERCHANT')) {
    const reward = rewardFor(rule, totalSpend);
    if (!reward) continue;
    const opt = mk(rule, null, totalSpend, reward, valueOf);
    if (!bestTotal || better(opt, bestTotal, rule, live)) bestTotal = opt;
  }
  if (bestTotal) options.push(bestTotal);

  let applied: RewardOption[];
  if (options.every((o) => o.combinable)) applied = options;
  else applied = options.length ? [options.reduce((a, b) => (b.value > a.value ? b : a))] : [];

  let freeMinutes = 0;
  let amount = 0;
  let full = false;
  for (const o of applied) {
    if (o.reward.type === 'FULL') full = true;
    else if (o.reward.type === 'MINUTES') freeMinutes += o.reward.value;
    else amount += o.reward.value;
  }
  return { totalSpend, options, applied, freeMinutes, amount: round2(amount), full };
}

function mk(rule: ValidationRule, merchantId: number | null, spend: number, reward: Reward, valueOf: (r: Reward) => number): RewardOption {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    scope: rule.scope,
    merchantId,
    spend: round2(spend),
    reward,
    combinable: rule.combinable !== false,
    value: round2(valueOf(reward)),
  };
}

function better(a: RewardOption, b: RewardOption, _rule: ValidationRule, all: ValidationRule[]): boolean {
  if (a.value !== b.value) return a.value > b.value;
  const pa = all.find((r) => r.id === a.ruleId)?.priority ?? 0;
  const pb = all.find((r) => r.id === b.ruleId)?.priority ?? 0;
  return pa > pb;
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

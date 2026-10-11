/**
 * Parking fee engine. Pure and deterministic: the server is the only caller
 * whose result is trusted; admin screens call it through the API for previews.
 *
 * Model
 * - `hourlyRate` is the price per hour; `billingUnitMinutes` is the granularity
 *   (60 / 30 / 15 / 1). A unit costs hourlyRate * unit / 60.
 * - rounding CEIL charges every started unit (minus `toleranceMinutes`);
 *   ACTUAL prorates by the minute.
 * - Free time applies once from entry. Extra free minutes from validations /
 *   memberships are passed in `extraFreeMinutes`.
 * - The stay is split into days (rolling 24h from entry or calendar days in the
 *   site timezone). Each day may use the holiday override and is capped by
 *   `dailyMax`, or charged `dailyFlatRate`.
 * - `overnight` adds a flat fee each time the stay crosses the cutoff time.
 */

export interface TimeBand {
  name: string;
  start: string; // HH:mm local
  end: string;   // HH:mm local (may wrap past midnight)
  hourlyRate: number;
}

export interface RateConfig {
  freeMinutes: number;
  hourlyRate: number;
  billingUnitMinutes: number;
  rounding: 'CEIL' | 'ACTUAL';
  toleranceMinutes?: number;
  firstPeriod?: { minutes: number; price: number } | null;
  timeBands?: TimeBand[];
  dailyFlatRate?: number | null;
  dailyMax?: number | null;
  dayCycle?: 'ROLLING_24H' | 'CALENDAR';
  overnight?: { cutoff: string; fee: number } | null;
  lostTicketFee?: number;
  graceAfterPaymentMinutes?: number;
  holiday?: { weekendsAsHoliday?: boolean; override?: Partial<Omit<RateConfig, 'holiday'>> } | null;
}

export const DEFAULT_RATE: RateConfig = {
  freeMinutes: 120,
  hourlyRate: 20,
  billingUnitMinutes: 60,
  rounding: 'CEIL',
  toleranceMinutes: 0,
  firstPeriod: null,
  timeBands: [],
  dailyFlatRate: null,
  dailyMax: null,
  dayCycle: 'ROLLING_24H',
  overnight: null,
  lostTicketFee: 200,
  graceAfterPaymentMinutes: 15,
  holiday: null,
};

export interface FeeInput {
  entryAt: Date;
  endAt: Date;
  config: RateConfig;
  extraFreeMinutes?: number;
  /** Local dates (YYYY-MM-DD) treated as holidays. */
  holidays?: string[];
  /** Site UTC offset in minutes (Thailand = 420). */
  tzOffsetMinutes?: number;
  lostTicket?: boolean;
}

export interface FeeLine { label: string; amount: number; detail?: string }

export interface FeeResult {
  amount: number;
  durationMinutes: number;
  freeMinutes: number;
  chargeableMinutes: number;
  lines: FeeLine[];
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const r2 = (n: number) => Math.round(n * 100) / 100;

function hm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function localMinuteOfDay(t: number, tz: number): number {
  const local = new Date(t + tz * MIN);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

export function localDate(t: number | Date, tz = 420): string {
  const v = typeof t === 'number' ? t : t.getTime();
  return new Date(v + tz * MIN).toISOString().slice(0, 10);
}

function isHoliday(t: number, tz: number, cfg: RateConfig, holidays: string[]): boolean {
  if (!cfg.holiday) return false;
  const d = new Date(t + tz * MIN);
  const dow = d.getUTCDay();
  if (cfg.holiday.weekendsAsHoliday && (dow === 0 || dow === 6)) return true;
  return holidays.includes(d.toISOString().slice(0, 10));
}

function rateAt(t: number, tz: number, cfg: RateConfig): number {
  if (!cfg.timeBands?.length) return cfg.hourlyRate;
  const m = localMinuteOfDay(t, tz);
  for (const b of cfg.timeBands) {
    const s = hm(b.start);
    const e = hm(b.end);
    const inside = s <= e ? m >= s && m < e : m >= s || m < e;
    if (inside) return b.hourlyRate;
  }
  return cfg.hourlyRate;
}

/** Day boundaries [start, end) covering [entry, end]. */
function daySegments(entry: number, end: number, cycle: 'ROLLING_24H' | 'CALENDAR', tz: number): Array<[number, number]> {
  const segs: Array<[number, number]> = [];
  let s = entry;
  while (s < end) {
    let e: number;
    if (cycle === 'CALENDAR') {
      const local = s + tz * MIN;
      e = Math.floor(local / DAY) * DAY + DAY - tz * MIN;
    } else {
      e = s + DAY;
    }
    segs.push([s, Math.min(e, end)]);
    s = e;
  }
  return segs;
}

function chargeWindow(from: number, to: number, cfg: RateConfig, tz: number, applyFirstPeriod: boolean): { amount: number; firstUsed: boolean } {
  let amount = 0;
  let t = from;
  let firstUsed = false;
  if (to <= from) return { amount: 0, firstUsed };
  if (applyFirstPeriod && cfg.firstPeriod && cfg.firstPeriod.minutes > 0) {
    amount += cfg.firstPeriod.price;
    t = from + cfg.firstPeriod.minutes * MIN;
    firstUsed = true;
    if (t >= to) return { amount, firstUsed };
  }
  const unit = Math.max(1, cfg.billingUnitMinutes) * MIN;
  const tol = (cfg.toleranceMinutes ?? 0) * MIN;
  if (cfg.rounding === 'ACTUAL') {
    // prorate minute by minute (bands may change mid-window)
    while (t < to) {
      const step = Math.min(MIN, to - t);
      amount += (rateAt(t, tz, cfg) / 60) * (step / MIN);
      t += step;
    }
    return { amount, firstUsed };
  }
  while (t < to) {
    const remaining = to - t;
    if (remaining <= tol && remaining < unit) break;
    amount += (rateAt(t, tz, cfg) * unit) / (60 * MIN);
    t += unit;
  }
  return { amount, firstUsed };
}

export function calculateFee(input: FeeInput): FeeResult {
  const tz = input.tzOffsetMinutes ?? 420;
  const holidays = input.holidays ?? [];
  const base = { ...DEFAULT_RATE, ...input.config };
  const entry = input.entryAt.getTime();
  const end = Math.max(entry, input.endAt.getTime());
  const durationMinutes = Math.floor((end - entry) / MIN);
  const freeMinutes = Math.max(0, base.freeMinutes + (input.extraFreeMinutes ?? 0));
  const freeEnd = entry + freeMinutes * MIN;
  const lines: FeeLine[] = [];
  let amount = 0;
  let firstAvailable = true;

  const segs = daySegments(entry, end, base.dayCycle ?? 'ROLLING_24H', tz);
  segs.forEach(([s, e], i) => {
    const holiday = isHoliday(s, tz, base, holidays);
    const cfg: RateConfig = holiday ? { ...base, ...(base.holiday?.override ?? {}) } : base;
    const from = Math.max(s, freeEnd);
    if (from >= e) return;
    let dayAmount: number;
    if (cfg.dailyFlatRate != null && cfg.dailyFlatRate > 0) {
      dayAmount = cfg.dailyFlatRate;
    } else {
      const res = chargeWindow(from, e, cfg, tz, firstAvailable);
      if (res.firstUsed) firstAvailable = false;
      dayAmount = res.amount;
      if (cfg.dailyMax != null && cfg.dailyMax > 0 && dayAmount > cfg.dailyMax) dayAmount = cfg.dailyMax;
    }
    dayAmount = r2(dayAmount);
    if (dayAmount > 0) {
      lines.push({
        label: segs.length > 1 ? `ค่าจอดวันที่ ${i + 1}` : 'ค่าจอด',
        amount: dayAmount,
        detail: `${localDate(s, tz)}${holiday ? ' (วันหยุด)' : ''}`,
      });
    }
    amount += dayAmount;
  });

  if (base.overnight && base.overnight.fee > 0) {
    const cut = hm(base.overnight.cutoff);
    let crossings = 0;
    // count local cutoff instants strictly inside (entry, end]
    const firstLocalMidnight = Math.floor((entry + tz * MIN) / DAY) * DAY - tz * MIN;
    for (let d = firstLocalMidnight; d <= end; d += DAY) {
      const c = d + cut * MIN;
      if (c > entry && c <= end) crossings++;
    }
    if (crossings > 0) {
      const fee = r2(crossings * base.overnight.fee);
      lines.push({ label: 'ค่าจอดข้ามคืน', amount: fee, detail: `${crossings} คืน` });
      amount += fee;
    }
  }

  if (input.lostTicket && (base.lostTicketFee ?? 0) > 0) {
    lines.push({ label: 'ค่าบัตรหาย', amount: r2(base.lostTicketFee!) });
    amount += base.lostTicketFee!;
  }

  return {
    amount: r2(amount),
    durationMinutes,
    freeMinutes,
    chargeableMinutes: Math.max(0, durationMinutes - freeMinutes),
    lines,
  };
}

/** Next instant (ms) at which the fee changes — lets clients refresh the amount on time. */
export function nextFeeChangeAt(input: FeeInput, horizonMinutes = 24 * 60): number | null {
  const cur = calculateFee(input).amount;
  const start = input.endAt.getTime();
  const unit = Math.max(1, input.config.billingUnitMinutes || 60);
  // coarse scan at unit granularity, then refine to the minute
  for (let m = 1; m <= horizonMinutes; m += Math.max(1, Math.floor(unit / 2))) {
    const t = start + m * MIN;
    if (calculateFee({ ...input, endAt: new Date(t) }).amount !== cur) {
      for (let k = Math.max(1, m - unit); k <= m; k++) {
        const tt = start + k * MIN;
        if (calculateFee({ ...input, endAt: new Date(tt) }).amount !== cur) return tt;
      }
      return t;
    }
  }
  return null;
}

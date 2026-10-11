import { describe, expect, it } from 'vitest';
import { calculateFee, nextFeeChangeAt, type RateConfig } from '../src/pricing.ts';

const base: RateConfig = { freeMinutes: 120, hourlyRate: 20, billingUnitMinutes: 60, rounding: 'CEIL' };
// 2026-10-12 10:30 Asia/Bangkok
const entry = new Date('2026-10-12T03:30:00Z');
const at = (min: number) => new Date(entry.getTime() + min * 60_000);

describe('calculateFee', () => {
  it('is free within free time', () => {
    expect(calculateFee({ entryAt: entry, endAt: at(119), config: base }).amount).toBe(0);
  });
  it('charges every started hour after free time (spec example 03:25 → ฿40)', () => {
    expect(calculateFee({ entryAt: entry, endAt: at(3 * 60 + 25), config: base }).amount).toBe(40);
  });
  it('supports 15-minute units and actual-time proration', () => {
    expect(calculateFee({ entryAt: entry, endAt: at(150), config: { ...base, billingUnitMinutes: 15 } }).amount).toBe(10);
    expect(calculateFee({ entryAt: entry, endAt: at(150), config: { ...base, rounding: 'ACTUAL' } }).amount).toBe(10);
  });
  it('applies tolerance minutes', () => {
    expect(calculateFee({ entryAt: entry, endAt: at(185), config: { ...base, toleranceMinutes: 10 } }).amount).toBe(20);
  });
  it('prices the first period differently', () => {
    const cfg = { ...base, freeMinutes: 0, firstPeriod: { minutes: 60, price: 50 } };
    expect(calculateFee({ entryAt: entry, endAt: at(30), config: cfg }).amount).toBe(50);
    expect(calculateFee({ entryAt: entry, endAt: at(130), config: cfg }).amount).toBe(90);
  });
  it('uses day/night bands by local time', () => {
    const cfg: RateConfig = { ...base, freeMinutes: 0, timeBands: [{ name: 'night', start: '22:00', end: '06:00', hourlyRate: 5 }] };
    // 21:30 → 23:30 local = one hour at 20 (starts 21:30) + one hour at 5 (starts 22:30)
    const e = new Date('2026-10-12T14:30:00Z');
    expect(calculateFee({ entryAt: e, endAt: new Date(e.getTime() + 120 * 60_000), config: cfg }).amount).toBe(25);
  });
  it('caps each day with dailyMax and charges per day', () => {
    const cfg = { ...base, dailyMax: 100 };
    expect(calculateFee({ entryAt: entry, endAt: at(26 * 60), config: cfg }).amount).toBe(100 + 40);
  });
  it('charges daily flat rate', () => {
    expect(calculateFee({ entryAt: entry, endAt: at(30 * 60), config: { ...base, dailyFlatRate: 150 } }).amount).toBe(300);
  });
  it('adds overnight fee per crossed cutoff', () => {
    const r = calculateFee({ entryAt: entry, endAt: at(24 * 60), config: { ...base, dailyMax: 100, overnight: { cutoff: '02:00', fee: 50 } } });
    expect(r.lines.find((l) => l.label === 'ค่าจอดข้ามคืน')?.amount).toBe(50);
  });
  it('adds lost ticket fee', () => {
    expect(calculateFee({ entryAt: entry, endAt: at(60), config: { ...base, lostTicketFee: 200 }, lostTicket: true }).amount).toBe(200);
  });
  it('uses holiday override (weekends + calendar)', () => {
    const cfg: RateConfig = { ...base, holiday: { weekendsAsHoliday: false, override: { hourlyRate: 40 } } };
    expect(calculateFee({ entryAt: entry, endAt: at(180), config: cfg, holidays: ['2026-10-12'] }).amount).toBe(40);
    expect(calculateFee({ entryAt: entry, endAt: at(180), config: cfg, holidays: [] }).amount).toBe(20);
  });
  it('extends free time for validations', () => {
    expect(calculateFee({ entryAt: entry, endAt: at(200), config: base, extraFreeMinutes: 60 }).amount).toBe(20);
  });
  it('finds the next fee change', () => {
    const t = nextFeeChangeAt({ entryAt: entry, endAt: at(100), config: base });
    expect(new Date(t!).getTime()).toBeGreaterThan(at(100).getTime());
    expect(calculateFee({ entryAt: entry, endAt: new Date(t!), config: base }).amount).toBe(20);
  });
});

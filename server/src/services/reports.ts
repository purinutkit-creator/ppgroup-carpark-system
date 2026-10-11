/**
 * Operational reporting: live dashboard KPIs, period summaries, validation /
 * exemption breakdowns and tabular exports.
 *
 * Time: every "day" is a Thailand business day (Asia/Bangkok, UTC+7). SQL
 * groups on `datetime(col, '+7 hours')`, so stored UTC ISO strings bucket into
 * local days/months/years.
 *
 * Revenue = Σ payment.amount of PAID / PARTIALLY_REFUNDED / REFUNDED payments
 * by paid_at, minus Σ completed refunds by refund date (refunds land in the
 * period they were made, not the period of the original payment).
 *
 * Discount value (validations, manual discounts) — what the discount was
 * worth in THB when it was granted:
 *   1. rules_json present (receipt validations) → Σ applied[].value, the money
 *      value the validation engine computed against the session fee at that
 *      moment;
 *   2. otherwise → amount + free_minutes × (hourly rate of the session's rate
 *      version ÷ 60);
 *   3. full waivers without a rule snapshot have no fixed value (null) and are
 *      counted separately.
 * Merchant breakdowns split a discount's value across the receipts that earned
 * it in proportion to each receipt's spend.
 */
import type { Request } from 'express';
import { q, json, type Row } from '../db/index.ts';
import { badRequest, r2 } from '../lib/http.ts';
import { provinceByCode } from '@pp/shared';
import { quote } from './sessions.ts';
import { rateForVersion } from './rates.ts';

export const TZ_OFFSET_MIN = 420;
const TZ_SQL = "'+7 hours'";
const DAY_MS = 86_400_000;
const PAID_STATUSES = "('PAID','PARTIALLY_REFUNDED','REFUNDED')";
const VALIDATION_TYPES = "('RECEIPT_VALIDATION','MANUAL_STAMP')";
export const PAYMENT_METHODS = ['CASH', 'PROMPTPAY', 'CARD', 'EWALLET'] as const;

export type Group = 'day' | 'month' | 'year';

// ------------------------------------------------------------------ time ---

/** YYYY-MM-DD of an instant in Bangkok. */
export function localDay(at: Date | string | number) {
  return new Date(new Date(at).getTime() + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** UTC ISO of local midnight starting the given YYYY-MM-DD. */
export function localMidnight(day: string) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - TZ_OFFSET_MIN * 60_000).toISOString();
}

export function todayRange(now = new Date()) {
  const day = localDay(now);
  const from = localMidnight(day);
  return { day, from, to: new Date(Date.parse(from) + DAY_MS - 1).toISOString() };
}

/**
 * Parse ?from&to. Accepts local dates (YYYY-MM-DD → whole local days) or ISO
 * instants. Defaults to the last 30 local days including today.
 */
export function parseRange(query: Record<string, unknown>, defaultDays = 30) {
  const parse = (v: unknown, end: boolean) => {
    if (typeof v !== 'string' || !v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const start = localMidnight(v);
      return end ? new Date(Date.parse(start) + DAY_MS - 1).toISOString() : start;
    }
    const t = Date.parse(v);
    if (Number.isNaN(t)) throw badRequest('VALIDATION', 'invalid date');
    return new Date(t).toISOString();
  };
  const today = todayRange();
  const to = parse(query.to, true) ?? today.to;
  const from = parse(query.from, false) ?? localMidnight(localDay(Date.parse(today.from) - (defaultDays - 1) * DAY_MS));
  if (from > to) throw badRequest('VALIDATION', 'from must be before to');
  if (Date.parse(to) - Date.parse(from) > 10 * 366 * DAY_MS) throw badRequest('VALIDATION', 'range too long');
  return { from, to };
}

/** SQL expression bucketing an ISO column into a local period key. */
function periodExpr(col: string, group: Group) {
  const len = group === 'day' ? 10 : group === 'month' ? 7 : 4;
  return `substr(datetime(${col}, ${TZ_SQL}), 1, ${len})`;
}

export function periodKey(at: string, group: Group) {
  const d = localDay(at);
  return group === 'day' ? d : group === 'month' ? d.slice(0, 7) : d.slice(0, 4);
}

/** Every period key between from and to (inclusive) so empty periods show up. */
export function periodKeys(from: string, to: string, group: Group): string[] {
  const out: string[] = [];
  const first = localDay(from);
  const last = localDay(to);
  if (group === 'day') {
    for (let t = Date.parse(`${first}T00:00:00Z`); ; t += DAY_MS) {
      const k = new Date(t).toISOString().slice(0, 10);
      if (k > last || out.length > 4000) break;
      out.push(k);
    }
  } else if (group === 'month') {
    let [y, m] = first.split('-').map(Number);
    const end = last.slice(0, 7);
    for (;;) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      if (k > end || out.length > 600) break;
      out.push(k);
      m++;
      if (m > 12) (m = 1), y++;
    }
  } else {
    for (let y = Number(first.slice(0, 4)); y <= Number(last.slice(0, 4)); y++) out.push(String(y));
  }
  return out;
}

// --------------------------------------------------------------- scoping ---

/** Sites the user may see, optionally narrowed to one requested site. */
export function visibleSites(req: Request, siteId?: number | null): Row[] {
  const scope = req.user?.siteIds ?? null;
  let sites = q.all('SELECT id, code, name, capacity FROM sites WHERE active=1 ORDER BY id');
  if (scope) sites = sites.filter((s) => scope.includes(s.id));
  if (siteId) sites = sites.filter((s) => s.id === siteId);
  return sites;
}

/** `col IN (…)` for the visible sites; null when the user sees everything and no site was requested. */
export function siteFilter(req: Request, col: string, siteId?: number | null): string | null {
  if (!siteId && !req.user?.siteIds) return null;
  const ids = visibleSites(req, siteId).map((s) => Number(s.id));
  return `${col} IN (${ids.join(',') || 0})`;
}

const and = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' AND ') || '1=1';
const inIds = (col: string, ids: number[]) => `${col} IN (${ids.map(Number).join(',') || 0})`;

// ------------------------------------------------------- discount value ---

const rateCache = new Map<number, number>();
function hourlyRate(versionId: number | null) {
  if (versionId == null) return rateForVersion(null).hourlyRate;
  if (!rateCache.has(versionId)) rateCache.set(versionId, rateForVersion(versionId).hourlyRate);
  return rateCache.get(versionId)!;
}

/** THB value of a discount row (see header). Expects rate_version_id joined in. */
export function discountValue(d: Row): number | null {
  const rules = json<Array<{ value?: number }> | null>(d.rules_json, null);
  if (Array.isArray(rules) && rules.some((r) => typeof r?.value === 'number')) {
    return r2(rules.reduce((a, r) => a + (Number(r.value) || 0), 0));
  }
  if (d.full_waiver && !d.amount && !d.free_minutes) return null;
  const minutes = Number(d.free_minutes) || 0;
  return r2((Number(d.amount) || 0) + (minutes ? (minutes * hourlyRate(d.rate_version_id ?? null)) / 60 : 0));
}

// ------------------------------------------------------------- dashboard ---

function siteKpis(siteIds: number[], today: { from: string; to: string }) {
  const S = (col: string) => inIds(col, siteIds);
  const count = (sql: string, ...p: unknown[]) => q.get<{ n: number }>(sql, ...p)!.n;

  const active = q.all(`SELECT * FROM parking_sessions WHERE status='ACTIVE' AND ${S('site_id')}`);
  let outstandingCount = 0;
  let outstandingAmount = 0;
  const now = new Date();
  for (const s of active) {
    if (s.exempt) continue;
    const due = quote(s, now).due;
    if (due > 0) {
      outstandingCount++;
      outstandingAmount += due;
    }
  }

  const entries = count(`SELECT COUNT(*) n FROM parking_sessions WHERE ${S('site_id')} AND entry_at BETWEEN ? AND ?`, today.from, today.to);
  const exits = count(`SELECT COUNT(*) n FROM parking_sessions WHERE ${S('site_id')} AND status='EXITED' AND exit_at BETWEEN ? AND ?`, today.from, today.to);

  const byMethod: Record<string, number> = {};
  for (const r of q.all(
    `SELECT p.method, SUM(p.amount) amt FROM payments p JOIN parking_sessions s ON s.id=p.session_id
      WHERE ${S('s.site_id')} AND p.status IN ${PAID_STATUSES} AND p.paid_at BETWEEN ? AND ? GROUP BY p.method`,
    today.from,
    today.to,
  )) byMethod[r.method] = r2(r.amt);
  const refunds = r2(
    q.get<{ amt: number }>(
      `SELECT COALESCE(SUM(r.amount),0) amt FROM refunds r JOIN payments p ON p.id=r.payment_id JOIN parking_sessions s ON s.id=p.session_id
        WHERE ${S('s.site_id')} AND r.status='COMPLETED' AND r.created_at BETWEEN ? AND ?`,
      today.from,
      today.to,
    )!.amt,
  );
  const gross = r2(Object.values(byMethod).reduce((a, b) => a + b, 0));

  const avg = q.get<{ m: number | null }>(
    `SELECT AVG((julianday(exit_at) - julianday(entry_at)) * 1440) m FROM parking_sessions
      WHERE ${S('site_id')} AND status='EXITED' AND exit_at BETWEEN ? AND ?`,
    today.from,
    today.to,
  )!.m;

  const discounts = q.all(
    `SELECT d.*, s.rate_version_id FROM parking_discounts d JOIN parking_sessions s ON s.id=d.session_id
      WHERE ${S('s.site_id')} AND d.status<>'REVOKED' AND d.created_at BETWEEN ? AND ?`,
    today.from,
    today.to,
  );
  const vals = discounts.filter((d) => d.type === 'RECEIPT_VALIDATION' || d.type === 'MANUAL_STAMP');
  const exempt = count(`SELECT COUNT(*) n FROM parking_sessions WHERE ${S('site_id')} AND exempt=1 AND entry_at BETWEEN ? AND ?`, today.from, today.to);

  return {
    occupied: active.length,
    entries,
    exits,
    revenue: { gross, refunds, net: r2(gross - refunds), byMethod },
    outstanding: { count: outstandingCount, amount: r2(outstandingAmount) },
    avgDurationMinutes: avg == null ? null : Math.round(avg),
    validations: {
      count: vals.length,
      spend: r2(vals.reduce((a, d) => a + (Number(d.total_spend) || 0), 0)),
      discountValue: r2(vals.reduce((a, d) => a + (discountValue(d) ?? 0), 0)),
    },
    waivers: discounts.filter((d) => d.type === 'WAIVER').length,
    manualDiscounts: discounts.filter((d) => d.type === 'MANUAL_DISCOUNT').length,
    exemptSessions: exempt,
    pendingReviews: count(`SELECT COUNT(*) n FROM detections WHERE review_status='PENDING' AND (${S('site_id')} OR site_id IS NULL)`),
  };
}

export function dashboard(req: Request) {
  const sites = visibleSites(req);
  const ids = sites.map((s) => Number(s.id));
  const today = todayRange();
  const scoped = !!req.user?.siteIds;

  const siteRows = sites.map((s) => {
    const zones = q.all(
      `SELECT z.id, z.name, z.capacity, (SELECT COUNT(*) FROM parking_sessions p WHERE p.zone_id=z.id AND p.status='ACTIVE') used
         FROM zones z WHERE z.site_id=? AND z.active=1 ORDER BY z.id`,
      s.id,
    );
    const unzoned = q.get<{ n: number }>("SELECT COUNT(*) n FROM parking_sessions WHERE site_id=? AND status='ACTIVE' AND zone_id IS NULL", s.id)!.n;
    return { id: s.id, code: s.code, name: s.name, capacity: s.capacity, unzoned, zones, kpis: siteKpis([s.id], today) };
  });

  const alertScope = scoped ? `(${inIds('site_id', ids)} OR site_id IS NULL)` : '1=1';
  const alertsBySeverity: Record<string, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
  for (const r of q.all(`SELECT severity, COUNT(*) n FROM alerts WHERE resolved_at IS NULL AND ${alertScope} GROUP BY severity`)) alertsBySeverity[r.severity] = r.n;
  const openAlerts = q.all(
    `SELECT a.*, s.name site_name FROM alerts a LEFT JOIN sites s ON s.id=a.site_id WHERE a.resolved_at IS NULL AND ${alertScope.replaceAll('site_id', 'a.site_id')}
      ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, a.created_at DESC LIMIT 10`,
  ).map(alertView);

  const deviceStatus: Record<string, number> = { ONLINE: 0, OFFLINE: 0, ERROR: 0, UNKNOWN: 0 };
  for (const r of q.all(`SELECT status, COUNT(*) n FROM devices WHERE active=1 AND ${scoped ? inIds('site_id', ids) : '1=1'} GROUP BY status`)) deviceStatus[r.status] = r.n;
  const problemDevices = q.all(
    `SELECT d.id, d.type, d.name, d.status, d.last_seen_at, d.last_error, g.name gate_name FROM devices d LEFT JOIN gates g ON g.id=d.gate_id
      WHERE d.active=1 AND d.status IN ('OFFLINE','ERROR') AND ${scoped ? inIds('d.site_id', ids) : '1=1'} ORDER BY d.status, d.name LIMIT 20`,
  );

  // Hourly entries / exits today (24 local-hour buckets).
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, entries: 0, exits: 0 }));
  const hourExpr = (col: string) => `CAST(strftime('%H', datetime(${col}, ${TZ_SQL})) AS INTEGER)`;
  for (const r of q.all(`SELECT ${hourExpr('entry_at')} h, COUNT(*) n FROM parking_sessions WHERE ${inIds('site_id', ids)} AND entry_at BETWEEN ? AND ? GROUP BY h`, today.from, today.to)) hourly[r.h].entries = r.n;
  for (const r of q.all(`SELECT ${hourExpr('exit_at')} h, COUNT(*) n FROM parking_sessions WHERE ${inIds('site_id', ids)} AND status='EXITED' AND exit_at BETWEEN ? AND ? GROUP BY h`, today.from, today.to)) hourly[r.h].exits = r.n;

  // Net revenue per local day for the last 30 days.
  const from30 = localMidnight(localDay(Date.parse(today.from) - 29 * DAY_MS));
  const rev = new Map(periodKeys(from30, today.to, 'day').map((k) => [k, { day: k, gross: 0, refunds: 0, net: 0 }]));
  for (const r of q.all(
    `SELECT ${periodExpr('p.paid_at', 'day')} k, SUM(p.amount) amt FROM payments p JOIN parking_sessions s ON s.id=p.session_id
      WHERE ${inIds('s.site_id', ids)} AND p.status IN ${PAID_STATUSES} AND p.paid_at BETWEEN ? AND ? GROUP BY k`,
    from30,
    today.to,
  )) {
    const e = rev.get(r.k);
    if (e) e.gross = r2(r.amt);
  }
  for (const r of q.all(
    `SELECT ${periodExpr('r.created_at', 'day')} k, SUM(r.amount) amt FROM refunds r JOIN payments p ON p.id=r.payment_id JOIN parking_sessions s ON s.id=p.session_id
      WHERE ${inIds('s.site_id', ids)} AND r.status='COMPLETED' AND r.created_at BETWEEN ? AND ? GROUP BY k`,
    from30,
    today.to,
  )) {
    const e = rev.get(r.k);
    if (e) e.refunds = r2(r.amt);
  }
  for (const e of rev.values()) e.net = r2(e.gross - e.refunds);

  const totals = siteKpis(ids, today);
  return {
    generatedAt: new Date().toISOString(),
    today,
    capacity: sites.reduce((a, s) => a + (s.capacity || 0), 0),
    totals,
    sites: siteRows,
    alerts: { bySeverity: alertsBySeverity, open: openAlerts },
    devices: { byStatus: deviceStatus, problems: problemDevices },
    hourly,
    revenue30d: [...rev.values()],
  };
}

// --------------------------------------------------------------- summary ---

export interface SummaryRow {
  period: string;
  entries: number;
  exits: number;
  revenue: number;
  revenueByMethod: Record<string, number>;
  refunds: number;
  netRevenue: number;
  avgDurationMinutes: number | null;
  validations: number;
  validatedSpend: number;
  discountValue: number;
  waivers: number;
  manualDiscounts: number;
  lostTickets: number;
}

export function summary(req: Request, opts: { from: string; to: string; group: Group; siteId?: number | null }) {
  const { from, to, group } = opts;
  const sf = (col: string) => siteFilter(req, col, opts.siteId);
  const rows = new Map<string, SummaryRow>(
    periodKeys(from, to, group).map((k) => [
      k,
      { period: k, entries: 0, exits: 0, revenue: 0, revenueByMethod: {}, refunds: 0, netRevenue: 0, avgDurationMinutes: null, validations: 0, validatedSpend: 0, discountValue: 0, waivers: 0, manualDiscounts: 0, lostTickets: 0 },
    ]),
  );
  const at = (k: string) => rows.get(k);

  for (const r of q.all(`SELECT ${periodExpr('entry_at', group)} k, COUNT(*) n FROM parking_sessions WHERE ${and(sf('site_id'))} AND entry_at BETWEEN ? AND ? GROUP BY k`, from, to)) {
    const e = at(r.k);
    if (e) e.entries = r.n;
  }
  for (const r of q.all(
    `SELECT ${periodExpr('exit_at', group)} k, COUNT(*) n, AVG((julianday(exit_at) - julianday(entry_at)) * 1440) m FROM parking_sessions
      WHERE ${and(sf('site_id'))} AND status='EXITED' AND exit_at BETWEEN ? AND ? GROUP BY k`,
    from,
    to,
  )) {
    const e = at(r.k);
    if (e) (e.exits = r.n), (e.avgDurationMinutes = r.m == null ? null : Math.round(r.m));
  }
  for (const r of q.all(
    `SELECT ${periodExpr('p.paid_at', group)} k, p.method, SUM(p.amount) amt FROM payments p JOIN parking_sessions s ON s.id=p.session_id
      WHERE ${and(sf('s.site_id'))} AND p.status IN ${PAID_STATUSES} AND p.paid_at BETWEEN ? AND ? GROUP BY k, p.method`,
    from,
    to,
  )) {
    const e = at(r.k);
    if (!e) continue;
    e.revenueByMethod[r.method] = r2(r.amt);
    e.revenue = r2(e.revenue + r.amt);
  }
  for (const r of q.all(
    `SELECT ${periodExpr('r.created_at', group)} k, SUM(r.amount) amt FROM refunds r JOIN payments p ON p.id=r.payment_id JOIN parking_sessions s ON s.id=p.session_id
      WHERE ${and(sf('s.site_id'))} AND r.status='COMPLETED' AND r.created_at BETWEEN ? AND ? GROUP BY k`,
    from,
    to,
  )) {
    const e = at(r.k);
    if (e) e.refunds = r2(r.amt);
  }
  for (const d of q.all(
    `SELECT d.*, s.rate_version_id FROM parking_discounts d JOIN parking_sessions s ON s.id=d.session_id
      WHERE ${and(sf('s.site_id'))} AND d.status<>'REVOKED' AND d.created_at BETWEEN ? AND ?`,
    from,
    to,
  )) {
    const e = at(periodKey(d.created_at, group));
    if (!e) continue;
    if (d.type === 'RECEIPT_VALIDATION' || d.type === 'MANUAL_STAMP') {
      e.validations++;
      e.validatedSpend = r2(e.validatedSpend + (Number(d.total_spend) || 0));
    } else if (d.type === 'WAIVER') e.waivers++;
    else if (d.type === 'MANUAL_DISCOUNT') e.manualDiscounts++;
    e.discountValue = r2(e.discountValue + (discountValue(d) ?? 0));
  }
  for (const r of q.all(
    `SELECT ${periodExpr('a.at', group)} k, COUNT(*) n FROM audit_logs a JOIN parking_sessions s ON s.id=a.session_id
      WHERE a.action='session.lost_ticket_reissue' AND ${and(sf('s.site_id'))} AND a.at BETWEEN ? AND ? GROUP BY k`,
    from,
    to,
  )) {
    const e = at(r.k);
    if (e) e.lostTickets = r.n;
  }
  const items = [...rows.values()];
  for (const e of items) e.netRevenue = r2(e.revenue - e.refunds);

  const sum = (f: (r: SummaryRow) => number) => r2(items.reduce((a, r) => a + f(r), 0));
  const byMethod: Record<string, number> = {};
  for (const r of items) for (const [m, v] of Object.entries(r.revenueByMethod)) byMethod[m] = r2((byMethod[m] ?? 0) + v);
  const exits = sum((r) => r.exits);
  const totals = {
    entries: sum((r) => r.entries),
    exits,
    revenue: sum((r) => r.revenue),
    revenueByMethod: byMethod,
    refunds: sum((r) => r.refunds),
    netRevenue: sum((r) => r.netRevenue),
    avgDurationMinutes: exits ? Math.round(items.reduce((a, r) => a + (r.avgDurationMinutes ?? 0) * r.exits, 0) / exits) : null,
    validations: sum((r) => r.validations),
    validatedSpend: sum((r) => r.validatedSpend),
    discountValue: sum((r) => r.discountValue),
    waivers: sum((r) => r.waivers),
    manualDiscounts: sum((r) => r.manualDiscounts),
    lostTickets: sum((r) => r.lostTickets),
  };
  return { from, to, group, siteId: opts.siteId ?? null, items, totals };
}

// ----------------------------------------------------------- validations ---

export function validationsByMerchant(req: Request, opts: { from: string; to: string; siteId?: number | null }) {
  const usages = q.all(
    `SELECT u.*, s.site_id, s.parking_no, s.plate_text, s.province, m.name merchant_name, m.code merchant_code
       FROM receipt_usages u JOIN parking_sessions s ON s.id=u.session_id LEFT JOIN merchants m ON m.id=u.merchant_id
      WHERE ${and(siteFilter(req, 's.site_id', opts.siteId))} AND u.created_at BETWEEN ? AND ? ORDER BY u.id`,
    opts.from,
    opts.to,
  );
  const discountIds = [...new Set(usages.map((u) => u.discount_id).filter(Boolean))] as number[];
  const discounts = new Map<number, Row>();
  if (discountIds.length) {
    for (const d of q.all(`SELECT d.*, s.rate_version_id FROM parking_discounts d JOIN parking_sessions s ON s.id=d.session_id WHERE ${inIds('d.id', discountIds)}`)) discounts.set(d.id, d);
  }
  const spendPerDiscount = new Map<number, number>();
  for (const u of usages) if (u.discount_id) spendPerDiscount.set(u.discount_id, (spendPerDiscount.get(u.discount_id) ?? 0) + (Number(u.amount) || 0));

  const merchants = new Map<string, { merchantId: number | null; code: string | null; name: string; receipts: number; validated: number; refundedAfter: number; revoked: number; external: number; spend: number; discountValue: number; sessions: Set<number> }>();
  const detail = usages.map((u) => {
    const d = u.discount_id ? discounts.get(u.discount_id) : undefined;
    const total = u.discount_id ? spendPerDiscount.get(u.discount_id) ?? 0 : 0;
    const value = d && d.status !== 'REVOKED' && total > 0 ? r2(((discountValue(d) ?? 0) * (Number(u.amount) || 0)) / total) : 0;
    const key = String(u.merchant_id ?? 'external');
    let m = merchants.get(key);
    if (!m) merchants.set(key, (m = { merchantId: u.merchant_id ?? null, code: u.merchant_code ?? null, name: u.merchant_name ?? 'ใบเสร็จภายนอก / ไม่ระบุร้าน', receipts: 0, validated: 0, refundedAfter: 0, revoked: 0, external: 0, spend: 0, discountValue: 0, sessions: new Set() }));
    m.receipts++;
    if (u.status === 'VALIDATED') m.validated++;
    else if (u.status === 'REFUNDED_AFTER_VALIDATION') m.refundedAfter++;
    else if (u.status === 'REVOKED') m.revoked++;
    if (u.external) m.external++;
    m.spend = r2(m.spend + (Number(u.amount) || 0));
    m.discountValue = r2(m.discountValue + value);
    m.sessions.add(u.session_id);
    return {
      id: u.id,
      at: u.created_at,
      receiptRef: u.receipt_ref,
      merchantId: u.merchant_id,
      merchantName: u.merchant_name,
      amount: u.amount,
      status: u.status,
      external: !!u.external,
      sessionId: u.session_id,
      parkingNo: u.parking_no,
      plateText: u.plate_text,
      province: provinceByCode(u.province)?.th ?? null,
      discountType: d?.type ?? null,
      discountValue: value,
      counter: u.counter,
    };
  });
  const items = [...merchants.values()].map(({ sessions, ...m }) => ({ ...m, sessions: sessions.size })).sort((a, b) => b.spend - a.spend);
  return {
    from: opts.from,
    to: opts.to,
    items,
    totals: {
      receipts: usages.length,
      spend: r2(items.reduce((a, m) => a + m.spend, 0)),
      discountValue: r2(items.reduce((a, m) => a + m.discountValue, 0)),
      sessions: new Set(usages.map((u) => u.session_id)).size,
    },
    detail,
  };
}

// ------------------------------------------------------------ exemptions ---

export function exemptions(req: Request, opts: { from: string; to: string; siteId?: number | null }) {
  const sf = siteFilter(req, 's.site_id', opts.siteId);
  const discountRows = q.all(
    `SELECT d.*, s.parking_no, s.plate_text, s.province, s.site_id, s.rate_version_id,
            cu.display_name created_by_name, cu.username created_by_username,
            au.display_name approved_by_name, au.username approved_by_username,
            ru.display_name revoked_by_name
       FROM parking_discounts d JOIN parking_sessions s ON s.id=d.session_id
       LEFT JOIN users cu ON cu.id=d.created_by LEFT JOIN users au ON au.id=d.approved_by LEFT JOIN users ru ON ru.id=d.revoked_by
      WHERE ${and(sf)} AND d.type IN ('WAIVER','MANUAL_DISCOUNT','PROMOTION') AND d.created_at BETWEEN ? AND ? ORDER BY d.created_at DESC`,
    opts.from,
    opts.to,
  ).map((d) => ({
    id: d.id,
    at: d.created_at,
    type: d.type,
    sessionId: d.session_id,
    parkingNo: d.parking_no,
    plateText: d.plate_text,
    province: provinceByCode(d.province)?.th ?? null,
    amount: d.amount,
    freeMinutes: d.free_minutes,
    fullWaiver: !!d.full_waiver,
    value: discountValue(d),
    reason: d.reason,
    source: d.source,
    status: d.status,
    createdBy: d.created_by_name ?? d.created_by_username ?? null,
    approvedBy: d.approved_by_name ?? d.approved_by_username ?? null,
    revokedBy: d.revoked_by_name ?? null,
    revokedReason: d.revoked_reason,
  }));

  const sessionRows = q.all(
    `SELECT s.*, ps.type pass_type, ps.holder_name, m.first_name, m.last_name,
            (SELECT pl.reason FROM plate_lists pl WHERE pl.plate_key=s.plate_key AND pl.list_type='EXEMPT' AND pl.active=1 LIMIT 1) exempt_reason
       FROM parking_sessions s LEFT JOIN passes ps ON ps.id=s.pass_id LEFT JOIN members m ON m.id=ps.member_id
      WHERE ${and(sf)} AND (s.exempt=1 OR s.pass_id IS NOT NULL) AND s.entry_at BETWEEN ? AND ? ORDER BY s.entry_at DESC`,
    opts.from,
    opts.to,
  ).map((s) => ({
    sessionId: s.id,
    parkingNo: s.parking_no,
    plateText: s.plate_text,
    province: provinceByCode(s.province)?.th ?? null,
    entryAt: s.entry_at,
    exitAt: s.exit_at,
    status: s.status,
    exempt: !!s.exempt,
    passId: s.pass_id,
    passType: s.pass_type ?? null,
    holder: s.holder_name ?? ([s.first_name, s.last_name].filter(Boolean).join(' ') || null),
    reason: s.pass_id ? `บัตรจอด ${s.pass_type}` : s.exempt_reason ?? 'รายชื่อยกเว้นค่าจอด',
  }));

  const waivers = discountRows.filter((d) => d.type === 'WAIVER');
  const manualDiscounts = discountRows.filter((d) => d.type !== 'WAIVER');
  return {
    from: opts.from,
    to: opts.to,
    totals: {
      waivers: waivers.filter((d) => d.status !== 'REVOKED').length,
      manualDiscounts: manualDiscounts.filter((d) => d.status !== 'REVOKED').length,
      manualDiscountValue: r2(manualDiscounts.filter((d) => d.status !== 'REVOKED').reduce((a, d) => a + (d.value ?? 0), 0)),
      exemptSessions: sessionRows.filter((s) => s.exempt && !s.passId).length,
      passSessions: sessionRows.filter((s) => s.passId).length,
    },
    waivers,
    manualDiscounts,
    exemptSessions: sessionRows.filter((s) => !s.passId),
    passSessions: sessionRows.filter((s) => s.passId),
  };
}

// ---------------------------------------------------------------- alerts ---

export function alertView(a: Row) {
  return {
    id: a.id,
    type: a.type,
    severity: a.severity,
    siteId: a.site_id,
    siteName: a.site_name ?? null,
    refType: a.ref_type,
    refId: a.ref_id,
    message: a.message,
    data: json(a.data_json, null),
    createdAt: a.created_at,
    acknowledgedBy: a.acknowledged_by,
    acknowledgedByName: a.acknowledged_by_name ?? null,
    acknowledgedAt: a.acknowledged_at,
    resolvedAt: a.resolved_at,
  };
}

// ----------------------------------------------------------------- audit ---

export interface AuditFilter {
  from?: string;
  to?: string;
  action?: string;
  username?: string;
  parkingNo?: string;
  receiptNo?: string;
  merchantId?: number;
  sessionId?: number;
  q?: string;
}

export function auditWhere(f: AuditFilter) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from) (where.push('a.at>=?'), params.push(f.from));
  if (f.to) (where.push('a.at<=?'), params.push(f.to));
  if (f.action) {
    if (f.action.endsWith('.*')) (where.push('a.action LIKE ?'), params.push(`${f.action.slice(0, -1)}%`));
    else (where.push('a.action=?'), params.push(f.action));
  }
  if (f.username) (where.push('(a.username LIKE ? OR a.approved_by_name LIKE ?)'), params.push(`%${f.username}%`, `%${f.username}%`));
  if (f.parkingNo) (where.push('a.parking_no LIKE ?'), params.push(`%${f.parkingNo.toUpperCase()}%`));
  if (f.receiptNo) (where.push('a.receipt_no LIKE ?'), params.push(`%${f.receiptNo}%`));
  if (f.merchantId) (where.push('a.merchant_id=?'), params.push(f.merchantId));
  if (f.sessionId) (where.push('a.session_id=?'), params.push(f.sessionId));
  if (f.q) {
    const like = `%${f.q}%`;
    where.push('(a.action LIKE ? OR a.entity_id LIKE ? OR a.reason LIKE ? OR a.before_json LIKE ? OR a.after_json LIKE ? OR a.meta_json LIKE ? OR a.username LIKE ? OR a.parking_no LIKE ? OR a.receipt_no LIKE ?)');
    params.push(like, like, like, like, like, like, like, like, like);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export const AUDIT_SELECT = `SELECT a.*, d.name device_name, d.type device_type, m.name merchant_name, s.name site_name
  FROM audit_logs a LEFT JOIN devices d ON d.id=a.device_id LEFT JOIN merchants m ON m.id=a.merchant_id LEFT JOIN sites s ON s.id=a.site_id`;

export function auditView(a: Row) {
  return {
    id: a.id,
    at: a.at,
    userId: a.user_id,
    username: a.username,
    role: a.role,
    action: a.action,
    entityType: a.entity_type,
    entityId: a.entity_id,
    siteId: a.site_id,
    siteName: a.site_name ?? null,
    deviceId: a.device_id,
    deviceName: a.device_name ?? null,
    deviceType: a.device_type ?? null,
    merchantId: a.merchant_id,
    merchantName: a.merchant_name ?? null,
    sessionId: a.session_id,
    parkingNo: a.parking_no,
    receiptNo: a.receipt_no,
    before: json(a.before_json, null),
    after: json(a.after_json, null),
    reason: a.reason,
    approvedBy: a.approved_by,
    approvedByName: a.approved_by_name,
    ip: a.ip,
    meta: json(a.meta_json, null),
  };
}

// ---------------------------------------------------------------- export ---

export interface Column {
  key: string;
  header: string;
  type?: 'money' | 'int' | 'number' | 'datetime' | 'text';
  width?: number;
}
export interface Table {
  title: string;
  columns: Column[];
  rows: Array<Record<string, unknown>>;
}

const EXPORT_LIMIT = 100_000;
const methodCols = (prefix = 'revenue_'): Column[] => PAYMENT_METHODS.map((m) => ({ key: `${prefix}${m}`, header: `รายได้ ${m}`, type: 'money' as const }));

export function exportTable(req: Request, type: string, range: { from: string; to: string }, extra: { group?: Group; siteId?: number | null; filter?: AuditFilter }): Table {
  const sf = (col: string) => siteFilter(req, col, extra.siteId);
  switch (type) {
    case 'summary': {
      const s = summary(req, { ...range, group: extra.group ?? 'day', siteId: extra.siteId });
      return {
        title: 'สรุปรายงาน',
        columns: [
          { key: 'period', header: 'ช่วงเวลา', width: 12 },
          { key: 'entries', header: 'รถเข้า', type: 'int' },
          { key: 'exits', header: 'รถออก', type: 'int' },
          { key: 'revenue', header: 'รายได้รวม', type: 'money' },
          ...methodCols(),
          { key: 'refunds', header: 'คืนเงิน', type: 'money' },
          { key: 'netRevenue', header: 'รายได้สุทธิ', type: 'money' },
          { key: 'avgDurationMinutes', header: 'เวลาจอดเฉลี่ย (นาที)', type: 'int' },
          { key: 'validations', header: 'จำนวนประทับตรา', type: 'int' },
          { key: 'validatedSpend', header: 'ยอดซื้อที่ใช้สิทธิ์', type: 'money' },
          { key: 'discountValue', header: 'มูลค่าส่วนลด', type: 'money' },
          { key: 'waivers', header: 'ยกเว้นค่าจอด', type: 'int' },
          { key: 'manualDiscounts', header: 'ส่วนลดโดยเจ้าหน้าที่', type: 'int' },
          { key: 'lostTickets', header: 'บัตรหาย', type: 'int' },
        ],
        rows: [...s.items, { ...s.totals, period: 'รวม' }].map((r) => ({ ...r, ...Object.fromEntries(PAYMENT_METHODS.map((m) => [`revenue_${m}`, r.revenueByMethod[m] ?? 0])) })),
      };
    }
    case 'sessions': {
      const rows = q.all(
        `SELECT s.*, st.name site_name, eg.name entry_gate, xg.name exit_gate,
                (SELECT COALESCE(SUM(p.amount - p.refunded_amount),0) FROM payments p WHERE p.session_id=s.id AND p.status IN ('PAID','PARTIALLY_REFUNDED')) paid
           FROM parking_sessions s JOIN sites st ON st.id=s.site_id LEFT JOIN gates eg ON eg.id=s.entry_gate_id LEFT JOIN gates xg ON xg.id=s.exit_gate_id
          WHERE ${and(sf('s.site_id'))} AND s.entry_at BETWEEN ? AND ? ORDER BY s.entry_at LIMIT ${EXPORT_LIMIT}`,
        range.from,
        range.to,
      );
      return {
        title: 'รายการจอดรถ',
        columns: [
          { key: 'parking_no', header: 'Parking No', width: 18 },
          { key: 'site_name', header: 'สาขา' },
          { key: 'plate_text', header: 'ทะเบียน' },
          { key: 'province_name', header: 'จังหวัด', width: 16 },
          { key: 'vehicle_type', header: 'ประเภทรถ' },
          { key: 'entry_at', header: 'เวลาเข้า', type: 'datetime' },
          { key: 'exit_at', header: 'เวลาออก', type: 'datetime' },
          { key: 'duration', header: 'ระยะเวลา (นาที)', type: 'int' },
          { key: 'entry_gate', header: 'ทางเข้า' },
          { key: 'exit_gate', header: 'ทางออก' },
          { key: 'status', header: 'สถานะ' },
          { key: 'payment_status', header: 'สถานะชำระ' },
          { key: 'paid', header: 'ชำระแล้ว', type: 'money' },
          { key: 'plate_source', header: 'แหล่งที่มาทะเบียน' },
          { key: 'flag_text', header: 'Flags', width: 24 },
        ],
        rows: rows.map((s) => ({
          ...s,
          province_name: provinceByCode(s.province)?.th ?? '',
          duration: s.exit_at ? Math.round((Date.parse(s.exit_at) - Date.parse(s.entry_at)) / 60000) : null,
          flag_text: [...json<string[]>(s.flags, []), s.lost_ticket ? 'LOST_TICKET' : '', s.exempt ? 'EXEMPT' : ''].filter(Boolean).join(', '),
        })),
      };
    }
    case 'payments': {
      const rows = q.all(
        `SELECT p.*, s.parking_no, s.plate_text, s.province, u.display_name created_by_name
           FROM payments p JOIN parking_sessions s ON s.id=p.session_id LEFT JOIN users u ON u.id=p.created_by
          WHERE ${and(sf('s.site_id'))} AND p.created_at BETWEEN ? AND ? ORDER BY p.id LIMIT ${EXPORT_LIMIT}`,
        range.from,
        range.to,
      );
      return {
        title: 'การชำระเงิน',
        columns: [
          { key: 'id', header: 'Payment ID', type: 'int' },
          { key: 'created_at', header: 'สร้างเมื่อ', type: 'datetime' },
          { key: 'paid_at', header: 'ชำระเมื่อ', type: 'datetime' },
          { key: 'parking_no', header: 'Parking No', width: 18 },
          { key: 'plate', header: 'ทะเบียน', width: 22 },
          { key: 'method', header: 'วิธีชำระ' },
          { key: 'gateway', header: 'Gateway' },
          { key: 'gateway_ref', header: 'Gateway Ref', width: 24 },
          { key: 'channel', header: 'ช่องทาง' },
          { key: 'status', header: 'สถานะ' },
          { key: 'amount', header: 'จำนวนเงิน', type: 'money' },
          { key: 'refunded_amount', header: 'คืนเงินแล้ว', type: 'money' },
          { key: 'needs_refund_text', header: 'ชำระซ้ำ (ต้องคืน)' },
          { key: 'created_by_name', header: 'ผู้รับเงิน' },
        ],
        rows: rows.map((p) => ({ ...p, plate: `${p.plate_text ?? ''} ${provinceByCode(p.province)?.th ?? ''}`.trim(), needs_refund_text: p.needs_refund ? 'YES' : '' })),
      };
    }
    case 'validations': {
      const v = validationsByMerchant(req, { ...range, siteId: extra.siteId });
      return {
        title: 'การประทับตรา (Validation)',
        columns: [
          { key: 'at', header: 'เวลา', type: 'datetime' },
          { key: 'merchantName', header: 'ร้านค้า', width: 22 },
          { key: 'receiptRef', header: 'เลขที่ใบเสร็จ', width: 28 },
          { key: 'amount', header: 'ยอดซื้อ', type: 'money' },
          { key: 'status', header: 'สถานะ', width: 22 },
          { key: 'parkingNo', header: 'Parking No', width: 18 },
          { key: 'plateText', header: 'ทะเบียน' },
          { key: 'province', header: 'จังหวัด' },
          { key: 'discountType', header: 'ประเภทส่วนลด', width: 20 },
          { key: 'discountValue', header: 'มูลค่าส่วนลด', type: 'money' },
          { key: 'counter', header: 'จุดบริการ' },
        ],
        rows: v.detail,
      };
    }
    case 'exemptions': {
      const e = exemptions(req, { ...range, siteId: extra.siteId });
      const label: Record<string, string> = { WAIVER: 'ยกเว้นค่าจอด', MANUAL_DISCOUNT: 'ส่วนลดโดยเจ้าหน้าที่', PROMOTION: 'โปรโมชั่น' };
      return {
        title: 'การยกเว้น / ส่วนลด',
        columns: [
          { key: 'at', header: 'เวลา', type: 'datetime' },
          { key: 'kind', header: 'ประเภท', width: 20 },
          { key: 'parkingNo', header: 'Parking No', width: 18 },
          { key: 'plateText', header: 'ทะเบียน' },
          { key: 'province', header: 'จังหวัด' },
          { key: 'amount', header: 'ส่วนลด (บาท)', type: 'money' },
          { key: 'freeMinutes', header: 'นาทีฟรี', type: 'int' },
          { key: 'value', header: 'มูลค่า', type: 'money' },
          { key: 'holder', header: 'ผู้ถือบัตร' },
          { key: 'reason', header: 'เหตุผล', width: 30 },
          { key: 'createdBy', header: 'ผู้ทำรายการ' },
          { key: 'approvedBy', header: 'ผู้อนุมัติ' },
          { key: 'status', header: 'สถานะ' },
        ],
        rows: [
          ...[...e.waivers, ...e.manualDiscounts].map((d) => ({ ...d, kind: label[d.type] ?? d.type })),
          ...[...e.exemptSessions, ...e.passSessions].map((s) => ({ ...s, at: s.entryAt, kind: s.passId ? `บัตรจอด ${s.passType}` : 'รถยกเว้นค่าจอด' })),
        ].sort((a, b) => String(a.at).localeCompare(String(b.at))),
      };
    }
    case 'audit': {
      const w = auditWhere({ ...extra.filter, from: range.from, to: range.to });
      const rows = q.all(`${AUDIT_SELECT} ${w.sql} ORDER BY a.id LIMIT ${EXPORT_LIMIT}`, ...w.params).map(auditView);
      return {
        title: 'Audit Log',
        columns: [
          { key: 'at', header: 'เวลา', type: 'datetime' },
          { key: 'username', header: 'ผู้ใช้' },
          { key: 'role', header: 'บทบาท' },
          { key: 'action', header: 'การกระทำ', width: 26 },
          { key: 'entity', header: 'รายการ', width: 18 },
          { key: 'parkingNo', header: 'Parking No', width: 18 },
          { key: 'receiptNo', header: 'เลขที่ใบเสร็จ', width: 26 },
          { key: 'merchantName', header: 'ร้านค้า' },
          { key: 'deviceName', header: 'อุปกรณ์' },
          { key: 'reason', header: 'เหตุผล', width: 30 },
          { key: 'approvedByName', header: 'ผู้อนุมัติ' },
          { key: 'beforeText', header: 'ก่อน', width: 40 },
          { key: 'afterText', header: 'หลัง', width: 40 },
          { key: 'ip', header: 'IP' },
        ],
        rows: rows.map((a) => ({
          ...a,
          entity: [a.entityType, a.entityId].filter(Boolean).join(':'),
          beforeText: a.before == null ? '' : JSON.stringify(a.before),
          afterText: a.after == null ? '' : JSON.stringify(a.after),
        })),
      };
    }
    default:
      throw badRequest('VALIDATION', 'unknown export type');
  }
}

/** Local "dd/mm/yyyy HH:MM" for spreadsheets. */
function localDateTime(iso: string) {
  const d = new Date(Date.parse(iso) + TZ_OFFSET_MIN * 60_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`;
}

function cellText(v: unknown, c: Column): string {
  if (v === null || v === undefined || v === '') return '';
  if (c.type === 'datetime' && typeof v === 'string') return localDateTime(v);
  if (c.type === 'money') return (Number(v) || 0).toFixed(2);
  return String(v);
}

function csvEscape(s: string) {
  // Neutralise spreadsheet formulas (CSV injection) but keep negative numbers.
  const v = /^[=+@\t\r]/.test(s) || (s.startsWith('-') && !/^-\d/.test(s)) ? `'${s}` : s;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV with UTF-8 BOM so Excel opens Thai text correctly. */
export function toCsv(t: Table): Buffer {
  const lines = [t.columns.map((c) => csvEscape(c.header)).join(',')];
  for (const r of t.rows) lines.push(t.columns.map((c) => csvEscape(cellText(r[c.key], c))).join(','));
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')]);
}

export async function toXlsx(t: Table, meta: { from: string; to: string; generatedBy: string }): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smart Parking';
  wb.created = new Date();
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.mergeCells(1, 1, 1, Math.max(1, t.columns.length));
  ws.getCell(1, 1).value = t.title;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, Math.max(1, t.columns.length));
  ws.getCell(2, 1).value = `ช่วงเวลา ${localDateTime(meta.from)} – ${localDateTime(meta.to)} · ออกรายงานโดย ${meta.generatedBy} เมื่อ ${localDateTime(new Date().toISOString())}`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' } };

  const header = ws.getRow(3);
  t.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? (c.type === 'datetime' ? 17 : c.type === 'money' ? 13 : Math.max(10, c.header.length + 2));
    if (c.type === 'money') col.numFmt = '#,##0.00';
    else if (c.type === 'int') col.numFmt = '#,##0';
    else if (c.type === 'datetime') col.numFmt = 'dd/mm/yyyy hh:mm';
  });
  header.height = 22;

  for (const r of t.rows) {
    ws.addRow(
      t.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined || v === '') return null;
        if (c.type === 'money' || c.type === 'int' || c.type === 'number') return Number(v) || 0;
        // Excel has no time zones: store the Bangkok wall-clock time as a naive date.
        if (c.type === 'datetime' && typeof v === 'string') return new Date(Date.parse(v) + TZ_OFFSET_MIN * 60_000);
        return typeof v === 'object' ? JSON.stringify(v) : v;
      }),
    );
  }
  const last = ws.lastRow;
  if (last && t.rows.length && String(t.rows[t.rows.length - 1][t.columns[0].key]) === 'รวม') last.font = { bold: true };
  if (t.rows.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + t.rows.length, column: t.columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

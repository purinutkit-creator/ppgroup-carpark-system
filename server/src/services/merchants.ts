/**
 * Merchant lifecycle: registration → approval (Merchant ID, Branch B01,
 * owner account, POS device key) → activation / suspension / closure, plus
 * merchant-specific parking validation promotions and portal statistics.
 */
import crypto from 'node:crypto';
import type { ValidationRule } from '@pp/shared';
import { q, json, tx, nowIso, type Row } from '../db/index.ts';
import { hashPassword, randomToken, sha256 } from '../lib/crypto.ts';
import { badRequest, conflict, notFound, r2 } from '../lib/http.ts';

export const MERCHANT_STATUSES = ['PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'REJECTED'] as const;
export type MerchantStatus = (typeof MERCHANT_STATUSES)[number];

export interface ReceiptInfo {
  header?: string;
  footer?: string;
  vatRegistered?: boolean;
  taxId?: string;
  branchName?: string;
  vatMode?: 'INCLUDED' | 'EXCLUDED';
  vatRate?: number;
  serviceChargePercent?: number;
  promptPayId?: string;
}

export function getMerchant(id: number): Row {
  const m = q.get('SELECT * FROM merchants WHERE id=?', id);
  if (!m) throw notFound('MERCHANT_NOT_FOUND');
  return m;
}

/** Public shape (never exposes verification_key). */
export function merchantView(m: Row) {
  const { verification_key: _vk, receipt_info_json, contact_json, ...rest } = m;
  return { ...rest, receipt_info: json<ReceiptInfo>(receipt_info_json, {}), contact: json<Record<string, string>>(contact_json, {}) };
}

export function siteTz(siteId: number | null | undefined): number {
  if (!siteId) return 420;
  return q.get<{ tz_offset: number }>('SELECT tz_offset FROM sites WHERE id=?', siteId)?.tz_offset ?? 420;
}

/** Next free Merchant ID: M + 6 digits, one above the highest issued. */
export function nextMerchantCode(): string {
  const rows = q.all<{ code: string }>("SELECT code FROM merchants WHERE code LIKE 'M%'");
  const max = rows.reduce((m, r) => Math.max(m, Number(/^M(\d+)$/.exec(r.code)?.[1] ?? 0)), 0);
  return `M${String(max + 1).padStart(6, '0')}`;
}

export function registrationRef(id: number, createdAt: string): string {
  return `REG-${createdAt.slice(0, 10).replace(/-/g, '')}-${String(id).padStart(5, '0')}`;
}

function uniqueUsername(base: string): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'merchant';
  let name = clean;
  for (let i = 2; q.get('SELECT 1 FROM users WHERE username=?', name); i++) name = `${clean}${i}`;
  return name;
}

export const tempPassword = () => randomToken(9);
export const randomPin = (digits = 6) => String(crypto.randomInt(0, 10 ** digits)).padStart(digits, '0');

export function createPosDevice(merchant: Row, name?: string) {
  const key = `pos_${randomToken(24)}`;
  const n = q.get<{ n: number }>("SELECT COUNT(*) n FROM devices WHERE type='POS' AND merchant_id=?", merchant.id)!.n;
  const id = q.insert('devices', {
    type: 'POS',
    name: name || `POS ${merchant.name} #${n + 1}`,
    site_id: merchant.site_id ?? null,
    merchant_id: merchant.id,
    api_key_hash: sha256(key),
    connection_json: '{}',
    settings_json: '{}',
  });
  return { id, key };
}

/** PENDING → APPROVED with every credential generated (returned once, stored hashed). */
export function approveMerchant(id: number, approverId: number) {
  return tx(() => {
    const m = getMerchant(id);
    if (m.status !== 'PENDING') throw conflict('INVALID_STATUS', `merchant is ${m.status}`);
    const code = m.code ?? nextMerchantCode();
    const siteId = m.site_id ?? q.get<{ id: number }>('SELECT id FROM sites WHERE active=1 ORDER BY id LIMIT 1')?.id ?? null;
    q.update('merchants', id, {
      code,
      site_id: siteId,
      status: 'APPROVED',
      verification_key: m.verification_key ?? randomToken(24),
      approved_by: approverId,
      approved_at: nowIso(),
      status_reason: null,
    });
    const info = json<ReceiptInfo>(m.receipt_info_json, {});
    let branch = q.get('SELECT * FROM merchant_branches WHERE merchant_id=? AND code=?', id, 'B01');
    if (!branch) {
      const bid = q.insert('merchant_branches', { merchant_id: id, code: 'B01', name: info.branchName || 'สาขาหลัก', site_id: siteId });
      branch = q.get('SELECT * FROM merchant_branches WHERE id=?', bid)!;
    }
    const username = uniqueUsername(m.email ? String(m.email).split('@')[0] : String(m.phone));
    const password = tempPassword();
    const pin = randomPin();
    const userId = q.insert('users', {
      username,
      display_name: `${m.owner_first_name} ${m.owner_last_name}`.trim(),
      password_hash: hashPassword(password),
      pin_hash: hashPassword(pin),
      role: 'MERCHANT_OWNER',
      merchant_id: id,
      branch_id: branch.id,
    });
    const fresh = getMerchant(id);
    const device = createPosDevice(fresh);
    return {
      merchant: merchantView(fresh),
      branch,
      credentials: { userId, username, temporaryPassword: password, pin },
      posDevice: { id: device.id, key: device.key },
    };
  });
}

const TRANSITIONS: Record<string, { from: MerchantStatus[]; to: MerchantStatus }> = {
  activate: { from: ['APPROVED', 'SUSPENDED'], to: 'ACTIVE' },
  suspend: { from: ['APPROVED', 'ACTIVE'], to: 'SUSPENDED' },
  close: { from: ['PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED'], to: 'CLOSED' },
  reactivate: { from: ['SUSPENDED', 'CLOSED'], to: 'ACTIVE' },
  reject: { from: ['PENDING'], to: 'REJECTED' },
};
export type MerchantAction = keyof typeof TRANSITIONS;
export const MERCHANT_ACTIONS = Object.keys(TRANSITIONS) as MerchantAction[];

export function transitionMerchant(id: number, action: MerchantAction, reason: string | null) {
  const t = TRANSITIONS[action];
  if (!t) throw badRequest('INVALID_ACTION');
  return tx(() => {
    const m = getMerchant(id);
    if (!t.from.includes(m.status)) throw conflict('INVALID_STATUS', `cannot ${action} a ${m.status} merchant`);
    if (t.to === 'ACTIVE' && !m.code) throw conflict('NOT_APPROVED');
    q.update('merchants', id, { status: t.to, status_reason: reason });
    if (t.to !== 'ACTIVE') {
      // Sign merchant users out immediately; login is refused while not ACTIVE/APPROVED.
      if (t.to !== 'APPROVED') q.run('DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM users WHERE merchant_id=?)', id);
    }
    return { before: m.status, after: t.to, merchant: merchantView(getMerchant(id)) };
  });
}

export function listMerchants(opts: { status?: string; q?: string; limit: number; offset: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    where.push('m.status=?');
    params.push(opts.status);
  }
  if (opts.q) {
    where.push('(m.name LIKE ? OR m.code LIKE ? OR m.phone LIKE ? OR m.email LIKE ? OR m.unit_no LIKE ?)');
    const like = `%${opts.q}%`;
    params.push(like, like, like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = q.get<{ n: number }>(`SELECT COUNT(*) n FROM merchants m ${w}`, ...params)!.n;
  const items = q.all(
    `SELECT m.*, (SELECT COUNT(*) FROM merchant_branches b WHERE b.merchant_id=m.id) branch_count,
            (SELECT COALESCE(SUM(total-refunded_amount),0) FROM pos_sales s WHERE s.merchant_id=m.id AND s.status<>'VOIDED' AND s.issued_at>=?) sales_30d
       FROM merchants m ${w} ORDER BY CASE m.status WHEN 'PENDING' THEN 0 ELSE 1 END, m.id DESC LIMIT ? OFFSET ?`,
    new Date(Date.now() - 30 * 86400_000).toISOString(),
    ...params,
    opts.limit,
    opts.offset,
  ).map((m) => ({ ...merchantView(m), reference: registrationRef(m.id, m.created_at) }));
  const counts = Object.fromEntries(q.all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM merchants GROUP BY status').map((r) => [r.status, r.n]));
  return { items, total, counts };
}

export function merchantDetail(id: number) {
  const m = getMerchant(id);
  return {
    merchant: { ...merchantView(m), reference: registrationRef(m.id, m.created_at) },
    branches: q.all('SELECT * FROM merchant_branches WHERE merchant_id=? ORDER BY code', id),
    users: q.all(
      `SELECT u.id, u.username, u.display_name, u.role, u.branch_id, u.active, u.last_login_at, u.created_at, b.code branch_code
         FROM users u LEFT JOIN merchant_branches b ON b.id=u.branch_id WHERE u.merchant_id=? ORDER BY u.role, u.username`,
      id,
    ),
    devices: q.all("SELECT id, name, type, status, last_seen_at, active, settings_json, created_at FROM devices WHERE merchant_id=? AND type IN ('POS','DISPLAY','PRINTER') ORDER BY id", id),
    stats: merchantStats(id),
  };
}

/** Local-day ISO boundaries for a site timezone. */
export function localDayRange(tz: number, offsetDays = 0) {
  const now = new Date(Date.now() + tz * 60_000);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays) - tz * 60_000;
  return { from: new Date(start).toISOString(), to: new Date(start + 86400_000 - 1).toISOString() };
}

/**
 * Parking discount value generated by a merchant's receipts.
 * Method: each ACTIVE parking discount stores the money value of every applied
 * reward (rules_json[].value, valued against the session fee when applied;
 * falls back to the discount's fixed amount). When several receipts were
 * combined into one discount, the value is apportioned to each receipt by its
 * share of the discount's total purchase amount (usage.amount / Σ amount).
 */
export function parkingDiscountValue(merchantId: number, from?: string, to?: string): { receipts: number; purchase: number; discountValue: number } {
  const rows = q.all(
    `SELECT u.amount, u.discount_id, d.amount d_amount, d.rules_json, d.status d_status,
            (SELECT SUM(x.amount) FROM receipt_usages x WHERE x.discount_id=u.discount_id) d_spend
       FROM receipt_usages u LEFT JOIN parking_discounts d ON d.id=u.discount_id
      WHERE u.merchant_id=? AND u.external=0 ${from ? 'AND u.created_at>=?' : ''} ${to ? 'AND u.created_at<=?' : ''}`,
    merchantId,
    ...[from, to].filter(Boolean),
  );
  let discountValue = 0;
  let purchase = 0;
  for (const r of rows) {
    purchase += r.amount;
    if (r.d_status !== 'ACTIVE') continue;
    const applied = json<Array<{ value?: number }>>(r.rules_json, []);
    const value = applied.length ? applied.reduce((s, a) => s + (Number(a.value) || 0), 0) : Number(r.d_amount) || 0;
    const share = r.d_spend > 0 ? r.amount / r.d_spend : 1;
    discountValue += value * share;
  }
  return { receipts: rows.length, purchase: r2(purchase), discountValue: r2(discountValue) };
}

export function merchantStats(merchantId: number) {
  const m = getMerchant(merchantId);
  const tz = siteTz(m.site_id);
  const today = localDayRange(tz);
  const sales = q.get(
    `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status<>'VOIDED' THEN total-refunded_amount ELSE 0 END),0) net,
            SUM(status='VOIDED') voids, COALESCE(SUM(refunded_amount),0) refunds, SUM(status IN ('REFUNDED','PARTIALLY_REFUNDED')) refund_n
       FROM pos_sales WHERE merchant_id=? AND issued_at BETWEEN ? AND ?`,
    merchantId,
    today.from,
    today.to,
  )!;
  const pv = parkingDiscountValue(merchantId, today.from, today.to);
  const trendFrom = localDayRange(tz, -29).from;
  const trendRows = q.all<{ d: string; net: number; n: number }>(
    `SELECT date(issued_at, ?) d, COALESCE(SUM(total-refunded_amount),0) net, COUNT(*) n
       FROM pos_sales WHERE merchant_id=? AND status<>'VOIDED' AND issued_at>=? GROUP BY d ORDER BY d`,
    `${tz >= 0 ? '+' : ''}${tz} minutes`,
    merchantId,
    trendFrom,
  );
  const byDay = new Map(trendRows.map((r) => [r.d, r]));
  const trend = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.parse(localDayRange(tz, i - 29).from) + tz * 60_000).toISOString().slice(0, 10);
    const r = byDay.get(d);
    return { date: d, net: r2(r?.net ?? 0), count: r?.n ?? 0 };
  });
  const allTime = q.get<{ n: number; net: number }>(
    "SELECT COUNT(*) n, COALESCE(SUM(total-refunded_amount),0) net FROM pos_sales WHERE merchant_id=? AND status<>'VOIDED'",
    merchantId,
  )!;
  return {
    today: {
      sales: r2(sales.net),
      transactions: sales.n ?? 0,
      voids: sales.voids ?? 0,
      refunds: r2(sales.refunds),
      refundCount: sales.refund_n ?? 0,
      receiptsValidated: pv.receipts,
      validatedPurchase: pv.purchase,
      parkingDiscountValue: pv.discountValue,
    },
    allTime: { transactions: allTime.n, sales: r2(allTime.net), ...parkingDiscountValue(merchantId) },
    staffCount: q.get<{ n: number }>('SELECT COUNT(*) n FROM users WHERE merchant_id=? AND active=1', merchantId)!.n,
    devices: q.get<{ n: number }>("SELECT COUNT(*) n FROM devices WHERE merchant_id=? AND type='POS' AND active=1", merchantId)!.n,
    trend,
    discountMethod:
      'มูลค่าส่วนลดจอดรถ = มูลค่ารางวัลที่ใช้จริงของส่วนลดแต่ละรายการ (สถานะ ACTIVE) × สัดส่วนยอดซื้อของใบเสร็จร้านนี้ต่อยอดซื้อรวมที่ใช้กับส่วนลดนั้น',
  };
}

// ------------------------------------------------------------ promotions ---

export const PROMOTION_KINDS = ['TIER', 'STEP', 'ANY_PURCHASE'] as const;

/** Validate & normalise a promotion body into validation_rules columns. */
export function promotionFromBody(b: Record<string, any>, merchantIds: number[]) {
  const name = String(b.name ?? '').trim();
  if (!name) throw badRequest('VALIDATION', 'name is required');
  const kind = String(b.kind ?? '');
  if (!PROMOTION_KINDS.includes(kind as never)) throw badRequest('VALIDATION', 'kind must be TIER, STEP or ANY_PURCHASE');
  const reward = (r: any) => {
    const type = String(r?.type ?? '');
    if (type === 'FULL') return { type: 'FULL' as const };
    if (type !== 'AMOUNT' && type !== 'MINUTES') throw badRequest('VALIDATION', 'reward.type must be AMOUNT, MINUTES or FULL');
    const value = Number(r.value);
    if (!(value > 0)) throw badRequest('VALIDATION', 'reward.value must be > 0');
    return { type, value } as { type: 'AMOUNT' | 'MINUTES'; value: number };
  };
  const cfg: Partial<ValidationRule> = { kind: kind as ValidationRule['kind'], merchantIds };
  if (kind === 'TIER') {
    const tiers = Array.isArray(b.tiers) ? b.tiers : [];
    if (!tiers.length) throw badRequest('VALIDATION', 'tiers required');
    cfg.tiers = tiers.map((t: any) => ({ minSpend: Math.max(0, Number(t.minSpend) || 0), reward: reward(t.reward) }));
  } else if (kind === 'STEP') {
    const every = Number(b.step?.every);
    if (!(every > 0)) throw badRequest('VALIDATION', 'step.every must be > 0');
    const rw = reward(b.step?.reward);
    if (rw.type === 'FULL') throw badRequest('VALIDATION', 'step reward cannot be FULL');
    cfg.step = { every, reward: rw, max: b.step?.max ? Number(b.step.max) : null };
  } else {
    cfg.anyPurchase = { minSpend: Number(b.anyPurchase?.minSpend) || 0, reward: reward(b.anyPurchase?.reward) };
  }
  for (const k of ['daysOfWeek', 'startDate', 'endDate', 'startTime', 'endTime', 'siteIds'] as const) {
    if (b[k] !== undefined && b[k] !== '' && b[k] !== null) (cfg as any)[k] = b[k];
  }
  return {
    name: name.slice(0, 120),
    config: cfg,
    priority: Number.isFinite(Number(b.priority)) ? Math.trunc(Number(b.priority)) : 5,
    combinable: b.combinable === false || b.combinable === 0 ? 0 : 1,
    active: b.active === false || b.active === 0 ? 0 : 1,
  };
}

export function promotionView(r: Row) {
  return { id: r.id, name: r.name, scope: r.scope, priority: r.priority, combinable: !!r.combinable, active: !!r.active, ...json<Record<string, unknown>>(r.config_json, {}), updated_at: r.updated_at };
}

export function merchantPromotions(merchantId: number) {
  return q
    .all("SELECT * FROM validation_rules WHERE scope='MERCHANT' ORDER BY priority DESC, id")
    .filter((r) => json<{ merchantIds?: number[] }>(r.config_json, {}).merchantIds?.includes(merchantId))
    .map(promotionView);
}

/**
 * Receipt verification + parking validation.
 * A receipt barcode/QR carries only a reference (`PV1.<receipt_no>.<token>`);
 * amounts, payment state, refund/void state and prior use are read from the
 * POS database on the server. Each receipt can be used once (receipt_usages
 * has a UNIQUE receipt_ref).
 */
import { calculateFee, evaluateRewards, type Reward, type ValidationRule, type RewardResult } from '@pp/shared';
import { q, json, tx, nowIso, type Row } from '../db/index.ts';
import { safeEqual } from '../lib/crypto.ts';
import { HttpError, conflict, notFound, r2 } from '../lib/http.ts';
import { getSetting } from '../lib/settings.ts';
import { raiseAlert } from '../lib/alerts.ts';
import { emit } from '../lib/realtime.ts';
import { getSession, quote, refreshPaymentStatus } from './sessions.ts';
import { holidayDates, rateForVersion } from './rates.ts';

export type ReceiptStatusCode =
  | 'VERIFIED'
  | 'RECEIPT_NOT_FOUND'
  | 'INVALID_TOKEN'
  | 'MERCHANT_NOT_ELIGIBLE'
  | 'RECEIPT_NOT_PAID'
  | 'RECEIPT_VOIDED'
  | 'RECEIPT_REFUNDED'
  | 'RECEIPT_ALREADY_USED'
  | 'RECEIPT_EXPIRED'
  | 'SITE_NOT_ALLOWED'
  | 'BELOW_MIN_SPEND';

export interface VerifiedReceipt {
  code: ReceiptStatusCode;
  ok: boolean;
  reasons: ReceiptStatusCode[];
  receipt: null | {
    saleId: number;
    receiptNo: string;
    merchantId: number;
    merchantCode: string;
    merchantName: string;
    branchCode: string;
    issuedAt: string;
    subtotal: number;
    discount: number;
    total: number;
    status: string;
    refundedAmount: number;
    validationStatus: string;
    usedBy?: { parkingNo: string; plateText: string | null; at: string } | null;
  };
}

/** Parse "PV1.<receipt_no>.<token>" (also tolerates a URL wrapping it). */
export function parseReceiptCode(raw: string): { receiptNo: string; token: string | null } {
  const s = decodeURIComponent(String(raw).trim()).replace(/^.*[?&]r=/, '');
  const m = /^PV1[.:]([A-Z0-9-]+)[.:]([A-Za-z0-9_-]+)$/.exec(s);
  if (m) return { receiptNo: m[1], token: m[2] };
  return { receiptNo: s.toUpperCase(), token: null };
}

export function verifyReceipt(raw: string, opts: { siteId?: number | null; requireToken?: boolean } = {}): VerifiedReceipt {
  const { receiptNo, token } = parseReceiptCode(raw);
  const sale = q.get(
    `SELECT s.*, m.code merchant_code, m.name merchant_name, m.status merchant_status, m.validation_enabled, m.validation_min_spend,
            m.site_id merchant_site, b.code branch_code, b.site_id branch_site
       FROM pos_sales s JOIN merchants m ON m.id=s.merchant_id JOIN merchant_branches b ON b.id=s.branch_id
      WHERE s.receipt_no=?`,
    receiptNo,
  );
  if (!sale) return { code: 'RECEIPT_NOT_FOUND', ok: false, reasons: ['RECEIPT_NOT_FOUND'], receipt: null };
  const reasons: ReceiptStatusCode[] = [];
  if (token ? !safeEqual(token, sale.verification_token) : opts.requireToken !== false) reasons.push('INVALID_TOKEN');
  if (!['ACTIVE', 'APPROVED'].includes(sale.merchant_status) || !sale.validation_enabled) reasons.push('MERCHANT_NOT_ELIGIBLE');
  if (sale.status === 'VOIDED') reasons.push('RECEIPT_VOIDED');
  if (sale.status === 'REFUNDED' || sale.status === 'PARTIALLY_REFUNDED') reasons.push('RECEIPT_REFUNDED');
  if (sale.status !== 'PAID' && sale.status !== 'PARTIALLY_REFUNDED' && !reasons.length) reasons.push('RECEIPT_NOT_PAID');
  const usage = q.get(
    `SELECT u.*, p.parking_no, p.plate_text FROM receipt_usages u JOIN parking_sessions p ON p.id=u.session_id WHERE u.receipt_ref=?`,
    sale.receipt_no,
  );
  if (usage || sale.parking_validation_status !== 'NOT_USED') reasons.push('RECEIPT_ALREADY_USED');
  const vs = getSetting('validation');
  if (vs.receiptMaxAgeHours > 0 && Date.now() - new Date(sale.issued_at).getTime() > vs.receiptMaxAgeHours * 3600_000) reasons.push('RECEIPT_EXPIRED');
  const saleSite = sale.branch_site ?? sale.merchant_site;
  if (vs.requireSameSite && opts.siteId && saleSite && saleSite !== opts.siteId) reasons.push('SITE_NOT_ALLOWED');
  const net = r2(sale.total - sale.refunded_amount);
  if (sale.validation_min_spend > 0 && net < sale.validation_min_spend) reasons.push('BELOW_MIN_SPEND');
  return {
    code: reasons[0] ?? 'VERIFIED',
    ok: reasons.length === 0,
    reasons,
    receipt: {
      saleId: sale.id,
      receiptNo: sale.receipt_no,
      merchantId: sale.merchant_id,
      merchantCode: sale.merchant_code,
      merchantName: sale.merchant_name,
      branchCode: sale.branch_code,
      issuedAt: sale.issued_at,
      subtotal: r2(sale.subtotal),
      discount: r2(sale.discount),
      total: net,
      status: sale.status,
      refundedAmount: sale.refunded_amount,
      validationStatus: sale.parking_validation_status,
      usedBy: usage ? { parkingNo: usage.parking_no, plateText: usage.plate_text, at: usage.created_at } : null,
    },
  };
}

export function loadRules(): ValidationRule[] {
  return q.all('SELECT * FROM validation_rules WHERE active=1').map((r) => ({
    ...json<Partial<ValidationRule>>(r.config_json, {}),
    id: r.id,
    name: r.name,
    scope: r.scope,
    priority: r.priority,
    combinable: !!r.combinable,
    active: !!r.active,
  })) as ValidationRule[];
}

/** Money value of a reward against the session's current fee (for comparing options). */
function rewardValuer(session: Row) {
  const current = quote(session);
  const cfg = rateForVersion(session.rate_version_id);
  const tz = q.get('SELECT tz_offset FROM sites WHERE id=?', session.site_id)?.tz_offset ?? 420;
  const holidays = holidayDates(session.site_id);
  return (r: Reward) => {
    if (r.type === 'FULL') return current.net;
    if (r.type === 'AMOUNT') return Math.min(r.value, current.net);
    const base = { entryAt: new Date(session.entry_at), endAt: new Date(current.chargedUntil), config: cfg, holidays, tzOffsetMinutes: tz };
    const a = calculateFee({ ...base, extraFreeMinutes: current.extraFreeMinutes }).amount;
    const b = calculateFee({ ...base, extraFreeMinutes: current.extraFreeMinutes + r.value }).amount;
    return Math.min(current.net, Math.max(0, a - b));
  };
}

export interface ExternalReceipt {
  ref: string;       // external POS receipt number
  amount: number;
  merchantId?: number | null;
}

export interface ValidationPreview {
  session: ReturnType<typeof quote>;
  receipts: VerifiedReceipt[];
  external: ExternalReceipt[];
  eligibleSpend: number;
  reward: RewardResult;
  after: { net: number; due: number; discount: number } | null;
  blocking: string[];
}

export function previewValidation(sessionId: number, codes: string[], external: ExternalReceipt[] = [], opts: { channel?: 'COUNTER' | 'KIOSK' } = {}): ValidationPreview {
  const s = getSession(sessionId);
  const vs = getSetting('validation');
  const blocking: string[] = [];
  if (s.status !== 'ACTIVE') blocking.push('SESSION_NOT_ACTIVE');
  if (opts.channel === 'KIOSK' && !vs.selfServiceKiosk) blocking.push('SELF_SERVICE_DISABLED');
  const uniq = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  const receipts = uniq.map((c) => verifyReceipt(c, { siteId: s.site_id }));
  const okReceipts = receipts.filter((r) => r.ok);
  const already = q.get<{ n: number }>("SELECT COUNT(*) n FROM receipt_usages WHERE session_id=? AND status='VALIDATED'", s.id)!.n;
  if (!vs.allowMultipleReceipts && okReceipts.length + external.length + already > 1) blocking.push('MULTIPLE_RECEIPTS_NOT_ALLOWED');
  if (vs.maxValidationsPerDayPerPlate > 0 && s.plate_key) {
    const dayStart = new Date(Date.now() - 24 * 3600_000).toISOString();
    const n = q.get<{ n: number }>(
      "SELECT COUNT(*) n FROM parking_discounts d JOIN parking_sessions p ON p.id=d.session_id WHERE p.plate_key=? AND d.type IN ('RECEIPT_VALIDATION','MANUAL_STAMP') AND d.status='ACTIVE' AND d.created_at>=?",
      s.plate_key,
      dayStart,
    )!.n;
    if (n >= vs.maxValidationsPerDayPerPlate) blocking.push('DAILY_LIMIT_REACHED');
  }
  for (const e of external) {
    if (q.get('SELECT 1 FROM receipt_usages WHERE receipt_ref=?', `EXT:${e.ref}`)) blocking.push(`EXTERNAL_RECEIPT_ALREADY_USED:${e.ref}`);
  }
  const inputs = [
    ...okReceipts.map((r) => ({ receiptRef: r.receipt!.receiptNo, merchantId: r.receipt!.merchantId, amount: r.receipt!.total })),
    ...external.map((e) => ({ receiptRef: `EXT:${e.ref}`, merchantId: e.merchantId ?? null, amount: r2(e.amount) })),
  ];
  const valueOf = rewardValuer(s);
  const tz = q.get('SELECT tz_offset FROM sites WHERE id=?', s.site_id)?.tz_offset ?? 420;
  const reward = evaluateRewards(inputs, loadRules(), valueOf, { now: new Date(), tzOffsetMinutes: tz, siteId: s.site_id });
  const current = quote(s);
  let after: ValidationPreview['after'] = null;
  if (reward.applied.length) {
    // Simulate: same quote maths with the new discount added.
    const extra = current.extraFreeMinutes + reward.freeMinutes;
    const cfg = rateForVersion(s.rate_version_id);
    const fee = calculateFee({ entryAt: new Date(s.entry_at), endAt: new Date(current.chargedUntil), config: cfg, holidays: holidayDates(s.site_id), tzOffsetMinutes: tz, extraFreeMinutes: extra, lostTicket: !!s.lost_ticket }).amount;
    let net = Math.max(0, r2(fee - current.memberDiscount - current.discountAmount - reward.amount));
    if (reward.full || current.fullWaiver || current.exempt) net = 0;
    after = { net, due: Math.max(0, r2(net - current.paid)), discount: r2(current.net - net) };
  }
  return { session: current, receipts, external, eligibleSpend: reward.totalSpend, reward, after, blocking };
}

export function applyValidation(opts: {
  sessionId: number;
  codes: string[];
  external?: ExternalReceipt[];
  channel: 'COUNTER' | 'KIOSK' | 'API';
  counter?: string | null;
  deviceId?: number | null;
  userId?: number | null;
}) {
  const result = tx(() => {
    const preview = previewValidation(opts.sessionId, opts.codes, opts.external ?? [], { channel: opts.channel === 'KIOSK' ? 'KIOSK' : 'COUNTER' });
    if (preview.blocking.length) throw conflict('VALIDATION_BLOCKED', preview.blocking.join(', '), { blocking: preview.blocking });
    const bad = preview.receipts.filter((r) => !r.ok);
    if (bad.length) throw conflict(bad[0].code, `receipt rejected: ${bad.map((b) => `${b.receipt?.receiptNo ?? '?'}=${b.code}`).join(', ')}`, { receipts: bad });
    if (!preview.receipts.length && !preview.external.length) throw new HttpError(400, 'NO_RECEIPTS');
    if (!preview.reward.applied.length) throw conflict('NO_ELIGIBLE_REWARD', `ยอดซื้อ ${preview.eligibleSpend} บาท ยังไม่ถึงเงื่อนไข`);
    const s = getSession(opts.sessionId);
    const r = preview.reward;
    const type = preview.external.length && !preview.receipts.length ? 'MANUAL_STAMP' : 'RECEIPT_VALIDATION';
    const discountId = q.insert('parking_discounts', {
      session_id: s.id,
      type,
      amount: r.amount,
      free_minutes: r.freeMinutes,
      full_waiver: r.full ? 1 : 0,
      total_spend: r.totalSpend,
      rules_json: JSON.stringify(r.applied),
      source: opts.channel,
      device_id: opts.deviceId ?? null,
      created_by: opts.userId ?? null,
      reason: opts.counter ?? null,
    });
    for (const rc of preview.receipts) {
      const rec = rc.receipt!;
      q.insert('receipt_usages', {
        receipt_ref: rec.receiptNo,
        sale_id: rec.saleId,
        external: 0,
        merchant_id: rec.merchantId,
        amount: rec.total,
        session_id: s.id,
        discount_id: discountId,
        counter: opts.counter ?? null,
        device_id: opts.deviceId ?? null,
        scanned_by: opts.userId ?? null,
      });
      const upd = q.run("UPDATE pos_sales SET parking_validation_status='USED' WHERE id=? AND parking_validation_status='NOT_USED'", rec.saleId);
      if (!upd.changes) throw conflict('RECEIPT_ALREADY_USED', rec.receiptNo);
      emit.merchant(rec.merchantId, 'receipt:validated', { receiptNo: rec.receiptNo, parkingNo: s.parking_no });
    }
    for (const e of preview.external) {
      q.insert('receipt_usages', {
        receipt_ref: `EXT:${e.ref}`,
        external: 1,
        merchant_id: e.merchantId ?? null,
        amount: r2(e.amount),
        session_id: s.id,
        discount_id: discountId,
        counter: opts.counter ?? null,
        device_id: opts.deviceId ?? null,
        scanned_by: opts.userId ?? null,
      });
    }
    return { discountId, preview, session: s };
  });
  const after = refreshPaymentStatus(opts.sessionId);
  return { ...result, quote: after };
}

/** Merchant POS reported a refund/void on a receipt that may already be validated. */
export function onReceiptRefunded(saleId: number, req: { userId?: number | null } = {}) {
  const usage = q.get("SELECT * FROM receipt_usages WHERE sale_id=? AND status='VALIDATED'", saleId);
  if (!usage) return null;
  const policy = getSetting('validation').refundPolicy;
  const s = getSession(usage.session_id);
  const sale = q.get('SELECT receipt_no FROM pos_sales WHERE id=?', saleId);
  let action = 'AUDIT_ONLY';
  tx(() => {
    q.run("UPDATE receipt_usages SET status='REFUNDED_AFTER_VALIDATION' WHERE id=?", usage.id);
    q.run("UPDATE pos_sales SET parking_validation_status='REFUNDED_AFTER_VALIDATION' WHERE id=?", saleId);
    if (s.status === 'ACTIVE' && (policy === 'REVOKE_IF_ACTIVE' || policy === 'RECALCULATE')) {
      const d = q.get('SELECT * FROM parking_discounts WHERE id=?', usage.discount_id);
      if (d && d.status === 'ACTIVE') {
        q.run("UPDATE parking_discounts SET status='REVOKED', revoked_at=?, revoked_by=?, revoked_reason=? WHERE id=?", nowIso(), req.userId ?? null, `RECEIPT_REFUNDED ${sale?.receipt_no}`, d.id);
        action = 'REVOKED';
        if (policy === 'RECALCULATE') {
          // Re-issue a discount from the receipts that are still valid on this discount.
          const remaining = q.all("SELECT * FROM receipt_usages WHERE discount_id=? AND status='VALIDATED'", d.id);
          if (remaining.length) {
            const valueOf = rewardValuer(getSession(s.id));
            const reward = evaluateRewards(
              remaining.map((u) => ({ receiptRef: u.receipt_ref, merchantId: u.merchant_id, amount: u.amount })),
              loadRules(),
              valueOf,
              { now: new Date(d.created_at), siteId: s.site_id },
            );
            if (reward.applied.length) {
              const nid = q.insert('parking_discounts', {
                session_id: s.id, type: d.type, amount: reward.amount, free_minutes: reward.freeMinutes, full_waiver: reward.full ? 1 : 0,
                total_spend: reward.totalSpend, rules_json: JSON.stringify(reward.applied), source: 'RECALCULATED', reason: `recalculated after refund of ${sale?.receipt_no}`,
              });
              q.run('UPDATE receipt_usages SET discount_id=? WHERE discount_id=? AND status=?', nid, d.id, 'VALIDATED');
            }
            action = 'RECALCULATED';
          }
        }
      }
    } else if (policy === 'MANAGER_REVIEW') {
      action = 'MANAGER_REVIEW';
    }
  });
  raiseAlert({
    type: 'RECEIPT_REFUND',
    severity: action === 'MANAGER_REVIEW' || s.status !== 'ACTIVE' ? 'WARNING' : 'INFO',
    siteId: s.site_id,
    refType: 'session',
    refId: s.id,
    message: `ใบเสร็จ ${sale?.receipt_no} ถูกคืนเงินหลังใช้สิทธิ์จอดรถ (${s.parking_no}) → ${action}`,
    data: { saleId, sessionId: s.id, policy, action },
  });
  refreshPaymentStatus(s.id);
  return { action, sessionId: s.id, parkingNo: s.parking_no };
}

export function sessionValidations(sessionId: number) {
  return q.all(
    `SELECT u.*, m.name merchant_name, us.display_name scanned_by_name FROM receipt_usages u
       LEFT JOIN merchants m ON m.id=u.merchant_id LEFT JOIN users us ON us.id=u.scanned_by
      WHERE u.session_id=? ORDER BY u.id`,
    sessionId,
  );
}

export function assertNotFound(x: unknown, code: string) {
  if (!x) throw notFound(code);
}

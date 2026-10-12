/**
 * Merchant POS: server-side pricing, receipt issue, shifts, void/refund and
 * reports. Prices, discounts, service charge and VAT are always recomputed
 * here from the product catalogue — client-sent prices are ignored.
 */
import type { Request } from 'express';
import { q, json, tx, nowIso, type Row } from '../db/index.ts';
import { randomToken } from '../lib/crypto.ts';
import { HttpError, badRequest, conflict, forbidden, notFound, r2 } from '../lib/http.ts';
import { nextSequence, ymd } from '../lib/sequence.ts';
import { emit } from '../lib/realtime.ts';
import { onReceiptRefunded } from './validation.ts';
import { getMerchant, siteTz, type ReceiptInfo } from './merchants.ts';

export const PAYMENT_METHODS = ['CASH', 'PROMPTPAY', 'CARD', 'TRANSFER', 'EWALLET'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PosContext {
  merchant: Row;
  merchantId: number;
  branch: Row;
  branchId: number;
  deviceId: number | null;
  userId: number | null;
  tz: number;
}

/**
 * Resolve merchant scope: merchant users are bound to their own merchant;
 * a POS device key binds to the device's merchant. When both are present
 * they must agree.
 */
export function posContext(req: Request, opts: { requireUser?: boolean; allowInactivePos?: boolean } = {}): PosContext {
  const u = req.user;
  const d = req.device && req.device.type === 'POS' ? req.device : undefined;
  let merchantId = u?.merchantId ?? null;
  if (!merchantId && d?.merchantId && !u) merchantId = d.merchantId;
  if (!merchantId) throw forbidden('MERCHANT_SCOPE_REQUIRED', 'merchant user or POS device required');
  if (opts.requireUser && !u) throw new HttpError(401, 'UNAUTHENTICATED');
  const deviceId = d && d.merchantId === merchantId ? d.id : null;
  const merchant = getMerchant(merchantId);
  if (!['ACTIVE', 'APPROVED'].includes(merchant.status)) throw forbidden('MERCHANT_NOT_ACTIVE');
  if (!merchant.pos_enabled && !opts.allowInactivePos) throw forbidden('POS_DISABLED');
  const branch =
    (u?.branchId ? q.get('SELECT * FROM merchant_branches WHERE id=? AND merchant_id=?', u.branchId, merchantId) : undefined) ??
    q.get('SELECT * FROM merchant_branches WHERE merchant_id=? AND active=1 ORDER BY code LIMIT 1', merchantId);
  if (!branch) throw conflict('NO_BRANCH');
  return { merchant, merchantId, branch, branchId: branch.id, deviceId, userId: u?.id ?? null, tz: siteTz(branch.site_id ?? merchant.site_id) };
}

export function receiptInfo(m: Row): Required<Pick<ReceiptInfo, 'vatMode' | 'vatRate' | 'serviceChargePercent'>> & ReceiptInfo {
  const info = json<ReceiptInfo>(m.receipt_info_json, {});
  return {
    ...info,
    vatMode: info.vatMode === 'EXCLUDED' ? 'EXCLUDED' : 'INCLUDED',
    vatRate: Number.isFinite(Number(info.vatRate)) && info.vatRate !== undefined ? Number(info.vatRate) : 7,
    serviceChargePercent: Math.max(0, Number(info.serviceChargePercent) || 0),
  };
}

// ----------------------------------------------------------------- pricing --

export interface CartItemInput {
  productId: number;
  variantName?: string | null;
  modifiers?: Array<{ group: string; name: string }>;
  qty: number;
  discount?: number | { percent: number } | null;
  note?: string | null;
}

export interface PricedLine {
  productId: number;
  name: string;
  sku: string | null;
  variant: string | null;
  modifiers: Array<{ group: string; name: string; price: number }>;
  qty: number;
  unitPrice: number;
  gross: number;
  discount: number;
  net: number;
  vatApplicable: boolean;
  note: string | null;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: number;      // Σ gross
  lineDiscount: number;
  billDiscount: number;
  discount: number;      // line + bill
  serviceChargePercent: number;
  serviceCharge: number;
  vatMode: 'INCLUDED' | 'EXCLUDED';
  vatRate: number;
  vat: number;
  total: number;
}

function discountAmount(d: CartItemInput['discount'], base: number): number {
  if (d == null || (d as unknown) === '') return 0;
  if (typeof d === 'object') {
    const p = Number(d.percent);
    if (!(p >= 0 && p <= 100)) throw badRequest('VALIDATION', 'discount percent must be 0–100');
    return r2((base * p) / 100);
  }
  const n = Number(d);
  if (!Number.isFinite(n) || n < 0) throw badRequest('VALIDATION', 'discount must be >= 0');
  return r2(n);
}

export function priceCart(merchant: Row, items: CartItemInput[], billDiscountInput?: CartItemInput['discount']): PricedCart {
  if (!Array.isArray(items) || !items.length) throw badRequest('EMPTY_CART');
  if (items.length > 200) throw badRequest('VALIDATION', 'too many items');
  const lines: PricedLine[] = items.map((it) => {
    const p = q.get('SELECT * FROM products WHERE id=? AND merchant_id=? AND active=1', Number(it.productId), merchant.id);
    if (!p) throw badRequest('PRODUCT_NOT_FOUND', `product ${it.productId}`);
    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 9999) throw badRequest('VALIDATION', 'qty must be > 0');
    let unit = Number(p.price);
    let variant: string | null = null;
    const variants = json<Array<{ name: string; price: number }>>(p.variants_json, []);
    if (it.variantName) {
      const v = variants.find((x) => x.name === it.variantName);
      if (!v) throw badRequest('VARIANT_NOT_FOUND', `${p.name}: ${it.variantName}`);
      unit += Number(v.price) || 0; // variant price = surcharge over the base price
      variant = v.name;
    } else if (variants.length) {
      variant = variants[0].name;
      unit += Number(variants[0].price) || 0;
    }
    const groups = json<Array<{ group: string; multi?: boolean; options: Array<{ name: string; price: number }> }>>(p.modifiers_json, []);
    const mods: PricedLine['modifiers'] = [];
    for (const m of it.modifiers ?? []) {
      const g = groups.find((x) => x.group === m.group);
      const o = g?.options.find((x) => x.name === m.name);
      if (!g || !o) throw badRequest('MODIFIER_NOT_FOUND', `${p.name}: ${m.group}/${m.name}`);
      if (!g.multi && mods.some((x) => x.group === g.group)) throw badRequest('VALIDATION', `${g.group}: choose one`);
      if (mods.some((x) => x.group === g.group && x.name === o.name)) continue;
      mods.push({ group: g.group, name: o.name, price: Number(o.price) || 0 });
      unit += Number(o.price) || 0;
    }
    unit = r2(unit);
    const gross = r2(unit * qty);
    const discount = Math.min(gross, discountAmount(it.discount, gross));
    return {
      productId: p.id,
      name: p.name,
      sku: p.sku ?? null,
      variant,
      modifiers: mods,
      qty,
      unitPrice: unit,
      gross,
      discount,
      net: r2(gross - discount),
      vatApplicable: !!p.vat_applicable,
      note: it.note ? String(it.note).slice(0, 200) : null,
    };
  });
  const subtotal = r2(lines.reduce((s, l) => s + l.gross, 0));
  const lineDiscount = r2(lines.reduce((s, l) => s + l.discount, 0));
  const afterLines = r2(subtotal - lineDiscount);
  const billDiscount = Math.min(afterLines, discountAmount(billDiscountInput, afterLines));
  const base = r2(afterLines - billDiscount);
  const info = receiptInfo(merchant);
  const serviceCharge = r2((base * info.serviceChargePercent) / 100);
  const taxable = r2(base + serviceCharge);
  // Only VAT-applicable lines are taxed; bill discount / service charge are spread pro rata.
  const vatShare = afterLines > 0 ? lines.filter((l) => l.vatApplicable).reduce((s, l) => s + l.net, 0) / afterLines : 0;
  const rate = info.vatRegistered === false ? 0 : info.vatRate;
  let vat = 0;
  let total = taxable;
  if (rate > 0) {
    const vatBase = taxable * vatShare;
    if (info.vatMode === 'EXCLUDED') {
      vat = r2((vatBase * rate) / 100);
      total = r2(taxable + vat);
    } else vat = r2((vatBase * rate) / (100 + rate));
  }
  return {
    lines,
    subtotal,
    lineDiscount,
    billDiscount,
    discount: r2(lineDiscount + billDiscount),
    serviceChargePercent: info.serviceChargePercent,
    serviceCharge,
    vatMode: info.vatMode,
    vatRate: rate,
    vat,
    total,
  };
}

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  ref?: string | null;
}

export function settlePayments(total: number, input: PaymentInput[]) {
  if (!Array.isArray(input) || !input.length) throw badRequest('PAYMENT_REQUIRED');
  const payments = input.map((p) => {
    if (!PAYMENT_METHODS.includes(p.method)) throw badRequest('VALIDATION', `invalid payment method ${p.method}`);
    const amount = r2(Number(p.amount));
    if (!(amount > 0)) throw badRequest('VALIDATION', 'payment amount must be > 0');
    return { method: p.method, amount, ref: p.ref ? String(p.ref).slice(0, 80) : null };
  });
  const paid = r2(payments.reduce((s, p) => s + p.amount, 0));
  const cash = r2(payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amount, 0));
  const nonCash = r2(paid - cash);
  if (paid + 0.001 < total) throw conflict('PAYMENT_INSUFFICIENT', `ชำระ ${paid} จากยอด ${total}`, { paid, total });
  if (nonCash > total + 0.001) throw conflict('NON_CASH_OVERPAY', 'non-cash payments cannot exceed the total');
  const change = r2(paid - total);
  return { payments, paid, cash, change, cashNet: r2(cash - change) };
}

// ------------------------------------------------------------------ shifts --

export function openShiftFor(merchantId: number, userId: number) {
  return q.get("SELECT * FROM pos_shifts WHERE merchant_id=? AND user_id=? AND status='OPEN' ORDER BY id DESC LIMIT 1", merchantId, userId);
}

export function shiftReport(shiftId: number) {
  const s = q.get('SELECT s.*, u.display_name user_name, b.code branch_code FROM pos_shifts s JOIN users u ON u.id=s.user_id JOIN merchant_branches b ON b.id=s.branch_id WHERE s.id=?', shiftId);
  if (!s) throw notFound('SHIFT_NOT_FOUND');
  const mv = q.all<{ type: string; total: number; n: number }>('SELECT type, COALESCE(SUM(amount),0) total, COUNT(*) n FROM cash_movements WHERE shift_id=? GROUP BY type', shiftId);
  const by = (t: string) => r2(mv.find((m) => m.type === t)?.total ?? 0);
  const expected = r2(s.opening_cash + by('SALE') + by('IN') - by('OUT') - by('REFUND'));
  const sales = q.all('SELECT status, total, refunded_amount, payments_json FROM pos_sales WHERE shift_id=?', shiftId);
  const methods: Record<string, number> = {};
  let gross = 0;
  let count = 0;
  let voids = 0;
  let refunds = 0;
  for (const x of sales) {
    if (x.status === 'VOIDED') {
      voids++;
      continue;
    }
    count++;
    gross += x.total;
    refunds += x.refunded_amount;
    for (const p of json<PaymentInput[]>(x.payments_json, [])) methods[p.method] = r2((methods[p.method] ?? 0) + p.amount);
  }
  return {
    shift: s,
    openingCash: r2(s.opening_cash),
    cashSales: by('SALE'),
    cashIn: by('IN'),
    cashOut: by('OUT'),
    cashRefunds: by('REFUND'),
    expectedCash: s.status === 'CLOSED' && s.expected_cash != null ? r2(s.expected_cash) : expected,
    countedCash: s.closing_cash,
    difference: s.closing_cash != null ? r2(s.closing_cash - (s.expected_cash ?? expected)) : null,
    sales: { count, gross: r2(gross), refunds: r2(refunds), net: r2(gross - refunds), voids },
    methods,
    movements: q.all('SELECT m.*, u.display_name user_name FROM cash_movements m LEFT JOIN users u ON u.id=m.user_id WHERE shift_id=? ORDER BY m.id', shiftId),
  };
}

// ------------------------------------------------------------------- sales --

export function receiptPayload(receiptNo: string, token: string) {
  return `PV1.${receiptNo}.${token}`;
}

export function saleView(s: Row) {
  const { verification_token, idempotency_key, items_json, payments_json, ...rest } = s;
  return {
    ...rest,
    external: typeof idempotency_key === 'string' && idempotency_key.startsWith('ext:'),
    items: json<PricedLine[]>(items_json, []),
    payments: json<Array<PaymentInput & { change?: number }>>(payments_json, []),
    barcode: receiptPayload(s.receipt_no, verification_token),
  };
}

/** Everything the client needs to print the receipt (store header → parking validation section). */
export function receiptData(saleId: number) {
  const s = q.get(
    `SELECT s.*, u.display_name cashier_name, b.code branch_code, b.name branch_name FROM pos_sales s
       LEFT JOIN users u ON u.id=s.cashier_id JOIN merchant_branches b ON b.id=s.branch_id WHERE s.id=?`,
    saleId,
  );
  if (!s) throw notFound('SALE_NOT_FOUND');
  const m = getMerchant(s.merchant_id);
  const info = receiptInfo(m);
  const view = saleView(s);
  const change = view.payments.reduce((c, p) => c + (Number(p.change) || 0), 0);
  return {
    store: {
      name: m.name,
      code: m.code,
      logoUrl: m.logo_url,
      header: info.header ?? m.name,
      footer: info.footer ?? 'ขอบคุณที่ใช้บริการ',
      taxId: info.vatRegistered ? info.taxId ?? m.tax_id : null,
      vatRegistered: !!info.vatRegistered,
      branchCode: s.branch_code,
      branchName: info.branchName ?? s.branch_name,
      unitNo: m.unit_no,
    },
    receiptNo: s.receipt_no,
    issuedAt: s.issued_at,
    cashier: s.cashier_name,
    memberPhone: s.member_phone,
    items: view.items,
    subtotal: s.subtotal,
    discount: s.discount,
    serviceCharge: s.service_charge,
    vat: s.vat,
    vatMode: s.vat_mode,
    vatRate: info.vatRate,
    total: s.total,
    refundedAmount: s.refunded_amount,
    payments: view.payments,
    change: r2(change),
    status: s.status,
    reprintCount: s.reprint_count,
    parking: m.validation_enabled
      ? { payload: view.barcode, receiptNo: s.receipt_no, eligibleAmount: r2(s.total - s.refunded_amount), minSpend: m.validation_min_spend }
      : null,
  };
}

export interface CreateSaleInput {
  items: CartItemInput[];
  billDiscount?: CartItemInput['discount'];
  memberPhone?: string | null;
  payments: PaymentInput[];
  idempotencyKey?: string | null;
}

export function createSale(ctx: PosContext, input: CreateSaleInput) {
  if (!ctx.userId) throw new HttpError(401, 'UNAUTHENTICATED');
  const idem = input.idempotencyKey ? `pos:${ctx.merchantId}:${String(input.idempotencyKey).slice(0, 80)}` : null;
  if (idem) {
    const prev = q.get('SELECT id FROM pos_sales WHERE idempotency_key=?', idem);
    if (prev) return { saleId: prev.id, replay: true };
  }
  const shift = openShiftFor(ctx.merchantId, ctx.userId);
  if (!shift) throw conflict('SHIFT_NOT_OPEN', 'กรุณาเปิดกะก่อนขาย');
  const priced = priceCart(ctx.merchant, input.items, input.billDiscount);
  if (!(priced.total > 0)) throw badRequest('ZERO_TOTAL');
  const pay = settlePayments(priced.total, input.payments);
  const memberPhone = input.memberPhone ? String(input.memberPhone).replace(/[^0-9+]/g, '').slice(0, 20) || null : null;
  const saleId = tx(() => {
    const day = ymd(new Date(), ctx.tz);
    const seq = nextSequence(`receipt:${ctx.merchantId}:${ctx.branchId}`, day);
    const receiptNo = `${ctx.merchant.code}-${ctx.branch.code}-${day}-${String(seq).padStart(6, '0')}`;
    const payments = pay.payments.map((p, i) => ({ ...p, ...(p.method === 'CASH' && i === pay.payments.findIndex((x) => x.method === 'CASH') && pay.change > 0 ? { change: pay.change } : {}) }));
    const id = q.insert('pos_sales', {
      receipt_no: receiptNo,
      merchant_id: ctx.merchantId,
      branch_id: ctx.branchId,
      device_id: ctx.deviceId,
      shift_id: shift.id,
      cashier_id: ctx.userId,
      member_phone: memberPhone,
      items_json: JSON.stringify(priced.lines),
      subtotal: priced.subtotal,
      discount: priced.discount,
      service_charge: priced.serviceCharge,
      vat: priced.vat,
      vat_mode: priced.vatMode,
      total: priced.total,
      payments_json: JSON.stringify(payments),
      verification_token: randomToken(9),
      idempotency_key: idem,
    });
    if (pay.cashNet > 0) q.insert('cash_movements', { shift_id: shift.id, type: 'SALE', amount: pay.cashNet, sale_id: id, user_id: ctx.userId });
    for (const l of priced.lines) q.run('UPDATE products SET stock=stock-? WHERE id=? AND track_stock=1 AND stock IS NOT NULL', l.qty, l.productId);
    return id;
  });
  const sale = q.get('SELECT * FROM pos_sales WHERE id=?', saleId)!;
  emit.merchant(ctx.merchantId, 'pos:sale', { saleId, receiptNo: sale.receipt_no, total: sale.total, change: pay.change, deviceId: ctx.deviceId, branchId: ctx.branchId });
  return { saleId, replay: false, change: pay.change };
}

export function getSale(merchantId: number, id: number) {
  const s = q.get('SELECT * FROM pos_sales WHERE id=? AND merchant_id=?', id, merchantId);
  if (!s) throw notFound('SALE_NOT_FOUND');
  return s;
}

export function getSaleByReceipt(merchantId: number, receiptNo: string) {
  const s = q.get('SELECT * FROM pos_sales WHERE receipt_no=? AND merchant_id=?', receiptNo, merchantId);
  if (!s) throw notFound('SALE_NOT_FOUND');
  return s;
}

function cashPart(s: Row): number {
  const pays = json<Array<PaymentInput & { change?: number }>>(s.payments_json, []);
  return r2(pays.filter((p) => p.method === 'CASH').reduce((t, p) => t + p.amount - (Number(p.change) || 0), 0));
}

function shiftForMovement(s: Row, userId: number | null) {
  const mine = userId ? openShiftFor(s.merchant_id, userId) : null;
  if (mine) return mine.id;
  const orig = s.shift_id ? q.get("SELECT id FROM pos_shifts WHERE id=? AND status='OPEN'", s.shift_id) : null;
  return orig?.id ?? null;
}

/** Void (same business day) — full reversal; parking discount follows the refund policy. */
export function voidSale(s: Row, opts: { reason: string; userId: number | null; tz: number; anyDay?: boolean }) {
  if (s.status !== 'PAID') throw conflict('INVALID_STATUS', `receipt is ${s.status}`);
  if (!opts.anyDay && ymd(new Date(s.issued_at), opts.tz) !== ymd(new Date(), opts.tz)) throw conflict('VOID_WINDOW_CLOSED', 'ยกเลิกได้เฉพาะใบเสร็จของวันนี้ — ใช้การคืนเงินแทน');
  tx(() => {
    const upd = q.run("UPDATE pos_sales SET status='VOIDED', voided_at=?, voided_by=?, void_reason=? WHERE id=? AND status='PAID'", nowIso(), opts.userId, opts.reason, s.id);
    if (!upd.changes) throw conflict('INVALID_STATUS');
    const cash = cashPart(s);
    const shiftId = shiftForMovement(s, opts.userId);
    if (cash > 0 && shiftId) q.insert('cash_movements', { shift_id: shiftId, type: 'REFUND', amount: cash, reason: `VOID ${s.receipt_no}`, sale_id: s.id, user_id: opts.userId });
    for (const l of json<PricedLine[]>(s.items_json, [])) if (l.productId) q.run('UPDATE products SET stock=stock+? WHERE id=? AND track_stock=1 AND stock IS NOT NULL', l.qty, l.productId);
  });
  const parking = onReceiptRefunded(s.id, { userId: opts.userId });
  emit.merchant(s.merchant_id, 'pos:void', { saleId: s.id, receiptNo: s.receipt_no });
  return { sale: q.get('SELECT * FROM pos_sales WHERE id=?', s.id)!, parking };
}

/** Partial or full refund by amount or by items [{index, qty}]. */
export function refundSale(
  s: Row,
  opts: { amount?: number; items?: Array<{ index: number; qty: number }>; reason: string; method?: string | null; userId: number | null; approvedBy: number | null },
) {
  if (s.status !== 'PAID' && s.status !== 'PARTIALLY_REFUNDED') throw conflict('INVALID_STATUS', `receipt is ${s.status}`);
  const remaining = r2(s.total - s.refunded_amount);
  let amount: number;
  let items: Array<{ index: number; name: string; qty: number; amount: number }> | null = null;
  if (opts.items?.length) {
    const lines = json<PricedLine[]>(s.items_json, []);
    const sumNet = lines.reduce((t, l) => t + (l.net ?? 0), 0);
    const ratio = sumNet > 0 ? s.total / sumNet : 0; // spreads bill discount, service charge and VAT
    items = opts.items.map((x) => {
      const l = lines[Number(x.index)];
      const qty = Number(x.qty);
      if (!l || !(qty > 0) || qty > l.qty) throw badRequest('VALIDATION', `invalid refund item ${x.index}`);
      return { index: Number(x.index), name: l.name, qty, amount: r2((l.net / l.qty) * qty * ratio) };
    });
    amount = r2(items.reduce((t, i) => t + i.amount, 0));
  } else if (opts.amount === undefined || opts.amount === null) {
    amount = remaining; // no amount and no items = refund everything still refundable
  } else {
    amount = r2(Number(opts.amount));
  }
  if (!(amount > 0)) throw badRequest('VALIDATION', 'refund amount must be > 0');
  if (amount > remaining + 0.001) throw conflict('REFUND_EXCEEDS_REMAINING', `คืนได้สูงสุด ${remaining}`);
  amount = Math.min(amount, remaining);
  const method = opts.method && PAYMENT_METHODS.includes(opts.method as PaymentMethod) ? opts.method : json<PaymentInput[]>(s.payments_json, [])[0]?.method ?? 'CASH';
  const refundId = tx(() => {
    const newRefunded = r2(s.refunded_amount + amount);
    const status = newRefunded >= s.total - 0.001 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    const upd = q.run('UPDATE pos_sales SET refunded_amount=?, status=? WHERE id=? AND refunded_amount=?', newRefunded, status, s.id, s.refunded_amount);
    if (!upd.changes) throw conflict('CONCURRENT_UPDATE');
    const id = q.insert('pos_refunds', { sale_id: s.id, amount, items_json: items ? JSON.stringify(items) : null, reason: opts.reason, method, user_id: opts.userId, approved_by: opts.approvedBy });
    const shiftId = shiftForMovement(s, opts.userId);
    if (method === 'CASH' && shiftId) q.insert('cash_movements', { shift_id: shiftId, type: 'REFUND', amount, reason: `REFUND ${s.receipt_no}`, sale_id: s.id, user_id: opts.userId });
    return id;
  });
  const parking = onReceiptRefunded(s.id, { userId: opts.userId });
  emit.merchant(s.merchant_id, 'pos:refund', { saleId: s.id, receiptNo: s.receipt_no, amount });
  return { refundId, amount, method, sale: q.get('SELECT * FROM pos_sales WHERE id=?', s.id)!, parking };
}

// -------------------------------------------------------------- listings --

export function listSales(merchantId: number, f: { from?: string; to?: string; status?: string; q?: string; cashierId?: number; validation?: string; limit: number; offset: number }) {
  const where = ['s.merchant_id=?'];
  const params: unknown[] = [merchantId];
  if (f.from) where.push('s.issued_at>=?'), params.push(f.from);
  if (f.to) where.push('s.issued_at<=?'), params.push(f.to);
  if (f.status) where.push('s.status=?'), params.push(f.status);
  if (f.validation) where.push('s.parking_validation_status=?'), params.push(f.validation);
  if (f.cashierId) where.push('s.cashier_id=?'), params.push(f.cashierId);
  if (f.q) where.push('(s.receipt_no LIKE ? OR s.member_phone LIKE ? OR p.plate_text LIKE ? OR p.parking_no LIKE ?)'), params.push(...Array(4).fill(`%${f.q}%`));
  const from = `FROM pos_sales s LEFT JOIN receipt_usages u ON u.sale_id=s.id LEFT JOIN parking_sessions p ON p.id=u.session_id
                LEFT JOIN users c ON c.id=s.cashier_id LEFT JOIN merchant_branches b ON b.id=s.branch_id WHERE ${where.join(' AND ')}`;
  const total = q.get<{ n: number }>(`SELECT COUNT(*) n ${from}`, ...params)!.n;
  const sums = q.get(`SELECT COALESCE(SUM(CASE WHEN s.status<>'VOIDED' THEN s.total-s.refunded_amount ELSE 0 END),0) net ${from}`, ...params)!;
  const items = q
    .all(
      `SELECT s.*, c.display_name cashier_name, b.code branch_code, u.status usage_status, u.created_at validated_at, u.counter,
              p.parking_no, p.plate_text, p.province ${from} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      ...params,
      f.limit,
      f.offset,
    )
    .map(saleView);
  return { items, total, net: r2(sums.net) };
}

// ----------------------------------------------------------------- reports --

export function salesReport(merchantId: number, from: string, to: string, tz: number) {
  const mod = `${tz >= 0 ? '+' : ''}${tz} minutes`;
  const rows = q.all(
    `SELECT s.*, c.display_name cashier_name FROM pos_sales s LEFT JOIN users c ON c.id=s.cashier_id
      WHERE s.merchant_id=? AND s.issued_at BETWEEN ? AND ? ORDER BY s.issued_at`,
    merchantId,
    from,
    to,
  );
  const daily = new Map<string, { date: string; count: number; gross: number; discount: number; vat: number; refunds: number; net: number; voids: number }>();
  const methods = new Map<string, { method: string; count: number; amount: number }>();
  const products = new Map<string, { name: string; qty: number; amount: number }>();
  const cashiers = new Map<string, { cashier: string; count: number; net: number; voids: number; refunds: number }>();
  let count = 0;
  let net = 0;
  let voids = 0;
  let refunds = 0;
  for (const s of rows) {
    const d = new Date(Date.parse(s.issued_at) + tz * 60_000).toISOString().slice(0, 10);
    const day = daily.get(d) ?? { date: d, count: 0, gross: 0, discount: 0, vat: 0, refunds: 0, net: 0, voids: 0 };
    const cashier = s.cashier_name ?? 'External POS';
    const c = cashiers.get(cashier) ?? { cashier, count: 0, net: 0, voids: 0, refunds: 0 };
    daily.set(d, day);
    cashiers.set(cashier, c);
    if (s.status === 'VOIDED') {
      day.voids++;
      c.voids++;
      voids++;
      continue;
    }
    const n = s.total - s.refunded_amount;
    day.count++;
    day.gross += s.subtotal;
    day.discount += s.discount;
    day.vat += s.vat;
    day.refunds += s.refunded_amount;
    day.net += n;
    c.count++;
    c.net += n;
    c.refunds += s.refunded_amount;
    count++;
    net += n;
    refunds += s.refunded_amount;
    for (const p of json<Array<PaymentInput & { change?: number }>>(s.payments_json, [])) {
      const m = methods.get(p.method) ?? { method: p.method, count: 0, amount: 0 };
      m.count++;
      m.amount += p.amount - (Number(p.change) || 0);
      methods.set(p.method, m);
    }
    for (const l of json<PricedLine[]>(s.items_json, [])) {
      const key = l.name + (l.variant ? ` (${l.variant})` : '');
      const pr = products.get(key) ?? { name: key, qty: 0, amount: 0 };
      pr.qty += l.qty;
      pr.amount += l.net ?? 0;
      products.set(key, pr);
    }
  }
  const round = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])) as T;
  const shifts = q.all(
    `SELECT sh.id, sh.opened_at, sh.closed_at, sh.status, sh.opening_cash, sh.closing_cash, sh.expected_cash, u.display_name user_name,
            (SELECT COUNT(*) FROM pos_sales x WHERE x.shift_id=sh.id AND x.status<>'VOIDED') sales_count,
            (SELECT COALESCE(SUM(x.total-x.refunded_amount),0) FROM pos_sales x WHERE x.shift_id=sh.id AND x.status<>'VOIDED') sales_net
       FROM pos_shifts sh JOIN users u ON u.id=sh.user_id WHERE sh.merchant_id=? AND sh.opened_at BETWEEN ? AND ? ORDER BY sh.id DESC`,
    merchantId,
    from,
    to,
  );
  return {
    from,
    to,
    tzModifier: mod,
    summary: { count, net: r2(net), voids, refunds: r2(refunds), average: count ? r2(net / count) : 0 },
    daily: [...daily.values()].map(round),
    byMethod: [...methods.values()].map(round).sort((a, b) => b.amount - a.amount),
    byProduct: [...products.values()].map(round).sort((a, b) => b.amount - a.amount),
    byCashier: [...cashiers.values()].map(round).sort((a, b) => b.net - a.net),
    byShift: shifts,
  };
}

// -------------------------------------------------------- external POS API --

export interface ExternalReceiptInput {
  externalRef: string;
  branchCode?: string | null;
  issuedAt?: string | null;
  items?: Array<{ name: string; qty?: number; unitPrice?: number; price?: number; total?: number; sku?: string }>;
  subtotal: number;
  discount?: number;
  serviceCharge?: number;
  vat?: number;
  vatMode?: 'INCLUDED' | 'EXCLUDED';
  total: number;
  payments?: Array<{ method: string; amount: number; ref?: string }>;
  memberPhone?: string | null;
  idempotencyKey?: string | null;
}

/**
 * A third-party POS reports a completed sale. Amounts are the merchant POS's
 * own figures (they are the system of record for that sale); we issue our
 * immutable receipt number + verification token so the receipt can be used
 * for parking validation exactly like an internal one.
 */
export function createExternalSale(merchantId: number, deviceId: number, input: ExternalReceiptInput) {
  const merchant = getMerchant(merchantId);
  if (!['ACTIVE', 'APPROVED'].includes(merchant.status)) throw forbidden('MERCHANT_NOT_ACTIVE');
  const externalRef = String(input.externalRef ?? '').trim().slice(0, 80);
  if (!externalRef) throw badRequest('VALIDATION', 'externalRef is required');
  const idem = `ext:${merchantId}:${String(input.idempotencyKey || externalRef).slice(0, 80)}`;
  const prev = q.get('SELECT id FROM pos_sales WHERE idempotency_key=?', idem);
  if (prev) return { saleId: prev.id, replay: true };
  const branch = input.branchCode
    ? q.get('SELECT * FROM merchant_branches WHERE merchant_id=? AND code=? AND active=1', merchantId, String(input.branchCode).toUpperCase())
    : q.get('SELECT * FROM merchant_branches WHERE merchant_id=? AND active=1 ORDER BY code LIMIT 1', merchantId);
  if (!branch) throw badRequest('BRANCH_NOT_FOUND');
  const money = (v: unknown, k: string, required = false) => {
    if (v === undefined || v === null || v === '') {
      if (required) throw badRequest('VALIDATION', `${k} is required`);
      return 0;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw badRequest('VALIDATION', `${k} must be >= 0`);
    return r2(n);
  };
  const subtotal = money(input.subtotal, 'subtotal', true);
  const discount = money(input.discount, 'discount');
  const serviceCharge = money(input.serviceCharge, 'serviceCharge');
  const vat = money(input.vat, 'vat');
  const total = money(input.total, 'total', true);
  const vatMode = input.vatMode === 'EXCLUDED' ? 'EXCLUDED' : 'INCLUDED';
  if (!(total > 0)) throw badRequest('VALIDATION', 'total must be > 0');
  const expected = r2(subtotal - discount + serviceCharge + (vatMode === 'EXCLUDED' ? vat : 0));
  if (Math.abs(expected - total) > 0.05) throw badRequest('TOTAL_MISMATCH', `subtotal - discount + serviceCharge${vatMode === 'EXCLUDED' ? ' + vat' : ''} = ${expected} ≠ total ${total}`);
  const issued = input.issuedAt ? new Date(input.issuedAt) : new Date();
  if (Number.isNaN(issued.getTime())) throw badRequest('VALIDATION', 'issuedAt must be ISO-8601');
  if (issued.getTime() > Date.now() + 5 * 60_000) throw badRequest('VALIDATION', 'issuedAt is in the future');
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, 200).map((it) => {
    const qty = Number(it.qty ?? 1) || 1;
    const unit = r2(Number(it.unitPrice ?? it.price ?? 0) || 0);
    const net = r2(Number(it.total ?? unit * qty) || 0);
    return { productId: 0, name: String(it.name ?? '-').slice(0, 120), sku: it.sku ? String(it.sku).slice(0, 40) : null, variant: null, modifiers: [], qty, unitPrice: unit, gross: net, discount: 0, net, vatApplicable: true, note: null };
  });
  const payments = (Array.isArray(input.payments) && input.payments.length ? input.payments : [{ method: 'EXTERNAL', amount: total }]).map((p) => ({
    method: String(p.method ?? 'EXTERNAL').toUpperCase().slice(0, 20),
    amount: r2(Number(p.amount) || 0),
    ref: (p as { ref?: string }).ref ? String((p as { ref?: string }).ref).slice(0, 80) : null,
  }));
  const tz = siteTz(branch.site_id ?? merchant.site_id);
  const saleId = tx(() => {
    const day = ymd(issued, tz);
    const seq = nextSequence(`receipt:${merchantId}:${branch.id}`, day);
    const receiptNo = `${merchant.code}-${branch.code}-${day}-${String(seq).padStart(6, '0')}`;
    return q.insert('pos_sales', {
      receipt_no: receiptNo,
      merchant_id: merchantId,
      branch_id: branch.id,
      device_id: deviceId,
      member_phone: input.memberPhone ? String(input.memberPhone).replace(/[^0-9+]/g, '').slice(0, 20) : null,
      items_json: JSON.stringify(items),
      subtotal,
      discount,
      service_charge: serviceCharge,
      vat,
      vat_mode: vatMode,
      total,
      payments_json: JSON.stringify(payments),
      verification_token: randomToken(9),
      idempotency_key: idem,
      issued_at: issued.toISOString(),
    });
  });
  const sale = q.get('SELECT * FROM pos_sales WHERE id=?', saleId)!;
  emit.merchant(merchantId, 'pos:sale', { saleId, receiptNo: sale.receipt_no, total, external: true, externalRef });
  return { saleId, replay: false };
}

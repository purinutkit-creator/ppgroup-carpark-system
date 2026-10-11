/**
 * Merchant POS & Merchant Portal API (merchant users see only their own
 * merchant; a POS device key — X-Device-Key — binds the terminal).
 *
 *   GET  /api/pos/me                          context: merchant, branch, device (+printer), open shift, held count
 *   GET/POST/PUT/DELETE /api/pos/categories[/:id]          pos.products (read: pos.sell)
 *   GET/POST/PUT/DELETE /api/pos/products[/:id]            pos.products (read: pos.sell)
 *   POST /api/pos/products/:id/image          multipart file → image_url
 *   GET/POST/PUT /api/pos/staff[/:id], POST /api/pos/staff/:id/reset-pin   merchant.staff
 *   GET  /api/pos/devices, PUT /api/pos/devices/:id {name, printer}
 *   GET  /api/pos/shifts, GET /api/pos/shifts/current, POST /api/pos/shifts/open {openingCash}
 *   POST /api/pos/shifts/cash {type: IN|OUT, amount, reason}, POST /api/pos/shifts/close {countedCash, note}
 *   GET  /api/pos/shifts/:id/report, POST /api/pos/drawer {reason}
 *   GET/POST /api/pos/held, GET/DELETE /api/pos/held/:id
 *   POST /api/pos/quote {items, billDiscount}           server price preview (no side effects)
 *   POST /api/pos/sales                                 see createSale
 *   GET  /api/pos/sales?from&to&status&q, GET /api/pos/sales/:id (+ receipt)
 *   POST /api/pos/sales/:id/void {reason, approval}     same business day
 *   POST /api/pos/sales/:id/refund {amount|items, reason, approval, method?}
 *   POST /api/pos/sales/:id/reprint
 *   POST /api/pos/promptpay-qr {amount}
 *   GET  /api/pos/dashboard, GET /api/pos/reports?from&to
 *   GET/PUT /api/pos/settings                           merchant.settings
 *   POST /api/pos/display {cart}, GET /api/pos/display/info  (customer display)
 *   POST /api/pos/external/receipts, POST /api/pos/external/receipts/:receiptNo/{void|refund}
 */
import { Router, type Request } from 'express';
import QRCode from 'qrcode';
import { q, json } from '../db/index.ts';
import { body, bool, h, HttpError, int, num, oneOf, paging, reqStr, str, badRequest, conflict, forbidden, notFound, r2 } from '../lib/http.ts';
import { can, requireDevice, requirePerm, requireUserOrDevice, verifyApproval, type Approval } from '../auth/middleware.ts';
import type { Permission } from '../auth/rbac.ts';
import { audit } from '../lib/audit.ts';
import { emit } from '../lib/realtime.ts';
import { hashPassword } from '../lib/crypto.ts';
import { promptPayPayload } from '../lib/promptpay.ts';
import { storePublicFile, uploadSingle } from './media.ts';
import { localDayRange, merchantStats, merchantView, siteTz, type ReceiptInfo } from '../services/merchants.ts';
import {
  createExternalSale,
  createSale,
  getSale,
  getSaleByReceipt,
  listSales,
  openShiftFor,
  posContext,
  priceCart,
  receiptData,
  receiptInfo,
  refundSale,
  saleView,
  salesReport,
  shiftReport,
  voidSale,
  type PosContext,
} from '../services/pos.ts';

export const router = Router();

const perm = (...p: Permission[]) => requirePerm(...p);
const id = (req: Request, k = 'id') => {
  const n = Number(req.params[k]);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
};

// ------------------------------------------------------- external POS API --
/*
 * External POS integration ("API เชื่อมต่อ POS ของร้านค้าเพื่อรับยอดซื้อและแสตมป์โดยอัตโนมัติ").
 * Auth: header `X-Device-Key: <POS device key>` (issued on merchant approval or
 * Admin → Merchant → POS devices). The key is bound to one merchant.
 *
 * POST /api/pos/external/receipts
 *   { "externalRef": "INV-000123",          // required, your receipt number (unique per merchant)
 *     "branchCode": "B01",                   // optional, default first active branch
 *     "issuedAt": "2026-10-12T07:21:00Z",    // optional ISO-8601, default now
 *     "items": [{ "name": "Latte", "qty": 2, "unitPrice": 65, "total": 130, "sku": "CF-002" }],
 *     "subtotal": 1300, "discount": 50, "serviceCharge": 0, "vat": 81.78, "vatMode": "INCLUDED",
 *     "total": 1250,                         // must equal subtotal - discount + serviceCharge (+ vat when EXCLUDED)
 *     "payments": [{ "method": "CARD", "amount": 1250, "ref": "AUTH123" }],
 *     "memberPhone": "0811111111",
 *     "idempotencyKey": "a6f1…" }            // optional, defaults to externalRef; retries return the same receipt
 *   → 201 (200 on replay)
 *   { "receiptNo": "M000124-B01-20261012-000159",
 *     "barcode": "PV1.M000124-B01-20261012-000159.Xy12_abc",   // print as QR (and receiptNo as Code128)
 *     "eligibleAmount": 1250, "validationEnabled": true, "replay": false, "saleId": 42 }
 *
 * POST /api/pos/external/receipts/:receiptNo/void    { "reason": "customer cancelled" }
 * POST /api/pos/external/receipts/:receiptNo/refund  { "amount": 200, "reason": "returned item" }
 *   → { "receiptNo", "status": "VOIDED|REFUNDED|PARTIALLY_REFUNDED", "refundedAmount",
 *       "parking": null | { "action": "REVOKED|RECALCULATED|AUDIT_ONLY|MANAGER_REVIEW", "parkingNo" } }
 *   A receipt already used for parking validation follows the site refund policy.
 * Errors: { "error": "<CODE>", "message": "…" } with 400/401/403/404/409.
 */
const extGuard = requireDevice('POS');

function extMerchant(req: Request) {
  const mid = req.device!.merchantId;
  if (!mid) throw forbidden('DEVICE_NOT_BOUND_TO_MERCHANT');
  return mid;
}

function extResult(s: ReturnType<typeof getSale>, replay: boolean) {
  const m = q.get('SELECT validation_enabled FROM merchants WHERE id=?', s.merchant_id)!;
  const v = saleView(s);
  return { saleId: s.id, receiptNo: s.receipt_no, barcode: v.barcode, eligibleAmount: r2(s.total - s.refunded_amount), validationEnabled: !!m.validation_enabled, status: s.status, replay };
}

router.post(
  '/external/receipts',
  extGuard,
  h((req, res) => {
    const mid = extMerchant(req);
    const b = body(req) as Record<string, any>;
    const r = createExternalSale(mid, req.device!.id, b as never);
    const s = getSale(mid, r.saleId);
    if (!r.replay) audit(req, { action: 'pos.external_receipt', entityType: 'pos_sale', entityId: s.id, merchantId: mid, receiptNo: s.receipt_no, after: { total: s.total, externalRef: b.externalRef } });
    res.status(r.replay ? 200 : 201).json(extResult(s, r.replay));
  }),
);

router.post(
  '/external/receipts/:receiptNo/void',
  extGuard,
  h((req, res) => {
    const mid = extMerchant(req);
    const s = getSaleByReceipt(mid, String(req.params.receiptNo));
    const reason = reqStr(body(req), 'reason', 300);
    const m = q.get('SELECT site_id FROM merchants WHERE id=?', mid)!;
    const r = voidSale(s, { reason, userId: null, tz: siteTz(m.site_id), anyDay: true });
    audit(req, { action: 'pos.void', entityType: 'pos_sale', entityId: s.id, merchantId: mid, receiptNo: s.receipt_no, before: { status: s.status }, after: { status: 'VOIDED' }, reason, meta: { external: true, parking: r.parking } });
    res.json({ receiptNo: s.receipt_no, status: r.sale.status, refundedAmount: r.sale.refunded_amount, parking: r.parking });
  }),
);

router.post(
  '/external/receipts/:receiptNo/refund',
  extGuard,
  h((req, res) => {
    const mid = extMerchant(req);
    const s = getSaleByReceipt(mid, String(req.params.receiptNo));
    const b = body(req);
    const reason = reqStr(b, 'reason', 300);
    const r = refundSale(s, { amount: num(b, 'amount', { required: true, min: 0.01 }), reason, method: str(b, 'method') ?? null, userId: null, approvedBy: null });
    audit(req, {
      action: 'pos.refund', entityType: 'pos_sale', entityId: s.id, merchantId: mid, receiptNo: s.receipt_no,
      before: { status: s.status, refunded: s.refunded_amount }, after: { status: r.sale.status, refunded: r.sale.refunded_amount }, reason, meta: { external: true, amount: r.amount, parking: r.parking },
    });
    res.json({ receiptNo: s.receipt_no, status: r.sale.status, refundedAmount: r.sale.refunded_amount, parking: r.parking });
  }),
);

// ---------------------------------------------------------------- context --

function deviceInfo(deviceId: number | null) {
  if (!deviceId) return null;
  const d = q.get('SELECT id, name, type, settings_json, connection_json FROM devices WHERE id=?', deviceId);
  if (!d) return null;
  const settings = json<Record<string, unknown>>(d.settings_json, {});
  return { id: d.id, name: d.name, printer: (settings.printer as unknown) ?? null, cashDrawer: settings.cashDrawer !== false, displayEnabled: settings.displayEnabled !== false };
}

router.get(
  '/me',
  requireUserOrDevice(['pos.sell', 'merchant.portal', 'pos.reports'], ['POS']),
  h((req, res) => {
    const ctx = posContext(req, { allowInactivePos: true });
    const shift = ctx.userId ? openShiftFor(ctx.merchantId, ctx.userId) : null;
    res.json({
      merchant: { ...merchantView(ctx.merchant), receipt_info: receiptInfo(ctx.merchant) },
      branch: ctx.branch,
      device: deviceInfo(ctx.deviceId),
      user: req.user ? { id: req.user.id, displayName: req.user.displayName, role: req.user.role } : null,
      shift: shift ?? null,
      heldCount: q.get<{ n: number }>('SELECT COUNT(*) n FROM held_bills WHERE merchant_id=? AND branch_id=?', ctx.merchantId, ctx.branchId)!.n,
      tz: ctx.tz,
    });
  }),
);

/** Merchant-user scope for portal / back-office routes. */
function ctxOf(req: Request, opts: { allowInactivePos?: boolean } = { allowInactivePos: true }): PosContext {
  return posContext(req, { requireUser: true, ...opts });
}

// ------------------------------------------------- categories & products --

router.get(
  '/categories',
  perm('pos.sell', 'pos.products', 'merchant.portal'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const all = req.query.all === '1';
    res.json({ items: q.all(`SELECT * FROM product_categories WHERE merchant_id=? ${all ? '' : 'AND active=1'} ORDER BY sort, name`, ctx.merchantId) });
  }),
);

router.post(
  '/categories',
  perm('pos.products'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const b = body(req);
    const cid = q.insert('product_categories', { merchant_id: ctx.merchantId, name: reqStr(b, 'name', 80), sort: int(b, 'sort') ?? 0 });
    const row = q.get('SELECT * FROM product_categories WHERE id=?', cid);
    audit(req, { action: 'pos.category_create', entityType: 'product_category', entityId: cid, merchantId: ctx.merchantId, after: row });
    res.status(201).json({ category: row });
  }),
);

router.put(
  '/categories/:id',
  perm('pos.products'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const before = q.get('SELECT * FROM product_categories WHERE id=? AND merchant_id=?', id(req), ctx.merchantId);
    if (!before) throw notFound('CATEGORY_NOT_FOUND');
    const b = body(req);
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch.name = reqStr(b, 'name', 80);
    if (b.sort !== undefined) patch.sort = int(b, 'sort') ?? 0;
    if (b.active !== undefined) patch.active = bool(b, 'active') ? 1 : 0;
    q.update('product_categories', before.id, patch);
    const after = q.get('SELECT * FROM product_categories WHERE id=?', before.id);
    audit(req, { action: 'pos.category_update', entityType: 'product_category', entityId: before.id, merchantId: ctx.merchantId, before, after });
    res.json({ category: after });
  }),
);

router.delete(
  '/categories/:id',
  perm('pos.products'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const before = q.get('SELECT * FROM product_categories WHERE id=? AND merchant_id=?', id(req), ctx.merchantId);
    if (!before) throw notFound('CATEGORY_NOT_FOUND');
    q.update('product_categories', before.id, { active: 0 });
    audit(req, { action: 'pos.category_delete', entityType: 'product_category', entityId: before.id, merchantId: ctx.merchantId, before });
    res.json({ ok: true });
  }),
);

function productView(p: Record<string, any>) {
  const { variants_json, modifiers_json, ...rest } = p;
  return { ...rest, vat_applicable: !!p.vat_applicable, track_stock: !!p.track_stock, active: !!p.active, variants: json(variants_json, []), modifiers: json(modifiers_json, []) };
}

function productPatch(b: Record<string, unknown>, partial: boolean, merchantId: number) {
  const patch: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) patch.name = reqStr(b, 'name', 120);
  if (!partial || b.price !== undefined) patch.price = num(b, 'price', { required: true, min: 0, max: 10_000_000 });
  if (b.categoryId !== undefined) {
    const cid = num(b, 'categoryId') ?? null;
    if (cid && !q.get('SELECT 1 FROM product_categories WHERE id=? AND merchant_id=?', cid, merchantId)) throw badRequest('CATEGORY_NOT_FOUND');
    patch.category_id = cid;
  }
  if (b.sku !== undefined) patch.sku = str(b, 'sku', { max: 40 }) ?? null;
  if (b.barcode !== undefined) patch.barcode = str(b, 'barcode', { max: 40 }) ?? null;
  if (b.imageUrl !== undefined) patch.image_url = str(b, 'imageUrl', { max: 300 }) ?? null;
  if (b.sort !== undefined) patch.sort = int(b, 'sort') ?? 0;
  if (b.vatApplicable !== undefined) patch.vat_applicable = bool(b, 'vatApplicable') ? 1 : 0;
  if (b.trackStock !== undefined) patch.track_stock = bool(b, 'trackStock') ? 1 : 0;
  if (b.stock !== undefined) patch.stock = num(b, 'stock') ?? null;
  if (b.active !== undefined) patch.active = bool(b, 'active') ? 1 : 0;
  if (b.variants !== undefined) {
    if (!Array.isArray(b.variants)) throw badRequest('VALIDATION', 'variants must be an array');
    const v = (b.variants as Array<{ name?: string; price?: number }>).map((x) => ({ name: String(x.name ?? '').trim().slice(0, 60), price: r2(Number(x.price) || 0) })).filter((x) => x.name);
    if (new Set(v.map((x) => x.name)).size !== v.length) throw badRequest('VALIDATION', 'duplicate variant name');
    patch.variants_json = JSON.stringify(v);
  }
  if (b.modifiers !== undefined) {
    if (!Array.isArray(b.modifiers)) throw badRequest('VALIDATION', 'modifiers must be an array');
    const m = (b.modifiers as Array<{ group?: string; multi?: boolean; options?: Array<{ name?: string; price?: number }> }>)
      .map((g) => ({
        group: String(g.group ?? '').trim().slice(0, 60),
        multi: !!g.multi,
        options: (g.options ?? []).map((o) => ({ name: String(o.name ?? '').trim().slice(0, 60), price: r2(Number(o.price) || 0) })).filter((o) => o.name),
      }))
      .filter((g) => g.group && g.options.length);
    patch.modifiers_json = JSON.stringify(m);
  }
  return patch;
}

router.get(
  '/products',
  perm('pos.sell', 'pos.products', 'merchant.portal'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const all = req.query.all === '1';
    res.json({ items: q.all(`SELECT * FROM products WHERE merchant_id=? ${all ? '' : 'AND active=1'} ORDER BY sort, name`, ctx.merchantId).map(productView) });
  }),
);

router.post(
  '/products',
  perm('pos.products'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const patch = productPatch(body(req), false, ctx.merchantId);
    const pid = q.insert('products', { merchant_id: ctx.merchantId, ...patch });
    const row = productView(q.get('SELECT * FROM products WHERE id=?', pid)!);
    audit(req, { action: 'pos.product_create', entityType: 'product', entityId: pid, merchantId: ctx.merchantId, after: row });
    res.status(201).json({ product: row });
  }),
);

function ownProduct(merchantId: number, pid: number) {
  const p = q.get('SELECT * FROM products WHERE id=? AND merchant_id=?', pid, merchantId);
  if (!p) throw notFound('PRODUCT_NOT_FOUND');
  return p;
}

router.put(
  '/products/:id',
  perm('pos.products'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const before = ownProduct(ctx.merchantId, id(req));
    q.update('products', before.id, productPatch(body(req), true, ctx.merchantId));
    const after = q.get('SELECT * FROM products WHERE id=?', before.id)!;
    audit(req, { action: 'pos.product_update', entityType: 'product', entityId: before.id, merchantId: ctx.merchantId, before: productView(before), after: productView(after) });
    res.json({ product: productView(after) });
  }),
);

router.post(
  '/products/:id/image',
  perm('pos.products'),
  uploadSingle,
  h((req, res) => {
    const ctx = ctxOf(req);
    const p = ownProduct(ctx.merchantId, id(req));
    if (!req.file) throw badRequest('FILE_REQUIRED');
    const f = storePublicFile(req.file.buffer, 'products', ['IMAGE'], req.file.originalname, req.user!.id, 'product-image');
    q.update('products', p.id, { image_url: f.url });
    audit(req, { action: 'pos.product_image', entityType: 'product', entityId: p.id, merchantId: ctx.merchantId, before: { image_url: p.image_url }, after: { image_url: f.url } });
    res.json({ url: f.url });
  }),
);

router.delete(
  '/products/:id',
  perm('pos.products'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const before = ownProduct(ctx.merchantId, id(req));
    q.update('products', before.id, { active: 0 }); // sales history references products
    audit(req, { action: 'pos.product_delete', entityType: 'product', entityId: before.id, merchantId: ctx.merchantId, before: productView(before) });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ staff --

const STAFF_ROLES = ['MERCHANT_MANAGER', 'MERCHANT_CASHIER'] as const;
const pinOf = (b: Record<string, unknown>, required: boolean) => {
  const pin = str(b, 'pin', { required, max: 8 });
  if (pin !== undefined && !/^\d{4,6}$/.test(pin)) throw badRequest('VALIDATION', 'PIN must be 4–6 digits');
  return pin;
};

router.get(
  '/staff',
  perm('merchant.staff', 'merchant.portal'),
  h((req, res) => {
    const ctx = ctxOf(req);
    res.json({
      items: q.all(
        `SELECT u.id, u.username, u.display_name, u.role, u.branch_id, u.active, u.last_login_at, u.created_at, b.code branch_code
           FROM users u LEFT JOIN merchant_branches b ON b.id=u.branch_id WHERE u.merchant_id=? ORDER BY u.active DESC, u.role, u.username`,
        ctx.merchantId,
      ),
      branches: q.all('SELECT id, code, name FROM merchant_branches WHERE merchant_id=? AND active=1 ORDER BY code', ctx.merchantId),
    });
  }),
);

function branchOf(merchantId: number, v: number | undefined, fallback: number) {
  if (!v) return fallback;
  if (!q.get('SELECT 1 FROM merchant_branches WHERE id=? AND merchant_id=?', v, merchantId)) throw badRequest('BRANCH_NOT_FOUND');
  return v;
}

router.post(
  '/staff',
  perm('merchant.staff'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const b = body(req);
    const username = reqStr(b, 'username', 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw badRequest('VALIDATION', 'username: a–z 0–9 . _ - (3–40)');
    const password = reqStr(b, 'password', 200);
    if (password.length < 8) throw badRequest('VALIDATION', 'password must be at least 8 characters');
    const pin = pinOf(b, true)!;
    const role = oneOf(b, 'role', STAFF_ROLES, true)!;
    if (q.get('SELECT 1 FROM users WHERE username=?', username)) throw conflict('USERNAME_TAKEN');
    const uid = q.insert('users', {
      username,
      display_name: reqStr(b, 'displayName', 80),
      password_hash: hashPassword(password),
      pin_hash: hashPassword(pin),
      role,
      merchant_id: ctx.merchantId,
      branch_id: branchOf(ctx.merchantId, num(b, 'branchId'), ctx.branchId),
    });
    audit(req, { action: 'pos.staff_create', entityType: 'user', entityId: uid, merchantId: ctx.merchantId, after: { username, role } });
    res.status(201).json({ id: uid, username, role });
  }),
);

function ownStaff(req: Request, ctx: PosContext) {
  const u = q.get('SELECT * FROM users WHERE id=? AND merchant_id=?', id(req), ctx.merchantId);
  if (!u) throw notFound('USER_NOT_FOUND');
  if (u.role === 'MERCHANT_OWNER' && u.id !== req.user!.id) throw forbidden('CANNOT_EDIT_OWNER');
  return u;
}

router.put(
  '/staff/:id',
  perm('merchant.staff'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const u = ownStaff(req, ctx);
    const b = body(req);
    const patch: Record<string, unknown> = {};
    if (b.displayName !== undefined) patch.display_name = reqStr(b, 'displayName', 80);
    if (b.role !== undefined && u.role !== 'MERCHANT_OWNER') patch.role = oneOf(b, 'role', STAFF_ROLES, true);
    if (b.branchId !== undefined) patch.branch_id = branchOf(ctx.merchantId, num(b, 'branchId'), u.branch_id);
    if (b.active !== undefined) {
      if (u.id === req.user!.id) throw badRequest('CANNOT_DEACTIVATE_SELF');
      patch.active = bool(b, 'active') ? 1 : 0;
      if (!patch.active) q.run('DELETE FROM auth_tokens WHERE user_id=?', u.id);
    }
    if (b.password !== undefined) {
      const pw = reqStr(b, 'password', 200);
      if (pw.length < 8) throw badRequest('VALIDATION', 'password must be at least 8 characters');
      patch.password_hash = hashPassword(pw);
    }
    const pin = pinOf(b, false);
    if (pin) patch.pin_hash = hashPassword(pin);
    q.update('users', u.id, patch);
    audit(req, {
      action: 'pos.staff_update', entityType: 'user', entityId: u.id, merchantId: ctx.merchantId,
      before: { role: u.role, active: !!u.active, branch_id: u.branch_id, display_name: u.display_name },
      after: { ...Object.fromEntries(Object.entries(patch).filter(([k]) => !k.endsWith('_hash'))), passwordChanged: !!patch.password_hash, pinChanged: !!patch.pin_hash },
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- devices --

router.get(
  '/devices',
  perm('merchant.portal', 'merchant.settings'),
  h((req, res) => {
    const ctx = ctxOf(req);
    res.json({
      items: q.all('SELECT id, name, type, status, last_seen_at, active, settings_json, created_at FROM devices WHERE merchant_id=? ORDER BY id', ctx.merchantId).map((d) => {
        const { settings_json, ...rest } = d;
        return { ...rest, settings: json(settings_json, {}) };
      }),
    });
  }),
);

router.put(
  '/devices/:id',
  perm('merchant.settings'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const d = q.get('SELECT * FROM devices WHERE id=? AND merchant_id=?', id(req), ctx.merchantId);
    if (!d) throw notFound('DEVICE_NOT_FOUND');
    const b = body(req) as Record<string, any>;
    const settings = json<Record<string, unknown>>(d.settings_json, {});
    if (b.printer !== undefined) {
      const p = b.printer;
      if (p === null || p === '') delete settings.printer;
      else {
        const mode = ['bridge', 'lan', 'edge'].includes(p.mode) ? p.mode : 'bridge';
        const bridgeUrl = p.bridgeUrl ? String(p.bridgeUrl).slice(0, 200) : undefined;
        if (bridgeUrl && !/^https?:\/\//.test(bridgeUrl)) throw badRequest('VALIDATION', 'bridgeUrl must be http(s)');
        settings.printer = { ...(p.id ? { id: Number(p.id) } : {}), connection: { mode, bridgeUrl, paperWidth: p.paperWidth === '58' ? '58' : '80' } };
      }
    }
    if (b.cashDrawer !== undefined) settings.cashDrawer = !!b.cashDrawer;
    if (b.displayEnabled !== undefined) settings.displayEnabled = !!b.displayEnabled;
    const patch: Record<string, unknown> = { settings_json: JSON.stringify(settings) };
    if (b.name !== undefined) patch.name = reqStr(b, 'name', 80);
    q.update('devices', d.id, patch);
    audit(req, { action: 'pos.device_update', entityType: 'device', entityId: d.id, deviceId: d.id, merchantId: ctx.merchantId, before: { name: d.name, settings: json(d.settings_json, {}) }, after: { name: patch.name ?? d.name, settings } });
    res.json({ ok: true, settings });
  }),
);

// ----------------------------------------------------------------- shifts --

router.get(
  '/shifts',
  perm('pos.shift', 'pos.reports'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const { limit, offset } = paging(req);
    const mine = !can(req, 'pos.reports');
    res.json({
      items: q.all(
        `SELECT s.*, u.display_name user_name FROM pos_shifts s JOIN users u ON u.id=s.user_id
          WHERE s.merchant_id=? ${mine ? 'AND s.user_id=?' : ''} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
        ...(mine ? [ctx.merchantId, ctx.userId, limit, offset] : [ctx.merchantId, limit, offset]),
      ),
    });
  }),
);

router.get(
  '/shifts/current',
  perm('pos.shift', 'pos.sell'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const s = openShiftFor(ctx.merchantId, ctx.userId!);
    res.json({ shift: s ?? null, report: s ? shiftReport(s.id) : null });
  }),
);

router.post(
  '/shifts/open',
  perm('pos.shift'),
  h((req, res) => {
    const ctx = ctxOf(req, { allowInactivePos: false });
    if (openShiftFor(ctx.merchantId, ctx.userId!)) throw conflict('SHIFT_ALREADY_OPEN');
    const openingCash = r2(num(body(req), 'openingCash', { min: 0, max: 10_000_000 }) ?? 0);
    const sid = q.insert('pos_shifts', { merchant_id: ctx.merchantId, branch_id: ctx.branchId, device_id: ctx.deviceId, user_id: ctx.userId, opening_cash: openingCash });
    audit(req, { action: 'pos.shift_open', entityType: 'pos_shift', entityId: sid, merchantId: ctx.merchantId, deviceId: ctx.deviceId, after: { openingCash } });
    res.status(201).json({ shift: q.get('SELECT * FROM pos_shifts WHERE id=?', sid) });
  }),
);

router.post(
  '/shifts/cash',
  perm('pos.shift'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const s = openShiftFor(ctx.merchantId, ctx.userId!);
    if (!s) throw conflict('SHIFT_NOT_OPEN');
    const b = body(req);
    const type = oneOf(b, 'type', ['IN', 'OUT'] as const, true)!;
    const amount = r2(num(b, 'amount', { required: true, min: 0.01, max: 10_000_000 })!);
    const reason = reqStr(b, 'reason', 300);
    const mid = q.insert('cash_movements', { shift_id: s.id, type, amount, reason, user_id: ctx.userId });
    audit(req, { action: `pos.cash_${type.toLowerCase()}`, entityType: 'cash_movement', entityId: mid, merchantId: ctx.merchantId, deviceId: ctx.deviceId, after: { amount, shiftId: s.id }, reason });
    res.json({ ok: true, report: shiftReport(s.id) });
  }),
);

router.post(
  '/drawer',
  perm('pos.sell'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const s = openShiftFor(ctx.merchantId, ctx.userId!);
    if (!s) throw conflict('SHIFT_NOT_OPEN');
    const reason = str(body(req), 'reason', { max: 200 }) ?? 'manual';
    q.insert('cash_movements', { shift_id: s.id, type: 'OPEN_DRAWER', amount: 0, reason, user_id: ctx.userId });
    audit(req, { action: 'pos.drawer_open', entityType: 'pos_shift', entityId: s.id, merchantId: ctx.merchantId, deviceId: ctx.deviceId, reason });
    res.json({ ok: true });
  }),
);

router.post(
  '/shifts/close',
  perm('pos.shift'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const s = openShiftFor(ctx.merchantId, ctx.userId!);
    if (!s) throw conflict('SHIFT_NOT_OPEN');
    const b = body(req);
    const counted = r2(num(b, 'countedCash', { required: true, min: 0, max: 10_000_000 })!);
    const before = shiftReport(s.id);
    q.run("UPDATE pos_shifts SET status='CLOSED', closed_at=?, closing_cash=?, expected_cash=?, note=? WHERE id=? AND status='OPEN'", new Date().toISOString(), counted, before.expectedCash, str(b, 'note', { max: 500 }) ?? null, s.id);
    const report = shiftReport(s.id);
    audit(req, { action: 'pos.shift_close', entityType: 'pos_shift', entityId: s.id, merchantId: ctx.merchantId, deviceId: ctx.deviceId, after: { expected: report.expectedCash, counted, difference: report.difference } });
    res.json({ report });
  }),
);

router.get(
  '/shifts/:id/report',
  perm('pos.shift', 'pos.reports'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const s = q.get('SELECT * FROM pos_shifts WHERE id=? AND merchant_id=?', id(req), ctx.merchantId);
    if (!s) throw notFound('SHIFT_NOT_FOUND');
    if (!can(req, 'pos.reports') && s.user_id !== ctx.userId) throw forbidden();
    res.json(shiftReport(s.id));
  }),
);

// ------------------------------------------------------------ held bills --

router.get(
  '/held',
  perm('pos.sell'),
  h((req, res) => {
    const ctx = ctxOf(req);
    res.json({
      items: q
        .all('SELECT h.*, u.display_name user_name FROM held_bills h LEFT JOIN users u ON u.id=h.user_id WHERE h.merchant_id=? AND h.branch_id=? ORDER BY h.id DESC', ctx.merchantId, ctx.branchId)
        .map(({ cart_json, ...r }) => ({ ...r, cart: json(cart_json, {}) })),
    });
  }),
);

router.post(
  '/held',
  perm('pos.sell'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const b = body(req);
    const cart = b.cart as { items?: unknown[] } | undefined;
    if (!cart || !Array.isArray(cart.items) || !cart.items.length) throw badRequest('EMPTY_CART');
    const raw = JSON.stringify(cart);
    if (raw.length > 200_000) throw badRequest('VALIDATION', 'cart too large');
    const n = q.get<{ n: number }>('SELECT COUNT(*) n FROM held_bills WHERE merchant_id=? AND branch_id=?', ctx.merchantId, ctx.branchId)!.n;
    const hid = q.insert('held_bills', { merchant_id: ctx.merchantId, branch_id: ctx.branchId, user_id: ctx.userId, name: str(b, 'name', { max: 60 }) ?? `บิล #${n + 1}`, cart_json: raw });
    res.status(201).json({ id: hid });
  }),
);

router.get(
  '/held/:id',
  perm('pos.sell'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const row = q.get('SELECT * FROM held_bills WHERE id=? AND merchant_id=?', id(req), ctx.merchantId);
    if (!row) throw notFound('HELD_BILL_NOT_FOUND');
    const { cart_json, ...r } = row;
    res.json({ ...r, cart: json(cart_json, {}) });
  }),
);

router.delete(
  '/held/:id',
  perm('pos.sell'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const r = q.run('DELETE FROM held_bills WHERE id=? AND merchant_id=?', id(req), ctx.merchantId);
    if (!r.changes) throw notFound('HELD_BILL_NOT_FOUND');
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ sales --

router.post(
  '/quote',
  perm('pos.sell'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const b = body(req) as Record<string, any>;
    res.json(priceCart(ctx.merchant, b.items, b.billDiscount));
  }),
);

router.post(
  '/sales',
  perm('pos.sell'),
  h((req, res) => {
    const ctx = ctxOf(req, { allowInactivePos: false });
    const b = body(req) as Record<string, any>;
    const r = createSale(ctx, { items: b.items, billDiscount: b.billDiscount, memberPhone: b.memberPhone, payments: b.payments, idempotencyKey: b.idempotencyKey });
    const sale = getSale(ctx.merchantId, r.saleId);
    if (!r.replay) {
      audit(req, { action: 'pos.sale', entityType: 'pos_sale', entityId: sale.id, merchantId: ctx.merchantId, deviceId: ctx.deviceId, receiptNo: sale.receipt_no, after: { total: sale.total, payments: json(sale.payments_json, []) } });
    }
    res.status(r.replay ? 200 : 201).json({ sale: saleView(sale), receipt: receiptData(sale.id), change: r.change ?? receiptData(sale.id).change, replay: r.replay });
  }),
);

router.get(
  '/sales',
  perm('pos.sell', 'pos.reports', 'merchant.portal'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const { limit, offset } = paging(req);
    const mineOnly = !can(req, 'pos.reports') && !can(req, 'merchant.portal');
    res.json(
      listSales(ctx.merchantId, {
        from: req.query.from ? String(req.query.from) : mineOnly ? localDayRange(ctx.tz).from : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        validation: req.query.validation ? String(req.query.validation) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
        cashierId: mineOnly ? ctx.userId! : undefined,
        limit,
        offset,
      }),
    );
  }),
);

router.get(
  '/sales/:id',
  perm('pos.sell', 'pos.reports', 'merchant.portal'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const s = getSale(ctx.merchantId, id(req));
    const usage = q.get(
      `SELECT u.*, p.parking_no, p.plate_text, p.province, d.status discount_status FROM receipt_usages u JOIN parking_sessions p ON p.id=u.session_id
         LEFT JOIN parking_discounts d ON d.id=u.discount_id WHERE u.sale_id=?`,
      s.id,
    );
    res.json({
      sale: saleView(s),
      receipt: receiptData(s.id),
      refunds: q.all('SELECT r.*, u.display_name user_name, a.display_name approved_by_name FROM pos_refunds r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN users a ON a.id=r.approved_by WHERE sale_id=? ORDER BY id', s.id),
      parkingUsage: usage ?? null,
    });
  }),
);

/** Approver must hold `perm` and belong to the same merchant. */
function merchantApproval(req: Request, ctx: PosContext, p: Permission): Approval {
  const a = verifyApproval(req, (body(req).approval ?? undefined) as never, p);
  if (a.userId !== req.user!.id) {
    const u = q.get('SELECT merchant_id FROM users WHERE id=?', a.userId);
    if (u?.merchant_id !== ctx.merchantId) throw new HttpError(403, 'APPROVER_NOT_ALLOWED', 'approver must be a manager/owner of this merchant');
  }
  return a;
}

router.post(
  '/sales/:id/void',
  perm('pos.sell', 'pos.void'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const s = getSale(ctx.merchantId, id(req));
    const reason = reqStr(body(req), 'reason', 300);
    const approval = merchantApproval(req, ctx, 'pos.void');
    const r = voidSale(s, { reason, userId: ctx.userId, tz: ctx.tz });
    audit(req, {
      action: 'pos.void', entityType: 'pos_sale', entityId: s.id, merchantId: ctx.merchantId, deviceId: ctx.deviceId, receiptNo: s.receipt_no,
      before: { status: s.status, total: s.total, parking_validation_status: s.parking_validation_status },
      after: { status: r.sale.status, parking_validation_status: r.sale.parking_validation_status }, reason, approvedBy: approval, meta: { parking: r.parking },
    });
    res.json({ sale: saleView(r.sale), parking: r.parking });
  }),
);

router.post(
  '/sales/:id/refund',
  perm('pos.sell', 'pos.refund'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const s = getSale(ctx.merchantId, id(req));
    const b = body(req) as Record<string, any>;
    const reason = reqStr(b, 'reason', 300);
    const approval = merchantApproval(req, ctx, 'pos.refund');
    const r = refundSale(s, {
      amount: b.amount !== undefined ? Number(b.amount) : undefined,
      items: Array.isArray(b.items) ? b.items : undefined,
      reason,
      method: str(b, 'method') ?? null,
      userId: ctx.userId,
      approvedBy: approval.userId,
    });
    audit(req, {
      action: 'pos.refund', entityType: 'pos_sale', entityId: s.id, merchantId: ctx.merchantId, deviceId: ctx.deviceId, receiptNo: s.receipt_no,
      before: { status: s.status, refunded: s.refunded_amount, parking_validation_status: s.parking_validation_status },
      after: { status: r.sale.status, refunded: r.sale.refunded_amount, parking_validation_status: r.sale.parking_validation_status },
      reason, approvedBy: approval, meta: { amount: r.amount, method: r.method, refundId: r.refundId, parking: r.parking },
    });
    res.json({ sale: saleView(r.sale), refundId: r.refundId, amount: r.amount, parking: r.parking });
  }),
);

router.post(
  '/sales/:id/reprint',
  perm('pos.sell'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const s = getSale(ctx.merchantId, id(req));
    q.run('UPDATE pos_sales SET reprint_count=reprint_count+1 WHERE id=?', s.id);
    audit(req, { action: 'pos.reprint', entityType: 'pos_sale', entityId: s.id, merchantId: ctx.merchantId, deviceId: ctx.deviceId, receiptNo: s.receipt_no, before: { reprint_count: s.reprint_count }, after: { reprint_count: s.reprint_count + 1 }, reason: str(body(req), 'reason') ?? null });
    res.json({ receipt: receiptData(s.id) });
  }),
);

router.post(
  '/promptpay-qr',
  perm('pos.sell'),
  h(async (req, res) => {
    const ctx = ctxOf(req);
    const amount = r2(num(body(req), 'amount', { required: true, min: 0.01, max: 10_000_000 })!);
    const target = receiptInfo(ctx.merchant).promptPayId;
    if (!target) throw conflict('PROMPTPAY_NOT_CONFIGURED', 'ร้านยังไม่ได้ตั้งค่า PromptPay ID (Merchant Portal → ตั้งค่า)');
    const payload = promptPayPayload(target, amount);
    res.json({ payload, amount, dataUrl: await QRCode.toDataURL(payload, { margin: 1, width: 360, errorCorrectionLevel: 'M' }) });
  }),
);

// ------------------------------------------------------ dashboard & reports --

router.get(
  '/dashboard',
  perm('merchant.portal', 'pos.reports'),
  h((req, res) => {
    const ctx = ctxOf(req);
    res.json(merchantStats(ctx.merchantId));
  }),
);

router.get(
  '/reports',
  perm('pos.reports'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const from = req.query.from ? String(req.query.from) : localDayRange(ctx.tz, -6).from;
    const to = req.query.to ? String(req.query.to) : localDayRange(ctx.tz).to;
    res.json(salesReport(ctx.merchantId, from, to, ctx.tz));
  }),
);

// --------------------------------------------------------------- settings --

router.get(
  '/settings',
  perm('merchant.settings', 'merchant.portal'),
  h((req, res) => {
    const ctx = ctxOf(req);
    res.json({ merchant: merchantView(ctx.merchant), receipt: receiptInfo(ctx.merchant) });
  }),
);

router.put(
  '/settings',
  perm('merchant.settings'),
  h((req, res) => {
    const ctx = ctxOf(req);
    const b = body(req) as Record<string, any>;
    const prev = json<ReceiptInfo>(ctx.merchant.receipt_info_json, {});
    const r = (b.receipt ?? {}) as Record<string, unknown>;
    const next: ReceiptInfo = { ...prev };
    const text = (k: keyof ReceiptInfo, max: number) => {
      if (r[k] !== undefined) (next as Record<string, unknown>)[k] = String(r[k] ?? '').slice(0, max);
    };
    text('header', 300);
    text('footer', 300);
    text('branchName', 120);
    if (r.taxId !== undefined) next.taxId = String(r.taxId ?? '').replace(/[^0-9]/g, '').slice(0, 13);
    if (r.promptPayId !== undefined) next.promptPayId = String(r.promptPayId ?? '').replace(/[^0-9]/g, '').slice(0, 15);
    if (r.vatRegistered !== undefined) next.vatRegistered = !!r.vatRegistered;
    if (r.vatMode !== undefined) next.vatMode = r.vatMode === 'EXCLUDED' ? 'EXCLUDED' : 'INCLUDED';
    if (r.vatRate !== undefined) {
      const v = Number(r.vatRate);
      if (!(v >= 0 && v <= 30)) throw badRequest('VALIDATION', 'vatRate must be 0–30');
      next.vatRate = v;
    }
    if (r.serviceChargePercent !== undefined) {
      const v = Number(r.serviceChargePercent);
      if (!(v >= 0 && v <= 30)) throw badRequest('VALIDATION', 'serviceChargePercent must be 0–30');
      next.serviceChargePercent = v;
    }
    const patch: Record<string, unknown> = { receipt_info_json: JSON.stringify(next) };
    if (b.logoUrl !== undefined) patch.logo_url = str(b, 'logoUrl', { max: 300 }) ?? null;
    if (b.storefrontUrl !== undefined) patch.storefront_url = str(b, 'storefrontUrl', { max: 300 }) ?? null;
    q.update('merchants', ctx.merchantId, patch);
    const after = q.get('SELECT * FROM merchants WHERE id=?', ctx.merchantId)!;
    audit(req, { action: 'merchant.settings_update', entityType: 'merchant', entityId: ctx.merchantId, merchantId: ctx.merchantId, before: { receipt: prev, logo_url: ctx.merchant.logo_url }, after: { receipt: next, logo_url: after.logo_url } });
    res.json({ merchant: merchantView(after), receipt: receiptInfo(after) });
  }),
);

// -------------------------------------------------------- customer display --

router.post(
  '/display',
  requireUserOrDevice(['pos.sell'], ['POS']),
  h((req, res) => {
    const ctx = posContext(req, { allowInactivePos: true });
    const cart = body(req).cart;
    if (JSON.stringify(cart ?? null).length > 100_000) throw badRequest('VALIDATION', 'cart too large');
    emit.merchant(ctx.merchantId, 'pos:cart', { deviceId: ctx.deviceId, branchId: ctx.branchId, cart: cart ?? null, at: new Date().toISOString() });
    res.json({ ok: true });
  }),
);

router.get(
  '/display/info',
  requireUserOrDevice(['pos.sell', 'merchant.portal'], ['POS']),
  h((req, res) => {
    const ctx = posContext(req, { allowInactivePos: true });
    res.json({ merchant: { id: ctx.merchantId, name: ctx.merchant.name, code: ctx.merchant.code, logo_url: ctx.merchant.logo_url, storefront_url: ctx.merchant.storefront_url }, branch: { code: ctx.branch.code, name: ctx.branch.name }, deviceId: ctx.deviceId });
  }),
);

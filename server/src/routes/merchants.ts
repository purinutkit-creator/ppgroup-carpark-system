/**
 * Merchant registration (public) and administration.
 *   POST /api/merchants/register                     public, multipart (logo, storefront), rate-limited per IP
 *   GET  /api/merchants?status&q                      merchants.view
 *   GET  /api/merchants/:id                           detail + branches, users, POS devices, stats
 *   POST /api/merchants/:id/approve                   merchants.approve → Merchant ID, B01, owner + POS key (shown once)
 *   POST /api/merchants/:id/{activate|suspend|close|reactivate|reject} {reason}
 *   POST /api/merchants/:id/pos {enabled}
 *   POST /api/merchants/:id/reset-credentials {userId}
 *   POST /api/merchants/:id/pos-devices {name}        new POS device key (shown once)
 *   GET/POST /api/merchants/:id/branches, PUT /api/merchants/:id/branches/:bid
 *   PUT  /api/merchants/:id                           profile / receipt info
 *   PUT  /api/merchants/:id/validation {validation_enabled, validation_min_spend}
 *   GET/POST /api/merchants/:id/promotions, PUT/DELETE /api/merchants/:id/promotions/:rid
 *   POST /api/merchants/promotions/apply-all {rule}   one rule for every ACTIVE merchant
 *   GET  /api/merchants/:id/{transactions|receipts|validations|refunds|audit|stats|reports}
 */
import { Router, type Request } from 'express';
import multer from 'multer';
import { q, json, nowIso } from '../db/index.ts';
import { body, bool, h, HttpError, num, paging, reqStr, str, badRequest, conflict, notFound } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { hashPassword } from '../lib/crypto.ts';
import { storePublicFile } from './media.ts';
import {
  MERCHANT_ACTIONS,
  MERCHANT_STATUSES,
  approveMerchant,
  createPosDevice,
  getMerchant,
  listMerchants,
  localDayRange,
  merchantDetail,
  merchantPromotions,
  merchantStats,
  merchantView,
  promotionFromBody,
  promotionView,
  randomPin,
  registrationRef,
  siteTz,
  tempPassword,
  transitionMerchant,
  type ReceiptInfo,
} from '../services/merchants.ts';
import { listSales, salesReport } from '../services/pos.ts';

export const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 2, fields: 60 } });

// ------------------------------------------------------------ registration --

const regHits = new Map<string, number[]>();
const REG_LIMIT = 5;
const REG_WINDOW = 3600_000;
function rateLimit(req: Request) {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const hits = (regHits.get(ip) ?? []).filter((t) => now - t < REG_WINDOW);
  if (hits.length >= REG_LIMIT) throw new HttpError(429, 'TOO_MANY_REQUESTS', 'ส่งคำขอสมัครบ่อยเกินไป กรุณาลองใหม่ภายหลัง');
  hits.push(now);
  regHits.set(ip, hits);
}

const CATEGORIES = ['CAFE', 'RESTAURANT', 'SUPERMARKET', 'CINEMA', 'FASHION', 'BEAUTY', 'ELECTRONICS', 'SERVICE', 'VIP_STORE', 'OTHER'];

/** Multipart fields arrive as strings; nested objects may be sent as JSON strings or bracket keys. */
function objField(b: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = b[key];
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try {
      return JSON.parse(v);
    } catch {
      throw badRequest('VALIDATION', `${key} must be JSON`);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(b)) {
    const m = new RegExp(`^${key}[.\\[]([a-zA-Z]+)\\]?$`).exec(k);
    if (m) out[m[1]] = val;
  }
  return out;
}

function receiptInfoFrom(o: Record<string, unknown>, prev: ReceiptInfo = {}): ReceiptInfo {
  const s = (k: string, max = 300) => (o[k] === undefined ? undefined : String(o[k] ?? '').trim().slice(0, max));
  const next: ReceiptInfo = { ...prev };
  if (o.header !== undefined) next.header = s('header');
  if (o.footer !== undefined) next.footer = s('footer');
  if (o.taxId !== undefined) next.taxId = s('taxId', 20);
  if (o.branchName !== undefined) next.branchName = s('branchName', 120);
  if (o.promptPayId !== undefined) next.promptPayId = s('promptPayId', 20)?.replace(/[^0-9]/g, '');
  if (o.vatRegistered !== undefined) next.vatRegistered = o.vatRegistered === true || o.vatRegistered === 'true' || o.vatRegistered === '1' || o.vatRegistered === 1;
  if (o.vatMode !== undefined) next.vatMode = o.vatMode === 'EXCLUDED' ? 'EXCLUDED' : 'INCLUDED';
  if (o.vatRate !== undefined) {
    const r = Number(o.vatRate);
    if (!(r >= 0 && r <= 30)) throw badRequest('VALIDATION', 'vatRate must be 0–30');
    next.vatRate = r;
  }
  if (o.serviceChargePercent !== undefined) {
    const r = Number(o.serviceChargePercent);
    if (!(r >= 0 && r <= 30)) throw badRequest('VALIDATION', 'serviceChargePercent must be 0–30');
    next.serviceChargePercent = r;
  }
  return next;
}

router.post(
  '/register',
  (req, _res, next) => {
    try {
      rateLimit(req);
      next();
    } catch (e) {
      next(e);
    }
  },
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'storefront', maxCount: 1 },
  ]),
  h((req, res) => {
    const b = body(req);
    const email = reqStr(b, 'email', 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('VALIDATION', 'email is invalid');
    const phone = reqStr(b, 'phone', 20).replace(/[^0-9+]/g, '');
    if (phone.length < 9) throw badRequest('VALIDATION', 'phone is invalid');
    const taxId = str(b, 'taxId', { max: 20 })?.replace(/[^0-9]/g, '');
    if (taxId && taxId.length !== 13) throw badRequest('VALIDATION', 'taxId must be 13 digits');
    const category = str(b, 'category', { max: 40 })?.toUpperCase() ?? 'OTHER';
    if (!CATEGORIES.includes(category)) throw badRequest('VALIDATION', `category must be one of ${CATEGORIES.join(', ')}`);
    const dup = q.get("SELECT id FROM merchants WHERE (email=? OR phone=?) AND status='PENDING'", email, phone);
    if (dup) throw conflict('ALREADY_PENDING', 'มีคำขอสมัครที่รอการอนุมัติด้วยอีเมลหรือเบอร์โทรนี้แล้ว');
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const logo = files.logo?.[0] ? storePublicFile(files.logo[0].buffer, 'merchants', ['IMAGE'], files.logo[0].originalname, null, 'merchant-logo').url : null;
    const storefront = files.storefront?.[0] ? storePublicFile(files.storefront[0].buffer, 'merchants', ['IMAGE'], files.storefront[0].originalname, null, 'merchant-storefront').url : null;
    const contact = objField(b, 'contact');
    const site = q.get<{ id: number }>('SELECT id FROM sites WHERE active=1 ORDER BY id LIMIT 1');
    const id = q.insert('merchants', {
      name: reqStr(b, 'name', 120),
      owner_first_name: reqStr(b, 'ownerFirstName', 80),
      owner_last_name: reqStr(b, 'ownerLastName', 80),
      phone,
      email,
      tax_id: taxId ?? null,
      category,
      unit_no: str(b, 'unitNo', { max: 30 }) ?? null,
      zone: str(b, 'zone', { max: 30 }) ?? null,
      floor: str(b, 'floor', { max: 30 }) ?? null,
      address: str(b, 'address', { max: 500 }) ?? null,
      logo_url: logo,
      storefront_url: storefront,
      receipt_info_json: JSON.stringify(receiptInfoFrom(objField(b, 'receipt'))),
      contact_json: JSON.stringify({
        name: String(contact.name ?? '').slice(0, 120),
        phone: String(contact.phone ?? '').replace(/[^0-9+]/g, '').slice(0, 20),
        email: String(contact.email ?? '').slice(0, 120),
        lineId: String(contact.lineId ?? '').slice(0, 60),
      }),
      site_id: site?.id ?? null,
      status: 'PENDING',
    });
    const m = getMerchant(id);
    const reference = registrationRef(id, m.created_at);
    audit(req, { action: 'merchant.register', entityType: 'merchant', entityId: id, merchantId: id, after: { name: m.name, email, phone, category }, meta: { reference } });
    res.status(201).json({ id, reference, status: 'PENDING' });
  }),
);

// ----------------------------------------------------------------- promotions apply-all (before /:id) --

router.post(
  '/promotions/apply-all',
  requirePerm('merchants.manage', 'validation.rules'),
  h((req, res) => {
    const b = body(req);
    const rule = (b.rule ?? b) as Record<string, unknown>;
    const ids = q.all<{ id: number }>("SELECT id FROM merchants WHERE status='ACTIVE' ORDER BY id").map((r) => r.id);
    if (!ids.length) throw conflict('NO_ACTIVE_MERCHANTS');
    const p = promotionFromBody(rule, ids);
    const id = q.insert('validation_rules', { name: p.name, scope: 'MERCHANT', config_json: JSON.stringify(p.config), priority: p.priority, combinable: p.combinable, active: p.active, created_by: req.user!.id });
    audit(req, { action: 'merchant.promotion.apply_all', entityType: 'validation_rule', entityId: id, after: { ...p, merchantIds: ids }, reason: str(b, 'reason') ?? null });
    res.status(201).json({ rule: promotionView(q.get('SELECT * FROM validation_rules WHERE id=?', id)!), merchantIds: ids });
  }),
);

// -------------------------------------------------------------------- admin --

router.get(
  '/',
  requirePerm('merchants.view', 'merchants.manage'),
  h((req, res) => {
    const { limit, offset } = paging(req);
    const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    if (status && !MERCHANT_STATUSES.includes(status as never)) throw badRequest('VALIDATION', 'invalid status');
    res.json(listMerchants({ status, q: req.query.q ? String(req.query.q).trim() : undefined, limit, offset }));
  }),
);

const mid = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw notFound('MERCHANT_NOT_FOUND');
  return id;
};

router.get(
  '/:id',
  requirePerm('merchants.view', 'merchants.manage'),
  h((req, res) => res.json(merchantDetail(mid(req)))),
);

router.get(
  '/:id/stats',
  requirePerm('merchants.view', 'merchants.manage'),
  h((req, res) => res.json(merchantStats(mid(req)))),
);

router.put(
  '/:id',
  requirePerm('merchants.manage'),
  h((req, res) => {
    const id = mid(req);
    const m = getMerchant(id);
    const b = body(req);
    const patch: Record<string, unknown> = {};
    const fields: Array<[string, string, number]> = [
      ['name', 'name', 120], ['ownerFirstName', 'owner_first_name', 80], ['ownerLastName', 'owner_last_name', 80], ['phone', 'phone', 20], ['email', 'email', 120],
      ['taxId', 'tax_id', 20], ['category', 'category', 40], ['unitNo', 'unit_no', 30], ['zone', 'zone', 30], ['floor', 'floor', 30], ['address', 'address', 500],
      ['logoUrl', 'logo_url', 300], ['storefrontUrl', 'storefront_url', 300],
    ];
    for (const [k, col, max] of fields) if (b[k] !== undefined) patch[col] = str(b, k, { max }) ?? null;
    if (b.siteId !== undefined) patch.site_id = num(b, 'siteId') ?? null;
    if (b.receipt !== undefined) patch.receipt_info_json = JSON.stringify(receiptInfoFrom(objField(b, 'receipt'), json<ReceiptInfo>(m.receipt_info_json, {})));
    if (b.contact !== undefined) patch.contact_json = JSON.stringify({ ...json(m.contact_json, {}), ...objField(b, 'contact') });
    q.update('merchants', id, patch);
    const after = getMerchant(id);
    audit(req, { action: 'merchant.update', entityType: 'merchant', entityId: id, merchantId: id, before: merchantView(m), after: merchantView(after) });
    res.json({ merchant: merchantView(after) });
  }),
);

router.post(
  '/:id/approve',
  requirePerm('merchants.approve'),
  h((req, res) => {
    const id = mid(req);
    const r = approveMerchant(id, req.user!.id);
    audit(req, {
      action: 'merchant.approve',
      entityType: 'merchant',
      entityId: id,
      merchantId: id,
      before: { status: 'PENDING' },
      after: { status: 'APPROVED', code: r.merchant.code, branch: r.branch.code, ownerUsername: r.credentials.username, posDeviceId: r.posDevice.id },
      reason: str(body(req), 'reason') ?? null,
    });
    res.json(r);
  }),
);

for (const action of MERCHANT_ACTIONS) {
  router.post(
    `/:id/${action}`,
    requirePerm(action === 'reject' || action === 'activate' ? 'merchants.approve' : 'merchants.manage', 'merchants.approve'),
    h((req, res) => {
      const id = mid(req);
      const reason = str(body(req), 'reason', { max: 500 }) ?? null;
      if ((action === 'suspend' || action === 'close' || action === 'reject') && !reason) throw badRequest('REASON_REQUIRED');
      const r = transitionMerchant(id, action, reason);
      audit(req, { action: `merchant.${action}`, entityType: 'merchant', entityId: id, merchantId: id, before: { status: r.before }, after: { status: r.after }, reason });
      res.json(r);
    }),
  );
}

router.post(
  '/:id/pos',
  requirePerm('merchants.manage'),
  h((req, res) => {
    const id = mid(req);
    const m = getMerchant(id);
    const enabled = bool(body(req), 'enabled');
    if (enabled === undefined) throw badRequest('VALIDATION', 'enabled is required');
    q.update('merchants', id, { pos_enabled: enabled ? 1 : 0 });
    audit(req, { action: enabled ? 'merchant.pos_enable' : 'merchant.pos_disable', entityType: 'merchant', entityId: id, merchantId: id, before: { pos_enabled: !!m.pos_enabled }, after: { pos_enabled: enabled }, reason: str(body(req), 'reason') ?? null });
    res.json({ ok: true, pos_enabled: enabled });
  }),
);

router.post(
  '/:id/reset-credentials',
  requirePerm('merchants.manage'),
  h((req, res) => {
    const id = mid(req);
    const userId = num(body(req), 'userId', { required: true })!;
    const u = q.get('SELECT * FROM users WHERE id=? AND merchant_id=?', userId, id);
    if (!u) throw notFound('USER_NOT_FOUND');
    const password = tempPassword();
    const pin = randomPin();
    q.update('users', u.id, { password_hash: hashPassword(password), pin_hash: hashPassword(pin), active: 1 });
    q.run('DELETE FROM auth_tokens WHERE user_id=?', u.id);
    audit(req, { action: 'merchant.reset_credentials', entityType: 'user', entityId: u.id, merchantId: id, after: { username: u.username }, reason: str(body(req), 'reason') ?? null });
    res.json({ userId: u.id, username: u.username, temporaryPassword: password, pin });
  }),
);

router.post(
  '/:id/pos-devices',
  requirePerm('merchants.manage'),
  h((req, res) => {
    const id = mid(req);
    const m = getMerchant(id);
    if (!m.code) throw conflict('NOT_APPROVED');
    const d = createPosDevice(m, str(body(req), 'name', { max: 80 }));
    audit(req, { action: 'merchant.pos_device_create', entityType: 'device', entityId: d.id, merchantId: id, deviceId: d.id });
    res.status(201).json({ id: d.id, key: d.key });
  }),
);

// ---------------------------------------------------------------- branches --

router.get(
  '/:id/branches',
  requirePerm('merchants.view', 'merchants.manage'),
  h((req, res) => res.json({ items: q.all('SELECT * FROM merchant_branches WHERE merchant_id=? ORDER BY code', mid(req)) })),
);

router.post(
  '/:id/branches',
  requirePerm('merchants.manage'),
  h((req, res) => {
    const id = mid(req);
    const m = getMerchant(id);
    const b = body(req);
    let code = str(b, 'code', { max: 10 })?.toUpperCase();
    if (!code) {
      const n = q.get<{ n: number }>('SELECT COUNT(*) n FROM merchant_branches WHERE merchant_id=?', id)!.n;
      code = `B${String(n + 1).padStart(2, '0')}`;
    }
    if (!/^[A-Z0-9]{1,10}$/.test(code)) throw badRequest('VALIDATION', 'code must be A–Z / 0–9');
    const bid = q.insert('merchant_branches', { merchant_id: id, code, name: reqStr(b, 'name', 120), site_id: num(b, 'siteId') ?? m.site_id ?? null });
    const row = q.get('SELECT * FROM merchant_branches WHERE id=?', bid);
    audit(req, { action: 'merchant.branch_create', entityType: 'merchant_branch', entityId: bid, merchantId: id, after: row });
    res.status(201).json({ branch: row });
  }),
);

router.put(
  '/:id/branches/:bid',
  requirePerm('merchants.manage'),
  h((req, res) => {
    const id = mid(req);
    const before = q.get('SELECT * FROM merchant_branches WHERE id=? AND merchant_id=?', Number(req.params.bid), id);
    if (!before) throw notFound('BRANCH_NOT_FOUND');
    const b = body(req);
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch.name = reqStr(b, 'name', 120);
    if (b.siteId !== undefined) patch.site_id = num(b, 'siteId') ?? null;
    if (b.active !== undefined) patch.active = bool(b, 'active') ? 1 : 0;
    q.update('merchant_branches', before.id, patch);
    const after = q.get('SELECT * FROM merchant_branches WHERE id=?', before.id);
    audit(req, { action: 'merchant.branch_update', entityType: 'merchant_branch', entityId: before.id, merchantId: id, before, after });
    res.json({ branch: after });
  }),
);

router.delete(
  '/:id/branches/:bid',
  requirePerm('merchants.manage'),
  h((req, res) => {
    const id = mid(req);
    const before = q.get('SELECT * FROM merchant_branches WHERE id=? AND merchant_id=?', Number(req.params.bid), id);
    if (!before) throw notFound('BRANCH_NOT_FOUND');
    // Branches carry receipt history: deactivate instead of deleting.
    q.update('merchant_branches', before.id, { active: 0 });
    audit(req, { action: 'merchant.branch_deactivate', entityType: 'merchant_branch', entityId: before.id, merchantId: id, before });
    res.json({ ok: true });
  }),
);

// --------------------------------------------------- validation eligibility --

router.put(
  '/:id/validation',
  requirePerm('merchants.manage', 'validation.rules'),
  h((req, res) => {
    const id = mid(req);
    const m = getMerchant(id);
    const b = body(req);
    const enabled = bool(b, 'validation_enabled');
    const minSpend = num(b, 'validation_min_spend', { min: 0, max: 1_000_000 });
    const patch: Record<string, unknown> = {};
    if (enabled !== undefined) patch.validation_enabled = enabled ? 1 : 0;
    if (minSpend !== undefined) patch.validation_min_spend = minSpend;
    q.update('merchants', id, patch);
    const after = getMerchant(id);
    audit(req, {
      action: 'merchant.validation_update',
      entityType: 'merchant',
      entityId: id,
      merchantId: id,
      before: { validation_enabled: !!m.validation_enabled, validation_min_spend: m.validation_min_spend },
      after: { validation_enabled: !!after.validation_enabled, validation_min_spend: after.validation_min_spend },
      reason: str(b, 'reason') ?? null,
    });
    res.json({ validation_enabled: !!after.validation_enabled, validation_min_spend: after.validation_min_spend });
  }),
);

// -------------------------------------------------------------- promotions --

router.get(
  '/:id/promotions',
  requirePerm('merchants.view', 'merchants.manage', 'validation.rules'),
  h((req, res) => res.json({ items: merchantPromotions(mid(req)) })),
);

router.post(
  '/:id/promotions',
  requirePerm('merchants.manage', 'validation.rules'),
  h((req, res) => {
    const id = mid(req);
    getMerchant(id);
    const p = promotionFromBody(body(req), [id]);
    const rid = q.insert('validation_rules', { name: p.name, scope: 'MERCHANT', config_json: JSON.stringify(p.config), priority: p.priority, combinable: p.combinable, active: p.active, created_by: req.user!.id });
    audit(req, { action: 'merchant.promotion_create', entityType: 'validation_rule', entityId: rid, merchantId: id, after: p });
    res.status(201).json({ rule: promotionView(q.get('SELECT * FROM validation_rules WHERE id=?', rid)!) });
  }),
);

function ownRule(merchantId: number, ruleId: number) {
  const r = q.get("SELECT * FROM validation_rules WHERE id=? AND scope='MERCHANT'", ruleId);
  if (!r || !json<{ merchantIds?: number[] }>(r.config_json, {}).merchantIds?.includes(merchantId)) throw notFound('PROMOTION_NOT_FOUND');
  return r;
}

router.put(
  '/:id/promotions/:rid',
  requirePerm('merchants.manage', 'validation.rules'),
  h((req, res) => {
    const id = mid(req);
    const before = ownRule(id, Number(req.params.rid));
    const merchantIds = json<{ merchantIds?: number[] }>(before.config_json, {}).merchantIds ?? [id];
    const p = promotionFromBody(body(req), merchantIds);
    q.update('validation_rules', before.id, { name: p.name, config_json: JSON.stringify(p.config), priority: p.priority, combinable: p.combinable, active: p.active, updated_at: nowIso() });
    const after = q.get('SELECT * FROM validation_rules WHERE id=?', before.id)!;
    audit(req, { action: 'merchant.promotion_update', entityType: 'validation_rule', entityId: before.id, merchantId: id, before: promotionView(before), after: promotionView(after) });
    res.json({ rule: promotionView(after) });
  }),
);

router.delete(
  '/:id/promotions/:rid',
  requirePerm('merchants.manage', 'validation.rules'),
  h((req, res) => {
    const id = mid(req);
    const before = ownRule(id, Number(req.params.rid));
    const cfg = json<{ merchantIds?: number[] }>(before.config_json, {});
    const rest = (cfg.merchantIds ?? []).filter((x) => x !== id);
    // A shared ("apply to all") rule only drops this merchant; a merchant-only rule is deactivated (kept for history).
    if (rest.length) q.update('validation_rules', before.id, { config_json: JSON.stringify({ ...cfg, merchantIds: rest }), updated_at: nowIso() });
    else q.update('validation_rules', before.id, { active: 0, updated_at: nowIso() });
    audit(req, { action: 'merchant.promotion_delete', entityType: 'validation_rule', entityId: before.id, merchantId: id, before: promotionView(before), meta: { remainingMerchants: rest } });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------- history & reports --

function salesFilter(req: Request) {
  const { limit, offset } = paging(req);
  return {
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    validation: req.query.validation ? String(req.query.validation) : undefined,
    q: req.query.q ? String(req.query.q) : undefined,
    limit,
    offset,
  };
}

router.get(
  '/:id/transactions',
  requirePerm('merchants.view', 'merchants.manage'),
  h((req, res) => res.json(listSales(mid(req), salesFilter(req)))),
);

router.get(
  '/:id/receipts',
  requirePerm('merchants.view', 'merchants.manage'),
  h((req, res) => res.json(listSales(mid(req), salesFilter(req)))),
);

router.get(
  '/:id/validations',
  requirePerm('merchants.view', 'merchants.manage'),
  h((req, res) => {
    const { limit, offset } = paging(req);
    const id = mid(req);
    res.json({
      items: q.all(
        `SELECT u.*, p.parking_no, p.plate_text, p.province, p.status session_status, d.type discount_type, d.amount discount_amount,
                d.free_minutes, d.full_waiver, d.status discount_status, us.display_name scanned_by_name
           FROM receipt_usages u JOIN parking_sessions p ON p.id=u.session_id LEFT JOIN parking_discounts d ON d.id=u.discount_id
           LEFT JOIN users us ON us.id=u.scanned_by WHERE u.merchant_id=? ORDER BY u.id DESC LIMIT ? OFFSET ?`,
        id,
        limit,
        offset,
      ),
      total: q.get<{ n: number }>('SELECT COUNT(*) n FROM receipt_usages WHERE merchant_id=?', id)!.n,
    });
  }),
);

router.get(
  '/:id/refunds',
  requirePerm('merchants.view', 'merchants.manage'),
  h((req, res) => {
    const id = mid(req);
    const refunds = q.all(
      `SELECT 'REFUND' kind, r.id, r.created_at at, r.amount, r.reason, r.method, s.receipt_no, s.id sale_id, s.parking_validation_status,
              u.display_name user_name, a.display_name approved_by_name
         FROM pos_refunds r JOIN pos_sales s ON s.id=r.sale_id LEFT JOIN users u ON u.id=r.user_id LEFT JOIN users a ON a.id=r.approved_by
        WHERE s.merchant_id=?`,
      id,
    );
    const voids = q.all(
      `SELECT 'VOID' kind, s.id, s.voided_at at, s.total amount, s.void_reason reason, NULL method, s.receipt_no, s.id sale_id, s.parking_validation_status,
              u.display_name user_name, NULL approved_by_name
         FROM pos_sales s LEFT JOIN users u ON u.id=s.voided_by WHERE s.merchant_id=? AND s.status='VOIDED'`,
      id,
    );
    res.json({ items: [...refunds, ...voids].sort((a, b) => String(b.at).localeCompare(String(a.at))) });
  }),
);

router.get(
  '/:id/audit',
  requirePerm('merchants.view', 'audit.view'),
  h((req, res) => {
    const { limit, offset } = paging(req);
    const id = mid(req);
    res.json({ items: q.all('SELECT * FROM audit_logs WHERE merchant_id=? ORDER BY id DESC LIMIT ? OFFSET ?', id, limit, offset) });
  }),
);

router.get(
  '/:id/reports',
  requirePerm('merchants.view', 'reports.view'),
  h((req, res) => {
    const id = mid(req);
    const m = getMerchant(id);
    const tz = siteTz(m.site_id);
    const from = req.query.from ? String(req.query.from) : localDayRange(tz, -6).from;
    const to = req.query.to ? String(req.query.to) : localDayRange(tz).to;
    res.json(salesReport(id, from, to, tz));
  }),
);

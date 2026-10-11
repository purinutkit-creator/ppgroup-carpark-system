/**
 * Admin: members, member vehicles, tiers, passes (members.manage) and plate
 * lists (lists.manage). Plates are always stored by canonical plate_key
 * (prefix|number|province) built with the shared plate helpers.
 */
import { Router } from 'express';
import { q, json, tx, type Row } from '../db/index.ts';
import { body, h, int, num, oneOf, reqStr, str, bool, badRequest, conflict, paging } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { assertSiteWrite, beforeOf, changed, idParam, isoOrNull, like, mustGet, plateFrom } from './admin-common.ts';

export const membersRouter = Router();
const guard = requirePerm('members.manage');
const listGuard = requirePerm('lists.manage');

type Obj = Record<string, unknown>;

function phone(b: Obj) {
  const p = reqStr(b, 'phone', 20).replace(/[\s-]/g, '');
  if (!/^\+?\d{9,15}$/.test(p)) throw badRequest('INVALID_PHONE', 'เบอร์โทรศัพท์ไม่ถูกต้อง');
  return p;
}
function email(b: Obj) {
  const e = str(b, 'email', { max: 200 });
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw badRequest('INVALID_EMAIL', 'อีเมลไม่ถูกต้อง');
  return e ?? null;
}
function tier(b: Obj) {
  const t = str(b, 'tier', { max: 30 }) ?? 'REGULAR';
  if (!q.get('SELECT code FROM member_tiers WHERE code=?', t)) throw badRequest('UNKNOWN_TIER');
  return t;
}

// ---------------------------------------------------------------- members --

membersRouter.get(
  '/members',
  guard,
  h((req, res) => {
    const { limit, offset } = paging(req);
    const l = like(req.query.q);
    const where = `(? IS NULL OR m.phone LIKE ? OR m.first_name LIKE ? OR m.last_name LIKE ? OR m.email LIKE ?
        OR EXISTS (SELECT 1 FROM member_vehicles v WHERE v.member_id=m.id AND (v.plate_prefix || v.plate_number) LIKE ?))
      AND (? IS NULL OR m.tier=?) AND (?=1 OR m.active=1)`;
    const params = [l, l, l, l, l, l ? l.replace(/\s/g, '') : null, req.query.tier || null, req.query.tier || null, req.query.all === '1' ? 1 : 0];
    const total = q.get<{ n: number }>(`SELECT COUNT(*) n FROM members m WHERE ${where}`, ...params)!.n;
    const rows = q.all(
      `SELECT m.*, t.name tier_name FROM members m LEFT JOIN member_tiers t ON t.code=m.tier WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const ids = rows.map((r) => r.id);
    const vehicles = ids.length ? q.all(`SELECT * FROM member_vehicles WHERE member_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids) : [];
    res.json({ total, items: rows.map((m) => ({ ...m, vehicles: vehicles.filter((v) => v.member_id === m.id) })) });
  }),
);

membersRouter.get(
  '/members/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const m = mustGet('members', id);
    res.json({
      ...m,
      vehicles: q.all('SELECT * FROM member_vehicles WHERE member_id=? ORDER BY id', id),
      passes: q.all('SELECT * FROM passes WHERE member_id=? ORDER BY valid_to DESC', id),
      recentSessions: q.all(
        `SELECT id, parking_no, plate_text, entry_at, exit_at, status, payment_status FROM parking_sessions
          WHERE member_id=? ORDER BY id DESC LIMIT 20`,
        id,
      ),
    });
  }),
);

function vehicleRow(memberId: number, v: Obj) {
  const p = plateFrom({ prefix: str(v, 'prefix'), number: str(v, 'number'), plate: str(v, 'plate'), province: str(v, 'province') });
  return { member_id: memberId, plate_prefix: p.prefix, plate_number: p.number, province: p.provinceCode, plate_key: p.key, vehicle_type: (str(v, 'vehicleType', { max: 30 }) ?? 'CAR').toUpperCase() };
}

membersRouter.post(
  '/members',
  guard,
  h((req, res) => {
    const b = body(req);
    const consent = b.consent === true ? new Date().toISOString() : isoOrNull(b.consentAt, 'consentAt');
    const row = {
      phone: phone(b),
      first_name: reqStr(b, 'firstName', 100),
      last_name: str(b, 'lastName', { max: 100 }) ?? null,
      email: email(b),
      tier: tier(b),
      consent_at: consent,
    };
    if (q.get('SELECT id FROM members WHERE phone=?', row.phone)) throw conflict('PHONE_EXISTS', 'เบอร์โทรนี้เป็นสมาชิกอยู่แล้ว');
    const vehicles = Array.isArray(b.vehicles) ? (b.vehicles as Obj[]) : [];
    const id = tx(() => {
      const mid = q.insert('members', row);
      for (const v of vehicles) q.insert('member_vehicles', vehicleRow(mid, v));
      return mid;
    });
    audit(req, { action: 'member.create', entityType: 'member', entityId: id, after: { ...row, vehicles: vehicles.length } });
    res.json({ id });
  }),
);

membersRouter.put(
  '/members/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('members', id);
    const b = body(req);
    const patch: Record<string, unknown> = {};
    if (b.phone !== undefined) {
      patch.phone = phone(b);
      if (q.get('SELECT id FROM members WHERE phone=? AND id!=?', patch.phone, id)) throw conflict('PHONE_EXISTS', 'เบอร์โทรนี้เป็นสมาชิกอยู่แล้ว');
    }
    if (b.firstName !== undefined) patch.first_name = reqStr(b, 'firstName', 100);
    if (b.lastName !== undefined) patch.last_name = str(b, 'lastName', { max: 100 }) ?? null;
    if (b.email !== undefined) patch.email = email(b);
    if (b.tier !== undefined) patch.tier = tier(b);
    if (b.consent === true && !before.consent_at) patch.consent_at = new Date().toISOString();
    else if (b.consent === false) patch.consent_at = null;
    else if (b.consentAt !== undefined) patch.consent_at = isoOrNull(b.consentAt, 'consentAt');
    if (b.active !== undefined) patch.active = bool(b, 'active') ? 1 : 0;
    const diff = changed(before, patch);
    q.update('members', id, diff);
    audit(req, { action: 'member.update', entityType: 'member', entityId: id, before: beforeOf(before, diff), after: diff });
    res.json({ ok: true });
  }),
);

membersRouter.delete(
  '/members/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('members', id);
    q.run('UPDATE members SET active=0 WHERE id=?', id);
    audit(req, { action: 'member.deactivate', entityType: 'member', entityId: id, before: { active: before.active }, after: { active: 0 } });
    res.json({ ok: true });
  }),
);

membersRouter.post(
  '/members/:id/vehicles',
  guard,
  h((req, res) => {
    const id = idParam(req);
    mustGet('members', id);
    const row = vehicleRow(id, body(req));
    const other = q.get('SELECT m.id, m.first_name FROM member_vehicles v JOIN members m ON m.id=v.member_id WHERE v.plate_key=? AND m.active=1 AND m.id!=?', row.plate_key, id);
    if (other) throw conflict('PLATE_BELONGS_TO_OTHER_MEMBER', `ทะเบียนนี้ผูกกับสมาชิก #${other.id} แล้ว`);
    const vid = q.insert('member_vehicles', row);
    audit(req, { action: 'member.vehicle_add', entityType: 'member', entityId: id, after: row });
    res.json({ id: vid });
  }),
);

membersRouter.delete(
  '/members/:id/vehicles/:vid',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const vid = idParam(req, 'vid');
    const v = q.get('SELECT * FROM member_vehicles WHERE id=? AND member_id=?', vid, id);
    if (!v) throw badRequest('NOT_FOUND');
    q.run('DELETE FROM member_vehicles WHERE id=?', vid);
    audit(req, { action: 'member.vehicle_remove', entityType: 'member', entityId: id, before: v });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ tiers --

function benefits(v: unknown) {
  const o = (v && typeof v === 'object' ? v : {}) as Obj;
  return {
    extraFreeMinutes: Math.max(0, Math.round(Number(o.extraFreeMinutes) || 0)),
    discountPercent: Math.min(100, Math.max(0, Number(o.discountPercent) || 0)),
    ticketless: o.ticketless === true,
  };
}

membersRouter.get(
  '/member-tiers',
  requirePerm('members.manage', 'validation.rules'),
  h((_req, res) => {
    res.json({
      items: q.all('SELECT t.*, (SELECT COUNT(*) FROM members m WHERE m.tier=t.code AND m.active=1) members FROM member_tiers t ORDER BY sort, code').map((t) => ({
        ...t,
        benefits: benefits(json(t.benefits_json, {})),
      })),
    });
  }),
);

membersRouter.post(
  '/member-tiers',
  guard,
  h((req, res) => {
    const b = body(req);
    const code = reqStr(b, 'code', 30).toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(code)) throw badRequest('INVALID_CODE');
    const row = { code, name: reqStr(b, 'name', 100), sort: int(b, 'sort') ?? 0, benefits_json: JSON.stringify(benefits(b.benefits)) };
    q.insert('member_tiers', row);
    audit(req, { action: 'member_tier.create', entityType: 'member_tier', entityId: code, after: row });
    res.json({ code });
  }),
);

membersRouter.put(
  '/member-tiers/:code',
  guard,
  h((req, res) => {
    const code = String(req.params.code);
    const before = q.get('SELECT * FROM member_tiers WHERE code=?', code);
    if (!before) throw badRequest('UNKNOWN_TIER');
    const b = body(req);
    const after = {
      name: b.name !== undefined ? reqStr(b, 'name', 100) : before.name,
      sort: b.sort !== undefined ? (int(b, 'sort') ?? 0) : before.sort,
      benefits_json: b.benefits !== undefined ? JSON.stringify(benefits(b.benefits)) : before.benefits_json,
    };
    q.run('UPDATE member_tiers SET name=?, sort=?, benefits_json=? WHERE code=?', after.name, after.sort, after.benefits_json, code);
    audit(req, { action: 'member_tier.update', entityType: 'member_tier', entityId: code, before, after });
    res.json({ ok: true });
  }),
);

membersRouter.delete(
  '/member-tiers/:code',
  guard,
  h((req, res) => {
    const code = String(req.params.code);
    const before = q.get('SELECT * FROM member_tiers WHERE code=?', code);
    if (!before) throw badRequest('UNKNOWN_TIER');
    if (code === 'REGULAR') throw conflict('DEFAULT_TIER', 'ไม่สามารถลบระดับเริ่มต้นได้');
    const n = q.get<{ n: number }>('SELECT COUNT(*) n FROM members WHERE tier=?', code)!.n;
    if (n) throw conflict('TIER_IN_USE', `มีสมาชิกใช้ระดับนี้ ${n} คน`);
    q.run('DELETE FROM member_tiers WHERE code=?', code);
    audit(req, { action: 'member_tier.delete', entityType: 'member_tier', entityId: code, before });
    res.json({ ok: true });
  }),
);

// ----------------------------------------------------------------- passes --

const PASS_TYPES = ['MONTHLY', 'YEARLY', 'STAFF', 'PERMIT'] as const;

function passRow(b: Obj, current?: Row) {
  const out: Record<string, unknown> = {};
  if (!current || b.type !== undefined) out.type = oneOf(b, 'type', PASS_TYPES, true);
  if (!current || b.plate !== undefined || b.prefix !== undefined || b.province !== undefined) {
    const p = plateFrom({ prefix: str(b, 'prefix'), number: str(b, 'number'), plate: str(b, 'plate'), province: str(b, 'province') });
    Object.assign(out, { plate_key: p.key, plate_text: p.plateText, province: p.provinceCode });
  }
  if (!current || b.memberId !== undefined) {
    const mid = int(b, 'memberId') ?? null;
    if (mid) mustGet('members', mid, 'MEMBER_NOT_FOUND');
    out.member_id = mid;
  }
  if (!current || b.holderName !== undefined) out.holder_name = str(b, 'holderName', { max: 200 }) ?? null;
  if (!current || b.siteId !== undefined) {
    const sid = int(b, 'siteId') ?? null;
    if (sid) mustGet('sites', sid, 'SITE_NOT_FOUND');
    out.site_id = sid;
  }
  if (!current || b.validFrom !== undefined) out.valid_from = isoOrNull(b.validFrom, 'validFrom') ?? new Date().toISOString();
  if (!current || b.validTo !== undefined) {
    const vt = isoOrNull(b.validTo, 'validTo');
    if (!vt) throw badRequest('VALIDATION', 'validTo is required');
    out.valid_to = vt;
  }
  const from = (out.valid_from ?? current?.valid_from) as string;
  const to = (out.valid_to ?? current?.valid_to) as string;
  if (to <= from) throw badRequest('VALIDATION', 'วันสิ้นสุดต้องหลังวันเริ่ม');
  for (const k of ['ticketless', 'free_parking'] as const) {
    const key = k === 'free_parking' ? 'freeParking' : k;
    if (!current || b[key] !== undefined) out[k] = bool(b, key) === false ? 0 : 1;
  }
  if (!current || b.price !== undefined) out.price = num(b, 'price', { min: 0 }) ?? 0;
  if (current && b.active !== undefined) out.active = bool(b, 'active') ? 1 : 0;
  return out;
}

membersRouter.get(
  '/passes',
  guard,
  h((req, res) => {
    const { limit, offset } = paging(req);
    const l = like(req.query.q);
    const status = String(req.query.status ?? '');
    const now = new Date().toISOString();
    const rows = q.all(
      `SELECT p.*, m.first_name || ' ' || COALESCE(m.last_name,'') member_name, s.name site_name FROM passes p
         LEFT JOIN members m ON m.id=p.member_id LEFT JOIN sites s ON s.id=p.site_id
        WHERE (? IS NULL OR p.plate_text LIKE ? OR p.holder_name LIKE ?) AND (? IS NULL OR p.type=?)
          AND (?='' OR (?='valid' AND p.active=1 AND p.valid_from<=? AND p.valid_to>=?) OR (?='expired' AND p.valid_to<?) OR (?='inactive' AND p.active=0))
          AND (?='inactive' OR ?='all' OR p.active=1)
        ORDER BY p.id DESC LIMIT ? OFFSET ?`,
      l, l, l,
      req.query.type || null, req.query.type || null,
      status, status, now, now, status, now, status, status, status,
      limit, offset,
    );
    res.json({ items: rows });
  }),
);

membersRouter.post(
  '/passes',
  guard,
  h((req, res) => {
    const row = passRow(body(req));
    assertSiteWrite(req, row.site_id as number | null);
    const id = q.insert('passes', row);
    audit(req, { action: 'pass.create', entityType: 'pass', entityId: id, siteId: row.site_id as number | null, after: row });
    res.json({ id });
  }),
);

membersRouter.put(
  '/passes/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('passes', id);
    assertSiteWrite(req, before.site_id);
    const diff = changed(before, passRow(body(req), before));
    if ('site_id' in diff) assertSiteWrite(req, diff.site_id as number | null);
    q.update('passes', id, diff);
    audit(req, { action: 'pass.update', entityType: 'pass', entityId: id, siteId: before.site_id, before: beforeOf(before, diff), after: diff });
    res.json({ ok: true });
  }),
);

membersRouter.delete(
  '/passes/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('passes', id);
    assertSiteWrite(req, before.site_id);
    q.run('UPDATE passes SET active=0 WHERE id=?', id);
    audit(req, { action: 'pass.deactivate', entityType: 'pass', entityId: id, siteId: before.site_id, before: { active: before.active }, after: { active: 0 } });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------ plate lists --

const LIST_TYPES = ['WHITELIST', 'BLACKLIST', 'EXEMPT', 'SPECIAL_RATE'] as const;

function listRow(b: Obj, current?: Row) {
  const out: Record<string, unknown> = {};
  const type = b.listType !== undefined || !current ? oneOf(b, 'listType', LIST_TYPES, true)! : current.list_type;
  if (!current || b.listType !== undefined) out.list_type = type;
  if (!current || b.plate !== undefined || b.prefix !== undefined || b.province !== undefined) {
    const p = plateFrom({ prefix: str(b, 'prefix'), number: str(b, 'number'), plate: str(b, 'plate'), province: str(b, 'province') });
    Object.assign(out, { plate_key: p.key, plate_text: p.plateText, province: p.provinceCode });
  }
  if (!current || b.siteId !== undefined) {
    const sid = int(b, 'siteId') ?? null;
    if (sid) mustGet('sites', sid, 'SITE_NOT_FOUND');
    out.site_id = sid;
  }
  if (!current || b.reason !== undefined) out.reason = str(b, 'reason', { max: 500 }) ?? null;
  if (!current || b.ratePlanId !== undefined || b.listType !== undefined) {
    const rp = type === 'SPECIAL_RATE' ? (b.ratePlanId !== undefined ? (int(b, 'ratePlanId') ?? null) : (current?.rate_plan_id ?? null)) : null;
    if (type === 'SPECIAL_RATE' && !rp) throw badRequest('RATE_PLAN_REQUIRED', 'รายการอัตราพิเศษต้องเลือกแผนอัตรา');
    if (rp) mustGet('rate_plans', rp, 'RATE_PLAN_NOT_FOUND');
    out.rate_plan_id = rp;
  }
  if (!current || b.validFrom !== undefined) out.valid_from = isoOrNull(b.validFrom, 'validFrom');
  if (!current || b.validTo !== undefined) out.valid_to = isoOrNull(b.validTo, 'validTo');
  const from = (out.valid_from !== undefined ? out.valid_from : current?.valid_from) as string | null;
  const to = (out.valid_to !== undefined ? out.valid_to : current?.valid_to) as string | null;
  if (from && to && to <= from) throw badRequest('VALIDATION', 'วันสิ้นสุดต้องหลังวันเริ่ม');
  if (current && b.active !== undefined) out.active = bool(b, 'active') ? 1 : 0;
  return out;
}

membersRouter.get(
  '/plate-lists',
  listGuard,
  h((req, res) => {
    const { limit, offset } = paging(req);
    const l = like(typeof req.query.q === 'string' ? req.query.q.replace(/\s/g, '') : undefined);
    const type = req.query.type ? String(req.query.type) : null;
    const where = `(? IS NULL OR replace(l.plate_text,' ','') LIKE ? OR l.reason LIKE ?) AND (? IS NULL OR l.list_type=?) AND (?=1 OR l.active=1)`;
    const params = [l, l, l, type, type, req.query.all === '1' ? 1 : 0];
    const total = q.get<{ n: number }>(`SELECT COUNT(*) n FROM plate_lists l WHERE ${where}`, ...params)!.n;
    const rows = q.all(
      `SELECT l.*, s.name site_name, r.name rate_plan_name, u.display_name created_by_name FROM plate_lists l
         LEFT JOIN sites s ON s.id=l.site_id LEFT JOIN rate_plans r ON r.id=l.rate_plan_id LEFT JOIN users u ON u.id=l.created_by
        WHERE ${where} ORDER BY l.active DESC, l.id DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    res.json({ total, items: rows });
  }),
);

membersRouter.post(
  '/plate-lists',
  listGuard,
  h((req, res) => {
    const row = { ...listRow(body(req)), created_by: req.user!.id };
    assertSiteWrite(req, row.site_id as number | null);
    const id = q.insert('plate_lists', row);
    audit(req, { action: 'plate_list.create', entityType: 'plate_list', entityId: id, siteId: row.site_id as number | null, after: row, reason: (row.reason as string) ?? null });
    res.json({ id });
  }),
);

membersRouter.put(
  '/plate-lists/:id',
  listGuard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('plate_lists', id);
    assertSiteWrite(req, before.site_id);
    const diff = changed(before, listRow(body(req), before));
    if ('site_id' in diff) assertSiteWrite(req, diff.site_id as number | null);
    q.update('plate_lists', id, diff);
    audit(req, { action: 'plate_list.update', entityType: 'plate_list', entityId: id, siteId: before.site_id, before: beforeOf(before, diff), after: diff });
    res.json({ ok: true });
  }),
);

membersRouter.delete(
  '/plate-lists/:id',
  listGuard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('plate_lists', id);
    assertSiteWrite(req, before.site_id);
    q.run('UPDATE plate_lists SET active=0 WHERE id=?', id);
    audit(req, { action: 'plate_list.deactivate', entityType: 'plate_list', entityId: id, siteId: before.site_id, before: { active: before.active }, after: { active: 0 } });
    res.json({ ok: true });
  }),
);

/**
 * Admin: users and the role permission matrix (users.manage).
 * Rules: only an OWNER may create or modify an OWNER account; the last active
 * OWNER can never be deactivated or demoted; the OWNER role always keeps every
 * permission.
 */
import { Router, type Request } from 'express';
import { q, json, tx, type Row } from '../db/index.ts';
import { body, h, int, oneOf, reqStr, str, bool, badRequest, conflict, forbidden } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { hashPassword } from '../lib/crypto.ts';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES, invalidatePermissionCache, isMerchantRole, permissionsFor, type Role } from '../auth/rbac.ts';
import { idList, idParam, like, mustGet } from './admin-common.ts';

export const usersRouter = Router();
const guard = requirePerm('users.manage');

const USER_COLS = 'u.id, u.username, u.display_name, u.role, u.site_ids, u.merchant_id, u.branch_id, u.active, u.last_login_at, u.created_at, u.pin_hash IS NOT NULL has_pin';

function publicUser(u: Row) {
  return { ...u, site_ids: json<number[] | null>(u.site_ids, null), has_pin: !!u.has_pin };
}

function activeOwners(excludeId?: number) {
  return q.get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE role='OWNER' AND active=1 AND id!=?", excludeId ?? -1)!.n;
}

function assertCanTouch(req: Request, targetRole: string) {
  if (targetRole === 'OWNER' && req.user!.role !== 'OWNER') throw forbidden('OWNER_ONLY', 'เฉพาะ OWNER เท่านั้นที่จัดการบัญชี OWNER ได้');
}

function password(v: string) {
  if (v.length < 8) throw badRequest('WEAK_PASSWORD', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  return hashPassword(v);
}
function pin(v: string) {
  if (!/^\d{4,8}$/.test(v)) throw badRequest('INVALID_PIN', 'PIN ต้องเป็นตัวเลข 4–8 หลัก');
  return hashPassword(v);
}

/** Validate the merchant / branch link (required for merchant roles, cleared otherwise). */
function merchantLink(role: string, b: Record<string, unknown>, current?: Row) {
  if (!isMerchantRole(role)) return { merchant_id: null, branch_id: null };
  const merchantId = b.merchantId !== undefined ? (int(b, 'merchantId') ?? null) : (current?.merchant_id ?? null);
  if (!merchantId) throw badRequest('MERCHANT_REQUIRED', 'บทบาทร้านค้าต้องผูกกับร้านค้า');
  mustGet('merchants', merchantId, 'MERCHANT_NOT_FOUND');
  const branchId = b.branchId !== undefined ? (int(b, 'branchId') ?? null) : (current?.branch_id ?? null);
  if (branchId) {
    const br = mustGet('merchant_branches', branchId, 'BRANCH_NOT_FOUND');
    if (br.merchant_id !== merchantId) throw conflict('BRANCH_MERCHANT_MISMATCH');
  }
  return { merchant_id: merchantId, branch_id: branchId };
}

function siteScope(req: Request, v: unknown): number[] | null {
  const ids = idList(v);
  for (const id of ids ?? []) mustGet('sites', id, 'SITE_NOT_FOUND');
  // Site-scoped administrators can only grant sites they manage themselves.
  const mine = req.user!.siteIds;
  if (mine && (!ids || ids.some((i) => !mine.includes(i)))) throw forbidden('SITE_FORBIDDEN', 'ไม่สามารถกำหนดสาขานอกขอบเขตของตนเองได้');
  return ids;
}

usersRouter.get(
  '/users',
  guard,
  h((req, res) => {
    const l = like(req.query.q);
    const rows = q.all(
      `SELECT ${USER_COLS}, m.name merchant_name, b.name branch_name FROM users u
         LEFT JOIN merchants m ON m.id=u.merchant_id LEFT JOIN merchant_branches b ON b.id=u.branch_id
        WHERE (? IS NULL OR u.username LIKE ? OR u.display_name LIKE ?) AND (? IS NULL OR u.role=?) AND (?=1 OR u.active=1)
        ORDER BY u.active DESC, u.role, u.username`,
      l, l, l,
      req.query.role ? String(req.query.role) : null, req.query.role ? String(req.query.role) : null,
      req.query.all === '1' ? 1 : 0,
    );
    res.json({ items: rows.map(publicUser), roles: ROLES });
  }),
);

usersRouter.post(
  '/users',
  guard,
  h((req, res) => {
    const b = body(req);
    const role = oneOf(b, 'role', ROLES, true)!;
    assertCanTouch(req, role);
    const username = reqStr(b, 'username', 60).toLowerCase();
    if (!/^[a-z0-9._-]{3,60}$/.test(username)) throw badRequest('INVALID_USERNAME', 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - (3 ตัวขึ้นไป)');
    const siteIds = siteScope(req, b.siteIds);
    const row = {
      username,
      display_name: reqStr(b, 'displayName', 200),
      password_hash: password(reqStr(b, 'password', 200)),
      pin_hash: str(b, 'pin') ? pin(str(b, 'pin')!) : null,
      role,
      site_ids: siteIds ? JSON.stringify(siteIds) : null,
      ...merchantLink(role, b),
    };
    const id = q.insert('users', row);
    audit(req, { action: 'user.create', entityType: 'user', entityId: id, merchantId: row.merchant_id, after: { ...row, password_hash: undefined, pin_hash: undefined, hasPin: !!row.pin_hash } });
    res.json({ id });
  }),
);

usersRouter.put(
  '/users/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('users', id);
    assertCanTouch(req, before.role);
    const b = body(req);
    const patch: Record<string, unknown> = {};
    const role = b.role !== undefined ? oneOf(b, 'role', ROLES, true)! : before.role;
    assertCanTouch(req, role);
    if (role !== before.role) {
      if (before.role === 'OWNER' && before.active && activeOwners(id) === 0) throw conflict('LAST_OWNER', 'ไม่สามารถเปลี่ยนบทบาทของ OWNER คนสุดท้ายได้');
      patch.role = role;
    }
    if (b.displayName !== undefined) patch.display_name = reqStr(b, 'displayName', 200);
    if (b.siteIds !== undefined) {
      const ids = siteScope(req, b.siteIds);
      patch.site_ids = ids ? JSON.stringify(ids) : null;
    }
    if (b.role !== undefined || b.merchantId !== undefined || b.branchId !== undefined) Object.assign(patch, merchantLink(role, b, before));
    if (b.active !== undefined) {
      const active = bool(b, 'active') ? 1 : 0;
      if (!active && id === req.user!.id) throw conflict('CANNOT_DEACTIVATE_SELF');
      if (!active && before.role === 'OWNER' && activeOwners(id) === 0) throw conflict('LAST_OWNER', 'ไม่สามารถปิดใช้งาน OWNER คนสุดท้ายได้');
      patch.active = active;
    }
    const diff: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (before[k] !== v) diff[k] = v;
    tx(() => {
      q.update('users', id, diff);
      // Role / scope / status changes take effect immediately: drop sessions.
      if ('role' in diff || 'active' in diff || 'site_ids' in diff || 'merchant_id' in diff) q.run('DELETE FROM auth_tokens WHERE user_id=?', id);
    });
    const prev: Record<string, unknown> = {};
    for (const k of Object.keys(diff)) prev[k] = before[k];
    audit(req, { action: 'user.update', entityType: 'user', entityId: id, merchantId: before.merchant_id, before: prev, after: diff });
    res.json({ ok: true });
  }),
);

/** Set password and/or PIN. */
usersRouter.post(
  '/users/:id/credentials',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('users', id);
    assertCanTouch(req, before.role);
    const b = body(req);
    const patch: Record<string, unknown> = {};
    if (str(b, 'password')) patch.password_hash = password(str(b, 'password', { max: 200 })!);
    if (b.pin === null) patch.pin_hash = null;
    else if (str(b, 'pin')) patch.pin_hash = pin(str(b, 'pin')!);
    if (!Object.keys(patch).length) throw badRequest('NOTHING_TO_CHANGE');
    tx(() => {
      q.update('users', id, patch);
      if (patch.password_hash && id !== req.user!.id) q.run('DELETE FROM auth_tokens WHERE user_id=?', id);
    });
    audit(req, { action: 'user.credentials', entityType: 'user', entityId: id, after: { password: patch.password_hash ? 'changed' : undefined, pin: 'pin_hash' in patch ? (patch.pin_hash ? 'changed' : 'removed') : undefined } });
    res.json({ ok: true });
  }),
);

usersRouter.delete(
  '/users/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('users', id);
    assertCanTouch(req, before.role);
    if (id === req.user!.id) throw conflict('CANNOT_DEACTIVATE_SELF');
    if (before.role === 'OWNER' && activeOwners(id) === 0) throw conflict('LAST_OWNER', 'ไม่สามารถปิดใช้งาน OWNER คนสุดท้ายได้');
    tx(() => {
      q.run('UPDATE users SET active=0 WHERE id=?', id);
      q.run('DELETE FROM auth_tokens WHERE user_id=?', id);
    });
    audit(req, { action: 'user.deactivate', entityType: 'user', entityId: id, before: { active: before.active }, after: { active: 0 } });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------- role matrix -------

function roleMatrix() {
  const overrides = new Map(q.all<{ role: string; permissions: string }>('SELECT role, permissions FROM role_permissions').map((r) => [r.role, r.permissions]));
  return ROLES.map((role) => ({
    role,
    permissions: [...permissionsFor(role)],
    defaults: DEFAULT_ROLE_PERMISSIONS[role],
    overridden: overrides.has(role),
    users: q.get<{ n: number }>('SELECT COUNT(*) n FROM users WHERE role=? AND active=1', role)!.n,
  }));
}

usersRouter.get(
  '/roles',
  guard,
  h((_req, res) => {
    res.json({ roles: ROLES, permissions: PERMISSIONS, matrix: roleMatrix() });
  }),
);

usersRouter.put(
  '/roles/:role',
  guard,
  h((req, res) => {
    const role = String(req.params.role) as Role;
    if (!ROLES.includes(role)) throw badRequest('UNKNOWN_ROLE');
    const b = body(req);
    const before = [...permissionsFor(role)];
    let next: string[];
    if (b.reset === true) next = [...DEFAULT_ROLE_PERMISSIONS[role]];
    else {
      if (!Array.isArray(b.permissions)) throw badRequest('VALIDATION', 'permissions must be an array');
      const unknown = (b.permissions as unknown[]).filter((p) => !PERMISSIONS.includes(p as never));
      if (unknown.length) throw badRequest('UNKNOWN_PERMISSION', unknown.join(', '));
      next = [...new Set(b.permissions as string[])];
    }
    if (role === 'OWNER') {
      if (req.user!.role !== 'OWNER') throw forbidden('OWNER_ONLY');
      const missing = PERMISSIONS.filter((p) => !next.includes(p));
      if (missing.length) throw conflict('OWNER_CANNOT_BE_REDUCED', `OWNER ต้องมีทุกสิทธิ์ (ขาด ${missing.join(', ')})`);
    }
    // Don't let an admin remove users.manage from their own role and lock everyone out of this screen.
    if (role === req.user!.role && !next.includes('users.manage')) throw conflict('CANNOT_REMOVE_OWN_ACCESS', 'ไม่สามารถถอดสิทธิ์ users.manage ของบทบาทตนเองได้');
    tx(() => {
      if (b.reset === true) q.run('DELETE FROM role_permissions WHERE role=?', role);
      else q.run('INSERT INTO role_permissions (role, permissions) VALUES (?,?) ON CONFLICT(role) DO UPDATE SET permissions=excluded.permissions', role, JSON.stringify(next));
    });
    invalidatePermissionCache();
    audit(req, {
      action: 'role.permissions',
      entityType: 'role',
      entityId: role,
      before,
      after: next,
      meta: { added: next.filter((p) => !before.includes(p)), removed: before.filter((p) => !next.includes(p)), reset: b.reset === true },
    });
    res.json({ ok: true, matrix: roleMatrix() });
  }),
);

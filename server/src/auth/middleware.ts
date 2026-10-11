import type { NextFunction, Request, Response } from 'express';
import { q, json, nowIso } from '../db/index.ts';
import { sha256, verifyPassword } from '../lib/crypto.ts';
import { forbidden, HttpError } from '../lib/http.ts';
import { permissionsFor, type Permission } from './rbac.ts';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  siteIds: number[] | null;
  merchantId: number | null;
  branchId: number | null;
  permissions: Set<string>;
}

export interface AuthDevice {
  id: number;
  type: string;
  name: string;
  siteId: number | null;
  gateId: number | null;
  merchantId: number | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      device?: AuthDevice;
    }
  }
}

export function loadUser(id: number): AuthUser | undefined {
  const u = q.get('SELECT * FROM users WHERE id=? AND active=1', id);
  if (!u) return undefined;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    siteIds: json<number[] | null>(u.site_ids, null),
    merchantId: u.merchant_id ?? null,
    branchId: u.branch_id ?? null,
    permissions: permissionsFor(u.role),
  };
}

export function userFromToken(token: string | undefined): AuthUser | undefined {
  if (!token) return undefined;
  const row = q.get<{ user_id: number; expires_at: string }>('SELECT user_id, expires_at FROM auth_tokens WHERE token_hash=?', sha256(token));
  if (!row || row.expires_at < nowIso()) return undefined;
  return loadUser(row.user_id);
}

export function deviceFromKey(key: string | undefined): AuthDevice | undefined {
  if (!key) return undefined;
  const d = q.get('SELECT * FROM devices WHERE api_key_hash=? AND active=1', sha256(key));
  if (!d) return undefined;
  return { id: d.id, type: d.type, name: d.name, siteId: d.site_id, gateId: d.gate_id, merchantId: d.merchant_id };
}

/** Populates req.user / req.device when credentials are present. Never rejects. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  req.user = userFromToken(bearer);
  const deviceKey = (req.headers['x-device-key'] as string | undefined) ?? undefined;
  req.device = deviceFromKey(deviceKey);
  if (req.device) {
    q.run("UPDATE devices SET last_seen_at=?, status=CASE WHEN status='OFFLINE' OR status='UNKNOWN' THEN 'ONLINE' ELSE status END WHERE id=?", nowIso(), req.device.id);
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED'));
  next();
}

export const can = (req: Request, p: Permission) => !!req.user?.permissions.has(p);

export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED'));
    if (!perms.some((p) => req.user!.permissions.has(p))) return next(forbidden('FORBIDDEN', `requires ${perms.join(' or ')}`));
    next();
  };
}

/** Accept either a logged-in user with a permission or an authenticated device of given types. */
export function requireUserOrDevice(perms: Permission[], deviceTypes: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.device && deviceTypes.includes(req.device.type)) return next();
    if (req.user && perms.some((p) => req.user!.permissions.has(p))) return next();
    if (!req.user && !req.device) return next(new HttpError(401, 'UNAUTHENTICATED'));
    next(forbidden());
  };
}

export function requireDevice(...types: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.device) return next(new HttpError(401, 'DEVICE_UNAUTHENTICATED'));
    if (types.length && !types.includes(req.device.type)) return next(forbidden('DEVICE_TYPE_NOT_ALLOWED'));
    next();
  };
}

/** Site scoping: users with site_ids may only touch those sites. */
export function assertSite(req: Request, siteId: number | null | undefined) {
  if (siteId == null) return;
  if (req.device?.siteId && req.device.siteId !== siteId) throw forbidden('SITE_FORBIDDEN');
  const ids = req.user?.siteIds;
  if (ids && !ids.includes(siteId)) throw forbidden('SITE_FORBIDDEN');
}

export interface Approval {
  userId: number;
  username: string;
}

/**
 * Verify a second-person approval (username + PIN or password) for sensitive
 * actions. The approver must hold `perm` and differ from the requester unless
 * the requester also holds `perm` and policy allows self-approval.
 */
export function verifyApproval(
  req: Request,
  input: { username?: string; pin?: string; password?: string } | undefined,
  perm: Permission,
  opts: { allowSelf?: boolean } = { allowSelf: true },
): Approval {
  if (req.user && opts.allowSelf && req.user.permissions.has(perm) && !input?.username) {
    return { userId: req.user.id, username: req.user.username };
  }
  if (!input?.username) throw new HttpError(403, 'APPROVAL_REQUIRED', `requires approval by a user with ${perm}`);
  const u = q.get('SELECT * FROM users WHERE username=? AND active=1', input.username);
  const ok = u && ((input.pin && verifyPassword(input.pin, u.pin_hash)) || (input.password && verifyPassword(input.password, u.password_hash)));
  if (!ok) throw new HttpError(403, 'APPROVAL_INVALID', 'approver credentials invalid');
  if (!permissionsFor(u.role).has(perm)) throw new HttpError(403, 'APPROVER_NOT_ALLOWED');
  if (!opts.allowSelf && req.user && u.id === req.user.id) throw new HttpError(403, 'SELF_APPROVAL_NOT_ALLOWED');
  return { userId: u.id, username: u.username };
}

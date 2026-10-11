import { Router } from 'express';
import { q, nowIso, json } from '../db/index.ts';
import { config } from '../config.ts';
import { randomToken, sha256, verifyPassword } from '../lib/crypto.ts';
import { body, h, HttpError, reqStr } from '../lib/http.ts';
import { requireUser } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';

export const router = Router();

const attempts = new Map<string, { n: number; until: number }>();

router.post(
  '/login',
  h((req, res) => {
    const b = body(req);
    const username = reqStr(b, 'username', 100);
    const password = reqStr(b, 'password', 200);
    const key = `${req.ip}:${username}`;
    const a = attempts.get(key);
    if (a && a.until > Date.now()) throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
    const u = q.get('SELECT * FROM users WHERE username=? AND active=1', username);
    if (!u || !verifyPassword(password, u.password_hash)) {
      const n = (a?.n ?? 0) + 1;
      attempts.set(key, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
      audit(req, { action: 'auth.login_failed', entityType: 'user', entityId: username });
      throw new HttpError(401, 'INVALID_CREDENTIALS');
    }
    attempts.delete(key);
    if (u.merchant_id) {
      const m = q.get('SELECT status, pos_enabled FROM merchants WHERE id=?', u.merchant_id);
      if (!m || !['ACTIVE', 'APPROVED'].includes(m.status)) throw new HttpError(403, 'MERCHANT_NOT_ACTIVE');
    }
    const token = randomToken(32);
    q.insert('auth_tokens', {
      token_hash: sha256(token),
      user_id: u.id,
      expires_at: new Date(Date.now() + config.tokenTtlHours * 3600_000).toISOString(),
      ip: req.ip ?? null,
      user_agent: String(req.headers['user-agent'] ?? '').slice(0, 200),
    });
    q.run('UPDATE users SET last_login_at=? WHERE id=?', nowIso(), u.id);
    req.user = { id: u.id, username: u.username, displayName: u.display_name, role: u.role, siteIds: json(u.site_ids, null), merchantId: u.merchant_id, branchId: u.branch_id, permissions: new Set() };
    audit(req, { action: 'auth.login', entityType: 'user', entityId: u.id });
    res.json({ token, user: me(u.id) });
  }),
);

router.post(
  '/logout',
  h((req, res) => {
    const t = req.headers.authorization?.slice(7);
    if (t) q.run('DELETE FROM auth_tokens WHERE token_hash=?', sha256(t));
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  requireUser,
  h((req, res) => res.json({ user: me(req.user!.id) })),
);

function me(id: number) {
  const u = q.get('SELECT id, username, display_name, role, site_ids, merchant_id, branch_id FROM users WHERE id=?', id)!;
  const { permissionsFor } = rbac;
  const merchant = u.merchant_id ? q.get('SELECT id, code, name, status, logo_url FROM merchants WHERE id=?', u.merchant_id) : null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    siteIds: json(u.site_ids, null),
    merchantId: u.merchant_id,
    branchId: u.branch_id,
    merchant,
    permissions: [...permissionsFor(u.role)],
  };
}
import * as rbac from '../auth/rbac.ts';

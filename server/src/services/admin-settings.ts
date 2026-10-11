/**
 * Admin: typed settings modules with version history and rollback
 * (settings.manage / configuration.rollback). The 'design' module belongs to
 * the Appearance screen and is rejected here.
 */
import { Router, type Request } from 'express';
import { SOURCE_TYPES, type LprPolicy } from '@pp/shared';
import { q, json } from '../db/index.ts';
import { body, h, str, badRequest, forbidden, notFound } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { emit } from '../lib/realtime.ts';
import { DEFAULTS, MODULE_NAMES, getSetting, saveSetting, type ModuleName, type Modules } from '../lib/settings.ts';
import { ROLES } from '../auth/rbac.ts';
import { conform, idParam } from './admin-common.ts';

export const settingsRouter = Router();
const guard = requirePerm('settings.manage');

export const ADMIN_MODULES = MODULE_NAMES.filter((m) => m !== 'design') as Exclude<ModuleName, 'design'>[];
type AdminModule = (typeof ADMIN_MODULES)[number];

function moduleParam(req: Request): AdminModule {
  const m = String(req.params.module);
  if (m === 'design') throw forbidden('MODULE_MANAGED_ELSEWHERE', "'design' is edited in Appearance");
  if (!(ADMIN_MODULES as string[]).includes(m)) throw notFound('UNKNOWN_MODULE');
  return m as AdminModule;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const LANGS = ['th', 'en', 'zh'] as const;

/** Module-specific constraints on top of the generic shape conformance. */
function refine<K extends AdminModule>(name: K, v: Modules[K]): Modules[K] {
  switch (name) {
    case 'branding': {
      const b = v as Modules['branding'];
      b.languages = [...new Set(b.languages.filter((l) => (LANGS as readonly string[]).includes(l)))] as Modules['branding']['languages'];
      if (!b.languages.length) b.languages = ['th'];
      if (!b.languages.includes(b.defaultLanguage)) b.defaultLanguage = b.languages[0];
      break;
    }
    case 'ticket': {
      const t = v as Modules['ticket'];
      t.paperWidth = t.paperWidth === '58' ? '58' : '80';
      t.qrCount = clamp(Math.round(t.qrCount), 1, 3);
      t.qrSize = clamp(Math.round(t.qrSize), 120, 380);
      t.fontScale = clamp(t.fontScale, 0.5, 3);
      t.extraLines = t.extraLines.map((l) => String(l).slice(0, 120)).slice(0, 10);
      break;
    }
    case 'receipt': {
      const r = v as Modules['receipt'];
      r.paperWidth = r.paperWidth === '58' ? '58' : '80';
      r.vatRate = clamp(r.vatRate, 0, 30);
      break;
    }
    case 'operation': {
      const o = v as Modules['operation'];
      if (!['FLAG', 'CLOSE_PREVIOUS', 'DENY'].includes(o.duplicateEntryPolicy)) o.duplicateEntryPolicy = 'FLAG';
      if (!['DENY', 'ALLOW_PAID_CACHE', 'ALLOW_ALL'].includes(o.offlineExitPolicy)) o.offlineExitPolicy = 'ALLOW_PAID_CACHE';
      o.longStayHours = clamp(o.longStayHours, 0, 24 * 90);
      o.pendingPaymentExpiryMinutes = clamp(Math.round(o.pendingPaymentExpiryMinutes), 1, 120);
      const seen = new Set<string>();
      o.vehicleTypes = o.vehicleTypes
        .map((t) => ({ code: String((t as { code?: unknown }).code ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, ''), name: String((t as { name?: unknown }).name ?? '').slice(0, 60) }))
        .filter((t) => t.code && t.name && !seen.has(t.code) && seen.add(t.code));
      if (!o.vehicleTypes.some((t) => t.code === 'CAR')) o.vehicleTypes.unshift({ code: 'CAR', name: 'รถยนต์' });
      break;
    }
    case 'lpr': {
      const l = v as LprPolicy;
      l.autoConfirmMin = clamp(l.autoConfirmMin, 0, 100);
      l.kioskConfirmMin = clamp(l.kioskConfirmMin, 0, l.autoConfirmMin);
      l.provinceAutoCorrectMinSimilarity = clamp(l.provinceAutoCorrectMinSimilarity, 0, 1);
      l.provinceAutoCorrectMinConfidence = clamp(l.provinceAutoCorrectMinConfidence, 0, 100);
      const pri = [...new Set(l.priority.filter((s) => (SOURCE_TYPES as readonly string[]).includes(s)))];
      // keep every automatic source type in the ordering; missing ones go last
      for (const s of DEFAULTS.lpr.priority) if (!pri.includes(s)) pri.push(s);
      l.priority = pri;
      if (l.conflictPolicy !== 'PRIORITY' && l.conflictPolicy !== 'REVIEW') l.conflictPolicy = 'PRIORITY';
      break;
    }
    case 'validation': {
      const s = v as Modules['validation'];
      for (const k of ['maxFreeMinutesPerSession', 'maxDiscountAmountPerSession', 'maxValidationsPerDayPerPlate', 'receiptMaxAgeHours'] as const) s[k] = Math.max(0, s[k]);
      if (!['REVOKE_IF_ACTIVE', 'RECALCULATE', 'AUDIT_ONLY', 'MANAGER_REVIEW'].includes(s.refundPolicy)) s.refundPolicy = 'REVOKE_IF_ACTIVE';
      break;
    }
    case 'pdpa': {
      const p = v as Modules['pdpa'];
      for (const k of ['imageRetentionDays', 'plateRetentionDays', 'auditRetentionDays'] as const) p[k] = Math.max(0, Math.round(p[k]));
      p.maskPlatesForRoles = p.maskPlatesForRoles.filter((r) => (ROLES as readonly string[]).includes(r));
      break;
    }
    case 'payment': {
      const p = v as Modules['payment'];
      p.graceMinutes = clamp(Math.round(p.graceMinutes), 0, 240);
      p.vatRate = clamp(p.vatRate, 0, 30);
      if (!Object.values(p.methods).some(Boolean)) throw badRequest('NO_PAYMENT_METHOD', 'ต้องเปิดใช้งานช่องทางชำระเงินอย่างน้อย 1 ช่องทาง');
      break;
    }
  }
  return v;
}

export function normalizeModule<K extends AdminModule>(name: K, incoming: unknown, current = getSetting(name)): Modules[K] {
  return refine(name, conform(DEFAULTS[name], incoming, structuredClone(current)));
}

function latestVersions() {
  const out: Record<string, number> = {};
  for (const r of q.all<{ module: string; v: number }>('SELECT module, MAX(version_no) v FROM config_versions GROUP BY module')) out[r.module] = r.v;
  return out;
}

/** appliedTo: string[] of targets (e.g. "device:12", "zone:3") or "ALL". */
function applyTargets(req: Request, v: unknown): string[] | 'ALL' | undefined {
  if (v === undefined || v === null) return undefined;
  if (v === 'ALL' || (Array.isArray(v) && v.includes('ALL'))) {
    if (!req.user!.permissions.has('configuration.apply_all')) throw forbidden('APPLY_ALL_FORBIDDEN', 'ต้องมีสิทธิ์ configuration.apply_all');
    return 'ALL';
  }
  if (!Array.isArray(v)) throw badRequest('VALIDATION', 'appliedTo must be an array or "ALL"');
  const t = [...new Set(v.map((x) => String(x).slice(0, 80)))].slice(0, 500);
  if (t.length && !req.user!.permissions.has('configuration.apply') && !req.user!.permissions.has('configuration.apply_all')) {
    throw forbidden('APPLY_FORBIDDEN', 'ต้องมีสิทธิ์ configuration.apply');
  }
  return t.length ? t : undefined;
}

function publish(module: string, version: number, appliedTo: string[] | 'ALL' | undefined) {
  const payload = { module, version, appliedTo: appliedTo ?? null };
  emit.all('settings:updated', payload);
}

settingsRouter.get(
  '/settings',
  guard,
  h((_req, res) => {
    const modules: Record<string, unknown> = {};
    for (const m of ADMIN_MODULES) modules[m] = getSetting(m);
    res.json({ modules, versions: latestVersions(), defaults: Object.fromEntries(ADMIN_MODULES.map((m) => [m, DEFAULTS[m]])) });
  }),
);

settingsRouter.get(
  '/settings/:module',
  guard,
  h((req, res) => {
    const m = moduleParam(req);
    res.json({ module: m, value: getSetting(m), defaults: DEFAULTS[m], version: latestVersions()[m] ?? 0 });
  }),
);

settingsRouter.put(
  '/settings/:module',
  guard,
  h((req, res) => {
    const m = moduleParam(req);
    const b = body(req);
    if (!b.value || typeof b.value !== 'object') throw badRequest('VALIDATION', 'value must be an object');
    const appliedTo = applyTargets(req, b.appliedTo);
    const before = getSetting(m);
    const value = normalizeModule(m, b.value, before);
    const note = str(b, 'note', { max: 500 }) ?? null;
    const v = saveSetting(m, value, { userId: req.user!.id, appliedTo, note: note ?? undefined });
    audit(req, { action: 'settings.update', entityType: 'settings', entityId: m, before, after: value, reason: note, meta: { version: v.version_no, appliedTo } });
    publish(m, v.version_no, appliedTo);
    res.json({ ok: true, value, version: v });
  }),
);

settingsRouter.get(
  '/settings/:module/versions',
  guard,
  h((req, res) => {
    const m = moduleParam(req);
    const rows = q.all(
      `SELECT v.id, v.module, v.version_no, v.data_json, v.applied_to, v.note, v.rolled_back_from, v.created_by, v.created_at,
              u.display_name created_by_name, rb.version_no rolled_back_from_no
         FROM config_versions v LEFT JOIN users u ON u.id=v.created_by LEFT JOIN config_versions rb ON rb.id=v.rolled_back_from
        WHERE v.module=? ORDER BY v.version_no DESC LIMIT 100`,
      m,
    );
    res.json({ items: rows.map((r) => ({ ...r, data: json(r.data_json, null), data_json: undefined, applied_to: json(r.applied_to, null) })) });
  }),
);

settingsRouter.post(
  '/settings/:module/rollback/:versionId',
  requirePerm('configuration.rollback'),
  h((req, res) => {
    const m = moduleParam(req);
    const vid = idParam(req, 'versionId');
    const target = q.get('SELECT * FROM config_versions WHERE id=? AND module=?', vid, m);
    if (!target) throw notFound('VERSION_NOT_FOUND');
    const before = getSetting(m);
    // Re-normalise the old snapshot so it matches the current shape (new keys get defaults).
    const value = normalizeModule(m, json(target.data_json, {}), DEFAULTS[m]);
    const reason = str(body(req), 'reason', { max: 500 }) ?? null;
    const v = saveSetting(m, value, { userId: req.user!.id, note: reason ?? `Rollback to v${target.version_no}`, rolledBackFrom: vid, appliedTo: json(target.applied_to, undefined) });
    audit(req, { action: 'settings.rollback', entityType: 'settings', entityId: m, before, after: value, reason, meta: { toVersion: target.version_no, newVersion: v.version_no } });
    publish(m, v.version_no, 'ALL');
    res.json({ ok: true, value, version: v });
  }),
);

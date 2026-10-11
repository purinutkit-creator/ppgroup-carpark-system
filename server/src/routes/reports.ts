/**
 * Reports, alerts and audit log (staff).
 *   GET  /api/reports/dashboard          live KPIs per site
 *   GET  /api/reports/summary            per day / month / year
 *   GET  /api/reports/validations        by merchant
 *   GET  /api/reports/exemptions         waivers, exempt / pass sessions, manual discounts
 *   GET  /api/reports/export             CSV (UTF-8 BOM) / XLSX
 *   GET  /api/reports/alerts             + POST /alerts/:id/ack | /alerts/:id/resolve
 *   GET  /api/reports/audit              + GET /audit/actions
 */
import { Router, type Request } from 'express';
import { q, nowIso } from '../db/index.ts';
import { body, h, HttpError, notFound, paging, str } from '../lib/http.ts';
import { can, requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { emit } from '../lib/realtime.ts';
import {
  alertView,
  AUDIT_SELECT,
  auditView,
  auditWhere,
  dashboard,
  exemptions,
  exportTable,
  parseRange,
  summary,
  toCsv,
  toXlsx,
  validationsByMerchant,
  visibleSites,
  type AuditFilter,
  type Group,
} from '../services/reports.ts';

export const router = Router();

type Query = Record<string, string | undefined>;

function siteParam(req: Request): number | null {
  const v = Number((req.query as Query).siteId);
  if (!v) return null;
  if (!visibleSites(req, v).length) throw new HttpError(403, 'SITE_FORBIDDEN');
  return v;
}

function groupParam(req: Request): Group {
  const g = (req.query as Query).group;
  return g === 'month' || g === 'year' ? g : 'day';
}

function auditFilter(Q: Query): AuditFilter {
  return {
    action: Q.action || undefined,
    username: Q.username || undefined,
    parkingNo: Q.parkingNo || undefined,
    receiptNo: Q.receiptNo || undefined,
    merchantId: Number(Q.merchantId) || undefined,
    sessionId: Number(Q.sessionId) || undefined,
    q: Q.q?.trim() || undefined,
  };
}

router.get('/dashboard', requirePerm('dashboard.view'), h((req, res) => res.json(dashboard(req))));

router.get(
  '/summary',
  requirePerm('reports.view'),
  h((req, res) => res.json(summary(req, { ...parseRange(req.query), group: groupParam(req), siteId: siteParam(req) }))),
);

router.get(
  '/validations',
  requirePerm('reports.view'),
  h((req, res) => res.json(validationsByMerchant(req, { ...parseRange(req.query), siteId: siteParam(req) }))),
);

router.get(
  '/exemptions',
  requirePerm('reports.view'),
  h((req, res) => res.json(exemptions(req, { ...parseRange(req.query), siteId: siteParam(req) }))),
);

const EXPORT_TYPES = ['summary', 'sessions', 'payments', 'validations', 'exemptions', 'audit'] as const;

router.get(
  '/export',
  requirePerm('reports.export'),
  h(async (req, res) => {
    const Q = req.query as Query;
    const type = Q.type as (typeof EXPORT_TYPES)[number];
    if (!EXPORT_TYPES.includes(type)) throw new HttpError(400, 'VALIDATION', `type must be one of ${EXPORT_TYPES.join(', ')}`);
    if (type === 'audit' && !can(req, 'audit.view')) throw new HttpError(403, 'FORBIDDEN', 'requires audit.view');
    const format = Q.format === 'xlsx' ? 'xlsx' : 'csv';
    const range = parseRange(req.query);
    const siteId = siteParam(req);
    const group = groupParam(req);
    const table = exportTable(req, type, range, { group, siteId, filter: auditFilter(Q) });
    const buf = format === 'xlsx' ? await toXlsx(table, { ...range, generatedBy: req.user!.username }) : toCsv(table);
    audit(req, {
      action: 'report.export',
      entityType: 'report',
      entityId: type,
      siteId,
      meta: { type, format, from: range.from, to: range.to, group, rows: table.rows.length },
    });
    const name = `${type}-${range.from.slice(0, 10)}_${range.to.slice(0, 10)}.${format}`;
    res.setHeader('Content-Type', format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  }),
);

// ---------------------------------------------------------------- alerts ---

function alertScope(req: Request) {
  const ids = req.user?.siteIds;
  return ids ? `(a.site_id IS NULL OR a.site_id IN (${ids.map(Number).join(',') || 0}))` : '1=1';
}

function loadAlert(req: Request) {
  const a = q.get(
    `SELECT a.*, s.name site_name, u.display_name acknowledged_by_name FROM alerts a LEFT JOIN sites s ON s.id=a.site_id LEFT JOIN users u ON u.id=a.acknowledged_by
      WHERE a.id=? AND ${alertScope(req)}`,
    Number(req.params.id),
  );
  if (!a) throw notFound('ALERT_NOT_FOUND');
  return a;
}

router.get(
  '/alerts',
  requirePerm('alerts.manage', 'dashboard.view'),
  h((req, res) => {
    const Q = req.query as Query;
    const { limit, offset } = paging(req, 500);
    const where = [alertScope(req)];
    const params: unknown[] = [];
    if ((Q.status ?? 'open') === 'open') where.push('a.resolved_at IS NULL');
    else if (Q.status === 'resolved') where.push('a.resolved_at IS NOT NULL');
    if (Q.type) (where.push('a.type=?'), params.push(Q.type));
    if (Q.severity) (where.push('a.severity=?'), params.push(Q.severity));
    if (Q.siteId) (where.push('a.site_id=?'), params.push(Number(Q.siteId)));
    const w = `WHERE ${where.join(' AND ')}`;
    const total = q.get<{ n: number }>(`SELECT COUNT(*) n FROM alerts a ${w}`, ...params)!.n;
    const rows = q.all(
      `SELECT a.*, s.name site_name, u.display_name acknowledged_by_name FROM alerts a LEFT JOIN sites s ON s.id=a.site_id LEFT JOIN users u ON u.id=a.acknowledged_by ${w}
        ORDER BY (a.resolved_at IS NULL) DESC, CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, a.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const types = q.all<{ type: string }>('SELECT DISTINCT type FROM alerts ORDER BY type').map((r) => r.type);
    res.json({ total, items: rows.map(alertView), types });
  }),
);

router.post(
  '/alerts/:id/ack',
  requirePerm('alerts.manage'),
  h((req, res) => {
    const a = loadAlert(req);
    if (!a.acknowledged_at) {
      q.run('UPDATE alerts SET acknowledged_by=?, acknowledged_at=? WHERE id=?', req.user!.id, nowIso(), a.id);
      audit(req, { action: 'alert.ack', entityType: 'alert', entityId: a.id, siteId: a.site_id, before: { type: a.type, message: a.message }, reason: str(body(req), 'note') ?? null });
      emit.staff('alert:resolved', { id: a.id, acknowledged: true });
    }
    res.json({ alert: alertView(loadAlert(req)) });
  }),
);

router.post(
  '/alerts/:id/resolve',
  requirePerm('alerts.manage'),
  h((req, res) => {
    const a = loadAlert(req);
    if (!a.resolved_at) {
      const now = nowIso();
      q.run('UPDATE alerts SET resolved_at=?, acknowledged_at=COALESCE(acknowledged_at, ?), acknowledged_by=COALESCE(acknowledged_by, ?) WHERE id=?', now, now, req.user!.id, a.id);
      audit(req, { action: 'alert.resolve', entityType: 'alert', entityId: a.id, siteId: a.site_id, before: { type: a.type, message: a.message }, reason: str(body(req), 'note') ?? null });
      emit.staff('alert:resolved', { id: a.id, dedupeKey: a.dedupe_key });
      if (a.site_id) emit.site(a.site_id, 'alert:resolved', { id: a.id, dedupeKey: a.dedupe_key });
    }
    res.json({ alert: alertView(loadAlert(req)) });
  }),
);

// ----------------------------------------------------------------- audit ---

router.get(
  '/audit',
  requirePerm('audit.view'),
  h((req, res) => {
    const Q = req.query as Query;
    const { limit, offset } = paging(req, 500);
    const range = Q.from || Q.to ? parseRange(req.query, 3650) : { from: undefined, to: undefined };
    const w = auditWhere({ ...auditFilter(Q), from: Q.from ? range.from : undefined, to: Q.to ? range.to : undefined });
    const total = q.get<{ n: number }>(`SELECT COUNT(*) n FROM audit_logs a ${w.sql}`, ...w.params)!.n;
    const rows = q.all(`${AUDIT_SELECT} ${w.sql} ORDER BY a.id DESC LIMIT ? OFFSET ?`, ...w.params, limit, offset);
    res.json({ total, items: rows.map(auditView) });
  }),
);

router.get(
  '/audit/actions',
  requirePerm('audit.view'),
  h((_req, res) => {
    res.json({ items: q.all<{ action: string; n: number }>('SELECT action, COUNT(*) n FROM audit_logs GROUP BY action ORDER BY action') });
  }),
);

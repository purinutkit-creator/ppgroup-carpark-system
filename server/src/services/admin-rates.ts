/**
 * Admin: rate plans, append-only rate versions, fee preview, holidays
 * (rates.manage). A session is priced with the version in force at its entry,
 * so versions are never updated or deleted, and back-dating a version (which
 * would re-price cars already inside) is reserved to OWNER.
 */
import { Router, type Request } from 'express';
import { calculateFee, nextFeeChangeAt, DEFAULT_RATE, type RateConfig, type TimeBand } from '@pp/shared';
import { q, json, tx, nowIso, type Row } from '../db/index.ts';
import { body, h, int, num, reqStr, str, bool, badRequest, conflict } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { emit } from '../lib/realtime.ts';
import { holidayDates } from './rates.ts';
import { assertSiteWrite, beforeOf, changed, dateOrNull, idParam, mustGet } from './admin-common.ts';

export const ratesRouter = Router();
const guard = requirePerm('rates.manage');

/** Effective-from may lag "now" by this much (form latency) before it counts as back-dated. */
const BACKDATE_SLACK_MS = 2 * 60_000;

// ---------------------------------------------------------- RateConfig -----

type Obj = Record<string, unknown>;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function money(o: Obj, k: string, required = false): number | undefined {
  const v = num(o, k, { min: 0, max: 1_000_000, required });
  return v === undefined ? undefined : Math.round(v * 100) / 100;
}
function minutes(o: Obj, k: string, max = 7 * 24 * 60): number | undefined {
  return int(o, k, { min: 0, max });
}
function hhmm(v: unknown, field: string): string {
  if (typeof v !== 'string' || !HHMM.test(v)) throw badRequest('VALIDATION', `${field} must be HH:mm`);
  return v;
}

/** Validate and normalise a rate config; only known keys are kept. */
export function sanitizeRate(input: unknown, isOverride = false): RateConfig {
  const o = (input && typeof input === 'object' ? input : {}) as Obj;
  const out: Partial<RateConfig> = {};
  const set = <K extends keyof RateConfig>(k: K, v: RateConfig[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('freeMinutes', minutes(o, 'freeMinutes'));
  set('hourlyRate', money(o, 'hourlyRate'));
  if (o.billingUnitMinutes !== undefined) {
    const u = int(o, 'billingUnitMinutes', { min: 1, max: 1440, required: true })!;
    set('billingUnitMinutes', u);
  }
  if (o.rounding !== undefined) {
    if (o.rounding !== 'CEIL' && o.rounding !== 'ACTUAL') throw badRequest('VALIDATION', 'rounding must be CEIL or ACTUAL');
    set('rounding', o.rounding);
  }
  set('toleranceMinutes', minutes(o, 'toleranceMinutes', 120));
  if (o.firstPeriod !== undefined) {
    if (o.firstPeriod === null) out.firstPeriod = null;
    else {
      const fp = o.firstPeriod as Obj;
      const m = int(fp, 'minutes', { min: 1, max: 1440, required: true })!;
      out.firstPeriod = { minutes: m, price: money(fp, 'price', true)! };
    }
  }
  if (o.timeBands !== undefined) {
    if (!Array.isArray(o.timeBands)) throw badRequest('VALIDATION', 'timeBands must be an array');
    out.timeBands = (o.timeBands as Obj[]).slice(0, 12).map(
      (b, i): TimeBand => ({
        name: String(b.name ?? `ช่วงที่ ${i + 1}`).slice(0, 60),
        start: hhmm(b.start, `timeBands[${i}].start`),
        end: hhmm(b.end, `timeBands[${i}].end`),
        hourlyRate: money(b, 'hourlyRate', true)!,
      }),
    );
  }
  for (const k of ['dailyFlatRate', 'dailyMax'] as const) {
    if (o[k] !== undefined) out[k] = o[k] === null || o[k] === '' || o[k] === 0 ? null : money(o, k)!;
  }
  if (o.dayCycle !== undefined) {
    if (o.dayCycle !== 'ROLLING_24H' && o.dayCycle !== 'CALENDAR') throw badRequest('VALIDATION', 'dayCycle must be ROLLING_24H or CALENDAR');
    out.dayCycle = o.dayCycle;
  }
  if (o.overnight !== undefined) {
    if (o.overnight === null) out.overnight = null;
    else {
      const on = o.overnight as Obj;
      out.overnight = { cutoff: hhmm(on.cutoff, 'overnight.cutoff'), fee: money(on, 'fee', true)! };
    }
  }
  set('lostTicketFee', money(o, 'lostTicketFee'));
  set('graceAfterPaymentMinutes', minutes(o, 'graceAfterPaymentMinutes', 240));
  if (!isOverride && o.holiday !== undefined) {
    if (o.holiday === null) out.holiday = null;
    else {
      const hd = o.holiday as Obj;
      const override = hd.override && typeof hd.override === 'object' ? sanitizeRate(hd.override, true) : undefined;
      out.holiday = { weekendsAsHoliday: hd.weekendsAsHoliday === true, ...(override && Object.keys(override).length ? { override } : {}) };
    }
  }
  if (isOverride) return out as RateConfig;
  const full = { ...DEFAULT_RATE, ...out };
  if (full.billingUnitMinutes < 1) throw badRequest('VALIDATION', 'billingUnitMinutes must be >= 1');
  return full;
}

// --------------------------------------------------------------- plans -----

function planView(p: Row, at = nowIso()) {
  const current = q.get('SELECT * FROM rate_plan_versions WHERE plan_id=? AND effective_from<=? ORDER BY effective_from DESC, id DESC LIMIT 1', p.id, at);
  const upcoming = q.all('SELECT id, effective_from, note, created_at FROM rate_plan_versions WHERE plan_id=? AND effective_from>? ORDER BY effective_from', p.id, at);
  return {
    ...p,
    currentVersion: current ? { id: current.id, effective_from: current.effective_from, note: current.note, config: { ...DEFAULT_RATE, ...json(current.config_json, {}) } } : null,
    upcoming,
    versionCount: q.get<{ n: number }>('SELECT COUNT(*) n FROM rate_plan_versions WHERE plan_id=?', p.id)!.n,
  };
}

ratesRouter.get(
  '/rate-plans',
  guard,
  h((req, res) => {
    const ids = req.user!.siteIds;
    const rows = q
      .all(
        `SELECT p.*, s.name site_name, z.name zone_name FROM rate_plans p LEFT JOIN sites s ON s.id=p.site_id LEFT JOIN zones z ON z.id=p.zone_id
          WHERE (?=1 OR p.active=1) ORDER BY p.active DESC, p.site_id, p.zone_id, p.vehicle_type, p.priority DESC, p.id`,
        req.query.all === '1' ? 1 : 0,
      )
      .filter((p) => !ids || p.site_id == null || ids.includes(p.site_id));
    res.json({ items: rows.map((p) => planView(p)) });
  }),
);

function planRow(b: Obj, partial: boolean, current?: Row) {
  const out: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) out.name = reqStr(b, 'name', 200);
  if (!partial || b.vehicleType !== undefined) out.vehicle_type = (str(b, 'vehicleType', { max: 30 }) ?? 'CAR').toUpperCase();
  if (!partial || b.priority !== undefined) out.priority = int(b, 'priority', { min: -1000, max: 1000 }) ?? 0;
  if (!partial || b.siteId !== undefined || b.zoneId !== undefined) {
    let siteId = b.siteId !== undefined ? (int(b, 'siteId') ?? null) : (current?.site_id ?? null);
    const zoneId = b.zoneId !== undefined ? (int(b, 'zoneId') ?? null) : (current?.zone_id ?? null);
    if (siteId) mustGet('sites', siteId, 'SITE_NOT_FOUND');
    if (zoneId) {
      const z = mustGet('zones', zoneId, 'ZONE_NOT_FOUND');
      if (siteId && z.site_id !== siteId) throw conflict('ZONE_SITE_MISMATCH');
      siteId = z.site_id;
    }
    out.site_id = siteId;
    out.zone_id = zoneId;
  }
  if (partial && b.active !== undefined) out.active = bool(b, 'active') ? 1 : 0;
  return out;
}

function checkEffectiveFrom(req: Request, v: unknown): string {
  const d = v === undefined || v === null || v === '' ? new Date() : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw badRequest('VALIDATION', 'effectiveFrom must be a date/time');
  if (d.getTime() < Date.now() - BACKDATE_SLACK_MS && req.user?.role !== 'OWNER') {
    throw conflict('EFFECTIVE_FROM_IN_PAST', 'วันที่มีผลย้อนหลังไม่ได้ (อาจกระทบรถที่เข้ามาแล้ว) — เฉพาะ OWNER เท่านั้น');
  }
  return d.toISOString();
}

function addVersion(planId: number, cfg: RateConfig, effectiveFrom: string, note: string | null, userId: number) {
  return q.insert('rate_plan_versions', { plan_id: planId, effective_from: effectiveFrom, config_json: JSON.stringify(cfg), note, created_by: userId });
}

ratesRouter.post(
  '/rate-plans',
  guard,
  h((req, res) => {
    const b = body(req);
    const row = planRow(b, false);
    assertSiteWrite(req, row.site_id as number | null);
    const cfg = b.config !== undefined ? sanitizeRate(b.config) : null;
    const effectiveFrom = cfg ? checkEffectiveFrom(req, b.effectiveFrom) : null;
    const id = tx(() => {
      const planId = q.insert('rate_plans', row);
      if (cfg) addVersion(planId, cfg, effectiveFrom!, str(b, 'note', { max: 500 }) ?? 'initial', req.user!.id);
      return planId;
    });
    audit(req, { action: 'rate_plan.create', entityType: 'rate_plan', entityId: id, siteId: row.site_id as number | null, after: { ...row, config: cfg, effectiveFrom } });
    res.json({ id });
  }),
);

ratesRouter.put(
  '/rate-plans/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('rate_plans', id);
    assertSiteWrite(req, before.site_id);
    const patch = planRow(body(req), true, before);
    if ('site_id' in patch) assertSiteWrite(req, patch.site_id as number | null);
    const diff = changed(before, patch);
    q.update('rate_plans', id, diff);
    audit(req, { action: 'rate_plan.update', entityType: 'rate_plan', entityId: id, siteId: before.site_id, before: beforeOf(before, diff), after: diff });
    res.json({ ok: true });
  }),
);

ratesRouter.delete(
  '/rate-plans/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('rate_plans', id);
    assertSiteWrite(req, before.site_id);
    q.run('UPDATE rate_plans SET active=0 WHERE id=?', id);
    audit(req, { action: 'rate_plan.deactivate', entityType: 'rate_plan', entityId: id, siteId: before.site_id, before: { active: before.active }, after: { active: 0 } });
    res.json({ ok: true });
  }),
);

ratesRouter.get(
  '/rate-plans/:id/versions',
  guard,
  h((req, res) => {
    const id = idParam(req);
    mustGet('rate_plans', id);
    const now = nowIso();
    const rows = q.all(
      `SELECT v.*, u.display_name created_by_name FROM rate_plan_versions v LEFT JOIN users u ON u.id=v.created_by
        WHERE v.plan_id=? ORDER BY v.effective_from DESC, v.id DESC`,
      id,
    );
    const current = rows.find((v) => v.effective_from <= now);
    res.json({
      items: rows.map((v) => ({
        ...v,
        config: { ...DEFAULT_RATE, ...json(v.config_json, {}) },
        config_json: undefined,
        state: v.effective_from > now ? 'SCHEDULED' : v.id === current?.id ? 'CURRENT' : 'PAST',
        sessions: q.get<{ n: number }>('SELECT COUNT(*) n FROM parking_sessions WHERE rate_version_id=?', v.id)!.n,
      })),
    });
  }),
);

ratesRouter.post(
  '/rate-plans/:id/versions',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const plan = mustGet('rate_plans', id);
    assertSiteWrite(req, plan.site_id);
    const b = body(req);
    const cfg = sanitizeRate(b.config);
    const effectiveFrom = checkEffectiveFrom(req, b.effectiveFrom);
    const prev = q.get('SELECT * FROM rate_plan_versions WHERE plan_id=? AND effective_from<=? ORDER BY effective_from DESC, id DESC LIMIT 1', id, effectiveFrom);
    const vid = addVersion(id, cfg, effectiveFrom, str(b, 'note', { max: 500 }) ?? null, req.user!.id);
    audit(req, {
      action: 'rate_version.create',
      entityType: 'rate_plan',
      entityId: id,
      siteId: plan.site_id,
      before: prev ? { versionId: prev.id, effectiveFrom: prev.effective_from, config: json(prev.config_json, {}) } : null,
      after: { versionId: vid, effectiveFrom, config: cfg },
      reason: str(b, 'note', { max: 500 }) ?? null,
      meta: { backdated: effectiveFrom < nowIso() },
    });
    emit.staff('rates:updated', { planIds: [id] });
    res.json({ id: vid, effectiveFrom });
  }),
);

/** "Apply to All Parking Zones": a new version on every target plan. */
ratesRouter.post(
  '/rate-plans/apply',
  requirePerm('rates.manage'),
  h((req, res) => {
    const b = body(req);
    const cfg = sanitizeRate(b.config);
    const effectiveFrom = checkEffectiveFrom(req, b.effectiveFrom);
    const vehicleType = str(b, 'vehicleType', { max: 30 })?.toUpperCase() ?? null;
    let plans: Row[];
    if (b.all === true) {
      if (!req.user!.permissions.has('configuration.apply_all')) throw conflict('APPLY_ALL_FORBIDDEN', 'ต้องมีสิทธิ์ configuration.apply_all');
      plans = q.all('SELECT * FROM rate_plans WHERE active=1 AND (? IS NULL OR vehicle_type=?)', vehicleType, vehicleType);
    } else {
      const ids = Array.isArray(b.planIds) ? (b.planIds as unknown[]).map(Number).filter((x) => Number.isInteger(x) && x > 0) : [];
      if (!ids.length) throw badRequest('VALIDATION', 'planIds or all:true required');
      if (ids.length > 1 && !req.user!.permissions.has('configuration.apply') && !req.user!.permissions.has('configuration.apply_all')) {
        throw conflict('APPLY_FORBIDDEN', 'ต้องมีสิทธิ์ configuration.apply');
      }
      plans = q.all(`SELECT * FROM rate_plans WHERE active=1 AND id IN (${ids.map(() => '?').join(',')})`, ...ids);
    }
    plans = plans.filter((p) => !req.user!.siteIds || (p.site_id != null && req.user!.siteIds.includes(p.site_id)));
    if (!plans.length) throw badRequest('NO_TARGETS', 'ไม่พบแผนอัตราที่ตรงเงื่อนไข');
    const note = str(b, 'note', { max: 500 }) ?? 'Apply to all parking zones';
    const created = tx(() => plans.map((p) => ({ planId: p.id, planName: p.name, versionId: addVersion(p.id, cfg, effectiveFrom, note, req.user!.id) })));
    audit(req, { action: 'rate_version.apply', entityType: 'rate_plan', entityId: plans.map((p) => p.id).join(','), after: { effectiveFrom, config: cfg, targets: created }, reason: note, meta: { all: b.all === true, vehicleType } });
    emit.staff('rates:updated', { planIds: plans.map((p) => p.id) });
    res.json({ ok: true, effectiveFrom, created });
  }),
);

/** Server-side fee preview for the "ทดลองคำนวณ" panel. */
ratesRouter.post(
  '/rates/preview',
  guard,
  h((req, res) => {
    const b = body(req);
    const cfg = sanitizeRate(b.config);
    const entryAt = new Date(String(b.entryAt ?? ''));
    const exitAt = new Date(String(b.exitAt ?? ''));
    if (Number.isNaN(entryAt.getTime()) || Number.isNaN(exitAt.getTime())) throw badRequest('VALIDATION', 'entryAt and exitAt are required');
    if (exitAt < entryAt) throw badRequest('VALIDATION', 'exitAt must be after entryAt');
    if (exitAt.getTime() - entryAt.getTime() > 90 * 86400_000) throw badRequest('VALIDATION', 'preview range is limited to 90 days');
    const siteId = int(b, 'siteId') ?? q.get<{ id: number }>('SELECT id FROM sites WHERE active=1 ORDER BY id LIMIT 1')?.id ?? null;
    const tz = siteId ? (q.get('SELECT tz_offset FROM sites WHERE id=?', siteId)?.tz_offset ?? 420) : 420;
    const input = {
      entryAt,
      endAt: exitAt,
      config: cfg,
      extraFreeMinutes: int(b, 'extraFreeMinutes', { min: 0, max: 100_000 }) ?? 0,
      lostTicket: b.lostTicket === true,
      holidays: siteId ? holidayDates(siteId) : [],
      tzOffsetMinutes: tz,
    };
    const fee = calculateFee(input);
    const next = nextFeeChangeAt(input);
    res.json({ ...fee, nextFeeChangeAt: next ? new Date(next).toISOString() : null, config: cfg });
  }),
);

// ------------------------------------------------------------- holidays ----

ratesRouter.get(
  '/holidays',
  guard,
  h((req, res) => {
    const year = req.query.year ? String(req.query.year) : null;
    res.json({
      items: q.all(
        `SELECT h.*, s.name site_name FROM holidays h LEFT JOIN sites s ON s.id=h.site_id WHERE (? IS NULL OR substr(h.date,1,4)=?) ORDER BY h.date`,
        year,
        year,
      ),
    });
  }),
);

function holidayRow(b: Obj) {
  const date = dateOrNull(b.date, 'date');
  if (!date) throw badRequest('VALIDATION', 'date is required');
  const siteId = int(b, 'siteId') ?? null;
  if (siteId) mustGet('sites', siteId, 'SITE_NOT_FOUND');
  return { date, name: reqStr(b, 'name', 200), site_id: siteId };
}

ratesRouter.post(
  '/holidays',
  guard,
  h((req, res) => {
    const row = holidayRow(body(req));
    assertSiteWrite(req, row.site_id);
    const id = q.insert('holidays', row);
    audit(req, { action: 'holiday.create', entityType: 'holiday', entityId: id, siteId: row.site_id, after: row });
    res.json({ id });
  }),
);

ratesRouter.put(
  '/holidays/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('holidays', id);
    assertSiteWrite(req, before.site_id);
    const row = holidayRow(body(req));
    assertSiteWrite(req, row.site_id);
    const diff = changed(before, row);
    q.update('holidays', id, diff);
    audit(req, { action: 'holiday.update', entityType: 'holiday', entityId: id, siteId: row.site_id, before: beforeOf(before, diff), after: diff });
    res.json({ ok: true });
  }),
);

ratesRouter.delete(
  '/holidays/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('holidays', id);
    assertSiteWrite(req, before.site_id);
    q.run('DELETE FROM holidays WHERE id=?', id);
    audit(req, { action: 'holiday.delete', entityType: 'holiday', entityId: id, siteId: before.site_id, before });
    res.json({ ok: true });
  }),
);

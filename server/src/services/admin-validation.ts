/**
 * Admin: parking validation rules (validation.rules) — receipts → parking
 * rewards — plus the "ทดลองคำนวณ" calculator and a lightweight merchant list.
 */
import { Router } from 'express';
import { calculateFee, evaluateRewards, type Reward, type ValidationRule } from '@pp/shared';
import { q, json, nowIso, type Row } from '../db/index.ts';
import { body, h, int, num, reqStr, bool, badRequest } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { emit } from '../lib/realtime.ts';
import { loadRules } from './validation.ts';
import { resolveRate, holidayDates } from './rates.ts';
import { dateOrNull, hhmmOrNull, idList, idParam, mustGet } from './admin-common.ts';

export const validationRouter = Router();
const guard = requirePerm('validation.rules');

type Obj = Record<string, unknown>;
const SCOPES = ['GLOBAL', 'MERCHANT', 'CAMPAIGN'] as const;
type RuleConfig = Omit<ValidationRule, 'id' | 'name' | 'scope' | 'priority' | 'combinable' | 'active'>;

function reward(v: unknown, field: string, allowFull = true): Reward {
  const o = (v && typeof v === 'object' ? v : {}) as Obj;
  if (o.type === 'FULL' && allowFull) return { type: 'FULL' };
  if (o.type !== 'AMOUNT' && o.type !== 'MINUTES') throw badRequest('VALIDATION', `${field}.type must be AMOUNT, MINUTES${allowFull ? ' or FULL' : ''}`);
  const value = num(o, 'value', { required: true, min: 0, max: 100_000 })!;
  return { type: o.type, value: o.type === 'MINUTES' ? Math.round(value) : Math.round(value * 100) / 100 };
}

/** Validate a rule body into the shared ValidationRule config shape. */
export function sanitizeRuleConfig(b: Obj): RuleConfig {
  const kind = b.kind;
  if (kind !== 'TIER' && kind !== 'STEP' && kind !== 'ANY_PURCHASE') throw badRequest('VALIDATION', 'kind must be TIER, STEP or ANY_PURCHASE');
  const cfg: RuleConfig = { kind };
  if (kind === 'TIER') {
    if (!Array.isArray(b.tiers) || !b.tiers.length) throw badRequest('VALIDATION', 'ต้องมีขั้นยอดซื้ออย่างน้อย 1 ขั้น');
    cfg.tiers = (b.tiers as Obj[])
      .slice(0, 20)
      .map((t, i) => ({ minSpend: num(t, 'minSpend', { required: true, min: 0.01, max: 10_000_000 })!, reward: reward(t.reward, `tiers[${i}].reward`) }))
      .sort((a, z) => a.minSpend - z.minSpend);
    if (new Set(cfg.tiers.map((t) => t.minSpend)).size !== cfg.tiers.length) throw badRequest('VALIDATION', 'ยอดซื้อขั้นต่ำซ้ำกัน');
  } else if (kind === 'STEP') {
    const s = (b.step && typeof b.step === 'object' ? b.step : {}) as Obj;
    const r = reward(s.reward, 'step.reward', false) as { type: 'AMOUNT' | 'MINUTES'; value: number };
    cfg.step = { every: num(s, 'every', { required: true, min: 0.01, max: 10_000_000 })!, reward: r, max: num(s, 'max', { min: 0 }) || null };
  } else {
    const a = (b.anyPurchase && typeof b.anyPurchase === 'object' ? b.anyPurchase : {}) as Obj;
    cfg.anyPurchase = { minSpend: num(a, 'minSpend', { min: 0 }) ?? 0, reward: reward(a.reward, 'anyPurchase.reward') };
  }
  const days = Array.isArray(b.daysOfWeek) ? [...new Set((b.daysOfWeek as unknown[]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  cfg.daysOfWeek = days.length && days.length < 7 ? days : null;
  cfg.startDate = dateOrNull(b.startDate, 'startDate');
  cfg.endDate = dateOrNull(b.endDate, 'endDate');
  if (cfg.startDate && cfg.endDate && cfg.endDate < cfg.startDate) throw badRequest('VALIDATION', 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
  cfg.startTime = hhmmOrNull(b.startTime, 'startTime');
  cfg.endTime = hhmmOrNull(b.endTime, 'endTime');
  if (!!cfg.startTime !== !!cfg.endTime) throw badRequest('VALIDATION', 'ต้องระบุทั้งเวลาเริ่มและเวลาสิ้นสุด');
  cfg.merchantIds = idList(b.merchantIds);
  cfg.siteIds = idList(b.siteIds);
  for (const id of cfg.merchantIds ?? []) mustGet('merchants', id, 'MERCHANT_NOT_FOUND');
  for (const id of cfg.siteIds ?? []) mustGet('sites', id, 'SITE_NOT_FOUND');
  return cfg;
}

function ruleScope(b: Obj, cfg: RuleConfig): ValidationRule['scope'] {
  const s = SCOPES.includes(b.scope as never) ? (b.scope as ValidationRule['scope']) : cfg.merchantIds?.length ? 'MERCHANT' : 'GLOBAL';
  if (s === 'MERCHANT' && !cfg.merchantIds?.length) throw badRequest('MERCHANTS_REQUIRED', 'กฎระดับร้านค้าต้องเลือกร้านค้าอย่างน้อย 1 ร้าน');
  return s;
}

function ruleView(r: Row) {
  return { ...r, config: json(r.config_json, {}), config_json: undefined, combinable: !!r.combinable, active: !!r.active };
}

validationRouter.get(
  '/validation-rules',
  guard,
  h((req, res) => {
    const rows = q.all(
      `SELECT r.*, u.display_name created_by_name FROM validation_rules r LEFT JOIN users u ON u.id=r.created_by
        WHERE (?=1 OR r.active=1) ORDER BY r.active DESC, r.priority DESC, r.id`,
      req.query.all === '0' ? 0 : 1,
    );
    res.json({ items: rows.map(ruleView) });
  }),
);

validationRouter.post(
  '/validation-rules',
  guard,
  h((req, res) => {
    const b = body(req);
    const cfg = sanitizeRuleConfig(b);
    const row = {
      name: reqStr(b, 'name', 200),
      scope: ruleScope(b, cfg),
      config_json: JSON.stringify(cfg),
      priority: int(b, 'priority', { min: -1000, max: 1000 }) ?? 0,
      combinable: bool(b, 'combinable') === false ? 0 : 1,
      active: bool(b, 'active') === false ? 0 : 1,
      created_by: req.user!.id,
    };
    const id = q.insert('validation_rules', row);
    audit(req, { action: 'validation_rule.create', entityType: 'validation_rule', entityId: id, after: { ...row, config: cfg, config_json: undefined } });
    emit.staff('validation:rules', { id });
    res.json({ id });
  }),
);

validationRouter.put(
  '/validation-rules/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('validation_rules', id);
    const b = body(req);
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (b.name !== undefined) patch.name = reqStr(b, 'name', 200);
    if (b.kind !== undefined) {
      const cfg = sanitizeRuleConfig(b);
      patch.config_json = JSON.stringify(cfg);
      patch.scope = ruleScope(b, cfg);
    } else if (b.scope !== undefined) patch.scope = ruleScope(b, json(before.config_json, {}) as RuleConfig);
    if (b.priority !== undefined) patch.priority = int(b, 'priority', { min: -1000, max: 1000, required: true });
    if (b.combinable !== undefined) patch.combinable = bool(b, 'combinable') ? 1 : 0;
    if (b.active !== undefined) patch.active = bool(b, 'active') ? 1 : 0;
    q.update('validation_rules', id, patch);
    const after = q.get('SELECT * FROM validation_rules WHERE id=?', id)!;
    audit(req, { action: 'validation_rule.update', entityType: 'validation_rule', entityId: id, before: ruleView(before), after: ruleView(after) });
    emit.staff('validation:rules', { id });
    res.json({ ok: true });
  }),
);

validationRouter.delete(
  '/validation-rules/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('validation_rules', id);
    // Soft delete: discounts keep a snapshot, but the rule id stays resolvable for reports.
    q.run('UPDATE validation_rules SET active=0, updated_at=? WHERE id=?', nowIso(), id);
    audit(req, { action: 'validation_rule.deactivate', entityType: 'validation_rule', entityId: id, before: { active: !!before.active }, after: { active: false } });
    emit.staff('validation:rules', { id });
    res.json({ ok: true });
  }),
);

/**
 * Calculator: what does a purchase earn under the live rules (or a draft
 * rule being edited)? Rewards are valued against the fee of a sample stay
 * (`parkedMinutes`, default 3h) under the current CAR rate.
 */
validationRouter.post(
  '/validation/test',
  guard,
  h((req, res) => {
    const b = body(req);
    const amounts = Array.isArray(b.amounts) ? (b.amounts as unknown[]).map(Number) : [num(b, 'amount', { required: true, min: 0 })!];
    if (amounts.some((a) => !Number.isFinite(a) || a < 0)) throw badRequest('VALIDATION', 'amounts must be numbers >= 0');
    const merchantId = int(b, 'merchantId') ?? null;
    let rules = loadRules();
    if (b.rule && typeof b.rule === 'object') {
      const draft = b.rule as Obj;
      const cfg = sanitizeRuleConfig(draft);
      rules = [{ ...cfg, id: 0, name: String(draft.name ?? 'กฎที่กำลังแก้ไข'), scope: ruleScope(draft, cfg), priority: Number(draft.priority) || 0, combinable: draft.combinable !== false, active: true }];
    }
    const siteId = int(b, 'siteId') ?? q.get<{ id: number }>('SELECT id FROM sites WHERE active=1 ORDER BY id LIMIT 1')?.id ?? 1;
    const parkedMinutes = int(b, 'parkedMinutes', { min: 0, max: 7 * 1440 }) ?? 180;
    const now = new Date();
    const entryAt = new Date(now.getTime() - parkedMinutes * 60_000);
    const rate = resolveRate(siteId, null, 'CAR', entryAt.toISOString());
    const tz = q.get('SELECT tz_offset FROM sites WHERE id=?', siteId)?.tz_offset ?? 420;
    const base = { entryAt, endAt: now, config: rate.config, holidays: holidayDates(siteId), tzOffsetMinutes: tz };
    const fee = calculateFee(base).amount;
    const valueOf = (r: Reward) => {
      if (r.type === 'FULL') return fee;
      if (r.type === 'AMOUNT') return Math.min(fee, r.value);
      return Math.max(0, fee - calculateFee({ ...base, extraFreeMinutes: r.value }).amount);
    };
    const result = evaluateRewards(
      amounts.map((amount, i) => ({ receiptRef: `test-${i}`, merchantId, amount })),
      rules,
      valueOf,
      { now, tzOffsetMinutes: tz, siteId },
    );
    const feeAfter = result.full ? 0 : Math.max(0, calculateFee({ ...base, extraFreeMinutes: result.freeMinutes }).amount - result.amount);
    res.json({ ...result, sample: { parkedMinutes, planName: rate.planName, freeMinutes: rate.config.freeMinutes, fee, feeAfter } });
  }),
);

/** Minimal merchant list for rule editors / user merchant links. */
validationRouter.get(
  '/merchants-lite',
  requirePerm('validation.rules', 'users.manage', 'devices.manage', 'merchants.view'),
  h((_req, res) => {
    res.json({
      items: q.all('SELECT id, code, name, status FROM merchants ORDER BY name').map((m) => ({
        ...m,
        branches: q.all('SELECT id, code, name FROM merchant_branches WHERE merchant_id=? AND active=1 ORDER BY code', m.id),
      })),
    });
  }),
);

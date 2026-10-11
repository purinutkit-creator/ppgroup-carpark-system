import { DEFAULT_RATE, type RateConfig } from '@pp/shared';
import { q, json } from '../db/index.ts';

export interface RateSelection {
  planId: number | null;
  versionId: number | null;
  config: RateConfig;
  planName: string;
}

/** Most specific active plan: zone match > site match > global, then priority. */
export function selectPlan(siteId: number, zoneId: number | null, vehicleType: string) {
  return q.get(
    `SELECT * FROM rate_plans WHERE active=1 AND vehicle_type=?
       AND (site_id IS NULL OR site_id=?) AND (zone_id IS NULL OR zone_id=?)
     ORDER BY (zone_id IS NOT NULL) DESC, (site_id IS NOT NULL) DESC, priority DESC, id LIMIT 1`,
    vehicleType,
    siteId,
    zoneId ?? -1,
  );
}

/** Version in force at `at` (entry time) — later edits never change older sessions. */
export function versionAt(planId: number, at: string) {
  return q.get('SELECT * FROM rate_plan_versions WHERE plan_id=? AND effective_from<=? ORDER BY effective_from DESC, id DESC LIMIT 1', planId, at);
}

export function resolveRate(siteId: number, zoneId: number | null, vehicleType: string, at: string, overridePlanId?: number | null): RateSelection {
  const plan = overridePlanId
    ? q.get('SELECT * FROM rate_plans WHERE id=?', overridePlanId)
    : (selectPlan(siteId, zoneId, vehicleType) ?? selectPlan(siteId, zoneId, 'CAR'));
  if (!plan) return { planId: null, versionId: null, config: DEFAULT_RATE, planName: 'Default' };
  const v = versionAt(plan.id, at);
  if (!v) return { planId: plan.id, versionId: null, config: DEFAULT_RATE, planName: plan.name };
  return { planId: plan.id, versionId: v.id, config: { ...DEFAULT_RATE, ...json<RateConfig>(v.config_json, DEFAULT_RATE) }, planName: plan.name };
}

export function rateForVersion(versionId: number | null): RateConfig {
  if (!versionId) return DEFAULT_RATE;
  const v = q.get('SELECT config_json FROM rate_plan_versions WHERE id=?', versionId);
  return { ...DEFAULT_RATE, ...json<RateConfig>(v?.config_json, DEFAULT_RATE) };
}

export function holidayDates(siteId: number): string[] {
  return q.all<{ date: string }>('SELECT date FROM holidays WHERE site_id IS NULL OR site_id=?', siteId).map((r) => r.date);
}

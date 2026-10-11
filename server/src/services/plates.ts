import { q, nowIso } from '../db/index.ts';

export interface PlateStatus {
  blacklisted: boolean;
  blacklistReason?: string;
  whitelisted: boolean;
  exempt: boolean;
  specialRatePlanId: number | null;
  pass: any | null;
  member: any | null;
}

/** Look up lists / passes / membership for an exact plate key (prefix|number|province). */
export function plateStatus(plateKey: string | null, siteId: number, at = nowIso()): PlateStatus {
  const res: PlateStatus = { blacklisted: false, whitelisted: false, exempt: false, specialRatePlanId: null, pass: null, member: null };
  if (!plateKey) return res;
  const lists = q.all(
    `SELECT * FROM plate_lists WHERE plate_key=? AND active=1 AND (site_id IS NULL OR site_id=?)
      AND (valid_from IS NULL OR valid_from<=?) AND (valid_to IS NULL OR valid_to>=?)`,
    plateKey,
    siteId,
    at,
    at,
  );
  for (const l of lists) {
    if (l.list_type === 'BLACKLIST') {
      res.blacklisted = true;
      res.blacklistReason = l.reason;
    }
    if (l.list_type === 'WHITELIST') res.whitelisted = true;
    if (l.list_type === 'EXEMPT') res.exempt = true;
    if (l.list_type === 'SPECIAL_RATE' && l.rate_plan_id) res.specialRatePlanId = l.rate_plan_id;
  }
  res.pass =
    q.get(
      `SELECT * FROM passes WHERE plate_key=? AND active=1 AND (site_id IS NULL OR site_id=?) AND valid_from<=? AND valid_to>=? ORDER BY valid_to DESC LIMIT 1`,
      plateKey,
      siteId,
      at,
      at,
    ) ?? null;
  res.member =
    q.get(
      `SELECT m.*, t.benefits_json FROM member_vehicles v JOIN members m ON m.id=v.member_id LEFT JOIN member_tiers t ON t.code=m.tier
        WHERE v.plate_key=? AND m.active=1 LIMIT 1`,
      plateKey,
    ) ?? null;
  return res;
}

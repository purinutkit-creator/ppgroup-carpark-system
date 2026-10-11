/**
 * Admin configuration API (/api/admin). Each area lives in services/admin-*.ts
 * and enforces its own permission; every change is audited with before/after.
 */
import { Router } from 'express';
import { q, json, type Row } from '../db/index.ts';
import { h } from '../lib/http.ts';
import { requirePerm, requireUser } from '../auth/middleware.ts';
import { getSetting } from '../lib/settings.ts';
import { sitesRouter } from '../services/admin-sites.ts';
import { devicesRouter } from '../services/admin-devices.ts';
import { usersRouter } from '../services/admin-users.ts';
import { ratesRouter } from '../services/admin-rates.ts';
import { validationRouter } from '../services/admin-validation.ts';
import { membersRouter } from '../services/admin-members.ts';
import { reservationsRouter } from '../services/admin-reservations.ts';
import { kioskRouter } from '../services/admin-kiosk.ts';
import { settingsRouter } from '../services/admin-settings.ts';
import { systemRouter } from '../services/admin-system.ts';

export const router = Router();

/** Badge counters for the admin navigation. */
router.get(
  '/counts',
  requireUser,
  h((_req, res) => {
    res.json({
      review: q.get<{ n: number }>("SELECT COUNT(*) n FROM detections WHERE review_status='PENDING'")!.n,
      alerts: q.get<{ n: number }>('SELECT COUNT(*) n FROM alerts WHERE resolved_at IS NULL AND acknowledged_at IS NULL')!.n,
    });
  }),
);

/**
 * Reference data for configuration forms and "Apply To…" target pickers
 * (sites, zones, gates, devices without connection details, rate plans, vehicle types).
 */
router.get(
  '/lookups',
  requirePerm(
    'settings.manage', 'rates.manage', 'validation.rules', 'members.manage', 'lists.manage', 'reservations.manage',
    'kiosk_content.manage', 'devices.manage', 'sites.manage', 'users.manage', 'pdpa.manage', 'backup.manage',
  ),
  h((req, res) => {
    const ids = req.user!.siteIds;
    const inScope = (r: Row) => !ids || r.site_id == null || ids.includes(r.site_id);
    res.json({
      sites: q.all('SELECT id, code, name, capacity, tz_offset FROM sites WHERE active=1 ORDER BY id').filter((s) => !ids || ids.includes(s.id)),
      zones: q.all('SELECT id, site_id, name, capacity, vehicle_types FROM zones WHERE active=1 ORDER BY site_id, id').filter(inScope).map((z) => ({ ...z, vehicle_types: json(z.vehicle_types, null) })),
      gates: q.all('SELECT id, site_id, zone_id, name, direction FROM gates WHERE active=1 ORDER BY site_id, id').filter(inScope),
      devices: q.all('SELECT id, site_id, gate_id, type, name, status FROM devices WHERE active=1 ORDER BY site_id, type, id').filter(inScope),
      ratePlans: q.all('SELECT id, site_id, zone_id, name, vehicle_type FROM rate_plans WHERE active=1 ORDER BY vehicle_type, id').filter(inScope),
      vehicleTypes: getSetting('operation').vehicleTypes,
    });
  }),
);

router.use(sitesRouter);
router.use(devicesRouter);
router.use(usersRouter);
router.use(ratesRouter);
router.use(validationRouter);
router.use(membersRouter);
router.use(reservationsRouter);
router.use(kioskRouter);
router.use(settingsRouter);
router.use(systemRouter);

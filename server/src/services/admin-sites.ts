/**
 * Admin: sites → zones → gates (sites.manage). Soft delete via active=0 so
 * historical sessions keep their references.
 */
import { Router } from 'express';
import { q, json, tx } from '../db/index.ts';
import { body, bool, h, int, oneOf, reqStr, str, conflict } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { emit } from '../lib/realtime.ts';
import { assertSiteWrite, changed, idParam, mustGet, strList } from './admin-common.ts';

export const sitesRouter = Router();
const guard = requirePerm('sites.manage');

export interface GateSettings {
  autoIssueTicket?: boolean;
  allowTicketWithoutPlate?: boolean;
}

function gateSettings(v: unknown, current: GateSettings = {}): GateSettings {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out: GateSettings = { ...current };
  for (const k of ['autoIssueTicket', 'allowTicketWithoutPlate'] as const) {
    if (o[k] === null) delete out[k];
    else if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  }
  return out;
}

function siteTree(siteIds: number[] | null, includeInactive: boolean) {
  const act = includeInactive ? '' : ' AND active=1';
  const sites = q.all(`SELECT * FROM sites WHERE 1=1${act} ORDER BY id`).filter((s) => !siteIds || siteIds.includes(s.id));
  const zones = q.all(`SELECT * FROM zones WHERE 1=1${act} ORDER BY site_id, id`);
  const gates = q.all(`SELECT * FROM gates WHERE 1=1${act} ORDER BY site_id, id`);
  const occ = new Map<string, number>();
  for (const r of q.all("SELECT site_id, zone_id, COUNT(*) n FROM parking_sessions WHERE status='ACTIVE' GROUP BY site_id, zone_id")) {
    occ.set(`${r.site_id}`, (occ.get(`${r.site_id}`) ?? 0) + r.n);
    if (r.zone_id) occ.set(`${r.site_id}:${r.zone_id}`, r.n);
  }
  const devCount = new Map<number, number>();
  for (const r of q.all('SELECT gate_id, COUNT(*) n FROM devices WHERE active=1 AND gate_id IS NOT NULL GROUP BY gate_id')) devCount.set(r.gate_id, r.n);
  return sites.map((s) => ({
    ...s,
    settings: json(s.settings_json, {}),
    occupied: occ.get(`${s.id}`) ?? 0,
    zones: zones
      .filter((z) => z.site_id === s.id)
      .map((z) => ({ ...z, vehicle_types: json<string[] | null>(z.vehicle_types, null), occupied: occ.get(`${s.id}:${z.id}`) ?? 0 })),
    gates: gates.filter((g) => g.site_id === s.id).map((g) => ({ ...g, settings: json(g.settings_json, {}), devices: devCount.get(g.id) ?? 0 })),
  }));
}

sitesRouter.get(
  '/sites',
  guard,
  h((req, res) => {
    res.json({ items: siteTree(req.user!.siteIds, req.query.all === '1') });
  }),
);

sitesRouter.post(
  '/sites',
  guard,
  h((req, res) => {
    if (req.user!.siteIds) throw conflict('SITE_SCOPED_USER', 'ผู้ใช้ที่จำกัดสาขาไม่สามารถสร้างสาขาใหม่ได้');
    const b = body(req);
    const row = {
      code: reqStr(b, 'code', 20).toUpperCase(),
      name: reqStr(b, 'name', 200),
      address: str(b, 'address', { max: 500 }) ?? null,
      tz_offset: int(b, 'tzOffset', { min: -720, max: 840 }) ?? 420,
      capacity: int(b, 'capacity', { min: 0 }) ?? 0,
      settings_json: JSON.stringify(b.settings && typeof b.settings === 'object' ? b.settings : {}),
    };
    const id = q.insert('sites', row);
    audit(req, { action: 'site.create', entityType: 'site', entityId: id, siteId: id, after: row });
    res.json({ id });
  }),
);

sitesRouter.put(
  '/sites/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('sites', id);
    assertSiteWrite(req, id);
    const b = body(req);
    const patch: Record<string, unknown> = {};
    if (b.code !== undefined) patch.code = reqStr(b, 'code', 20).toUpperCase();
    if (b.name !== undefined) patch.name = reqStr(b, 'name', 200);
    if (b.address !== undefined) patch.address = str(b, 'address', { max: 500 }) ?? null;
    if (b.tzOffset !== undefined) patch.tz_offset = int(b, 'tzOffset', { min: -720, max: 840, required: true });
    if (b.capacity !== undefined) patch.capacity = int(b, 'capacity', { min: 0, required: true });
    if (b.settings !== undefined && typeof b.settings === 'object') patch.settings_json = JSON.stringify(b.settings ?? {});
    if (b.active !== undefined) patch.active = bool(b, 'active') ? 1 : 0;
    const diff = changed(before, patch);
    q.update('sites', id, diff);
    audit(req, { action: 'site.update', entityType: 'site', entityId: id, siteId: id, before: pick(before, diff), after: diff });
    emit.staff('occupancy', { siteId: id });
    res.json({ ok: true });
  }),
);

sitesRouter.delete(
  '/sites/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    mustGet('sites', id);
    assertSiteWrite(req, id);
    const active = q.get<{ n: number }>("SELECT COUNT(*) n FROM parking_sessions WHERE site_id=? AND status='ACTIVE'", id)!.n;
    if (active) throw conflict('SITE_HAS_ACTIVE_SESSIONS', `มีรถจอดอยู่ ${active} คัน`);
    tx(() => {
      q.run('UPDATE sites SET active=0 WHERE id=?', id);
      q.run('UPDATE zones SET active=0 WHERE site_id=?', id);
      q.run('UPDATE gates SET active=0 WHERE site_id=?', id);
    });
    audit(req, { action: 'site.deactivate', entityType: 'site', entityId: id, siteId: id, before: { active: 1 }, after: { active: 0 } });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ zones --

function zoneRow(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) out.name = reqStr(b, 'name', 200);
  if (!partial || b.capacity !== undefined) out.capacity = int(b, 'capacity', { min: 0 }) ?? 0;
  if (!partial || b.vehicleTypes !== undefined) {
    const vt = strList(b.vehicleTypes);
    out.vehicle_types = vt ? JSON.stringify(vt) : null;
  }
  if (partial && b.active !== undefined) out.active = bool(b, 'active') ? 1 : 0;
  return out;
}

sitesRouter.post(
  '/zones',
  guard,
  h((req, res) => {
    const b = body(req);
    const siteId = int(b, 'siteId', { required: true })!;
    mustGet('sites', siteId, 'SITE_NOT_FOUND');
    assertSiteWrite(req, siteId);
    const row = { site_id: siteId, ...zoneRow(b, false) };
    const id = q.insert('zones', row);
    audit(req, { action: 'zone.create', entityType: 'zone', entityId: id, siteId, after: row });
    res.json({ id });
  }),
);

sitesRouter.put(
  '/zones/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('zones', id);
    assertSiteWrite(req, before.site_id);
    const diff = changed(before, zoneRow(body(req), true));
    q.update('zones', id, diff);
    audit(req, { action: 'zone.update', entityType: 'zone', entityId: id, siteId: before.site_id, before: pick(before, diff), after: diff });
    res.json({ ok: true });
  }),
);

sitesRouter.delete(
  '/zones/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('zones', id);
    assertSiteWrite(req, before.site_id);
    q.run('UPDATE zones SET active=0 WHERE id=?', id);
    audit(req, { action: 'zone.deactivate', entityType: 'zone', entityId: id, siteId: before.site_id, before: { active: before.active }, after: { active: 0 } });
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------ gates --

function gateRow(b: Record<string, unknown>, siteId: number, partial: boolean, current?: GateSettings) {
  const out: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) out.name = reqStr(b, 'name', 200);
  if (!partial || b.direction !== undefined) out.direction = oneOf(b, 'direction', ['ENTRY', 'EXIT'] as const, true);
  if (!partial || b.zoneId !== undefined) {
    const zoneId = int(b, 'zoneId') ?? null;
    if (zoneId) {
      const z = mustGet('zones', zoneId, 'ZONE_NOT_FOUND');
      if (z.site_id !== siteId) throw conflict('ZONE_SITE_MISMATCH');
    }
    out.zone_id = zoneId;
  }
  if (!partial || b.settings !== undefined) out.settings_json = JSON.stringify(gateSettings(b.settings, current));
  if (partial && b.active !== undefined) out.active = bool(b, 'active') ? 1 : 0;
  return out;
}

sitesRouter.post(
  '/gates',
  guard,
  h((req, res) => {
    const b = body(req);
    const siteId = int(b, 'siteId', { required: true })!;
    mustGet('sites', siteId, 'SITE_NOT_FOUND');
    assertSiteWrite(req, siteId);
    const row = { site_id: siteId, ...gateRow(b, siteId, false) };
    const id = q.insert('gates', row);
    audit(req, { action: 'gate.create', entityType: 'gate', entityId: id, siteId, after: row });
    res.json({ id });
  }),
);

sitesRouter.put(
  '/gates/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('gates', id);
    assertSiteWrite(req, before.site_id);
    const diff = changed(before, gateRow(body(req), before.site_id, true, json<GateSettings>(before.settings_json, {})));
    q.update('gates', id, diff);
    audit(req, { action: 'gate.update', entityType: 'gate', entityId: id, siteId: before.site_id, before: pick(before, diff), after: diff });
    emit.gate(id, 'gate:config', { gateId: id });
    res.json({ ok: true });
  }),
);

sitesRouter.delete(
  '/gates/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('gates', id);
    assertSiteWrite(req, before.site_id);
    q.run('UPDATE gates SET active=0 WHERE id=?', id);
    audit(req, { action: 'gate.deactivate', entityType: 'gate', entityId: id, siteId: before.site_id, before: { active: before.active }, after: { active: 0 } });
    res.json({ ok: true });
  }),
);

function pick(row: Record<string, unknown>, keys: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(keys)) out[k] = row[k];
  return out;
}

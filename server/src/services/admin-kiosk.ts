/**
 * Admin: kiosk content CMS (kiosk_content.manage). Every change pushes
 * `kiosk:content` to each kiosk device room so playlists refresh live.
 */
import { Router } from 'express';
import { q, json, tx, type Row } from '../db/index.ts';
import { body, h, int, oneOf, reqStr, bool, badRequest } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { emit } from '../lib/realtime.ts';
import { hhmmOrNull, idList, idParam, isoOrNull, mustGet, strList } from './admin-common.ts';
import { KIOSK_TYPES } from './admin-devices.ts';

export const kioskRouter = Router();
const guard = requirePerm('kiosk_content.manage');

type Obj = Record<string, unknown>;
const CATEGORIES = ['PROMOTION', 'CAMPAIGN', 'BANNER', 'ADVERTISEMENT'] as const;

/** Push a playlist refresh to every kiosk device (and staff previews). */
export function broadcastKioskContent(reason: string) {
  const payload = { reason, at: new Date().toISOString() };
  for (const d of q.all(`SELECT id FROM devices WHERE active=1 AND type IN (${KIOSK_TYPES.map(() => '?').join(',')})`, ...KIOSK_TYPES)) emit.device(d.id, 'kiosk:content', payload);
  emit.staff('kiosk:content', payload);
}

function contentView(c: Row) {
  return {
    ...c,
    site_ids: json<number[] | null>(c.site_ids, null),
    device_ids: json<number[] | null>(c.device_ids, null),
    kiosk_types: json<string[] | null>(c.kiosk_types, null),
    active: !!c.active,
  };
}

function contentRow(b: Obj, current?: Row) {
  const out: Record<string, unknown> = {};
  const has = (k: string) => !current || b[k] !== undefined;
  if (has('title')) out.title = reqStr(b, 'title', 200);
  if (has('mediaUrl')) {
    const url = reqStr(b, 'mediaUrl', 1000);
    if (!url.startsWith('/uploads/public/') && !/^https:\/\//.test(url)) throw badRequest('INVALID_MEDIA_URL', 'ใช้ไฟล์ที่อัปโหลดผ่านระบบ หรือ URL https เท่านั้น');
    out.media_url = url;
  }
  if (has('kind')) out.kind = oneOf(b, 'kind', ['IMAGE', 'VIDEO'] as const) ?? (/\.(mp4|webm)$/i.test(String(out.media_url ?? current?.media_url ?? '')) ? 'VIDEO' : 'IMAGE');
  if (has('category')) out.category = oneOf(b, 'category', CATEGORIES) ?? 'PROMOTION';
  if (has('layout')) out.layout = oneOf(b, 'layout', ['FULL', 'SPLIT'] as const) ?? 'FULL';
  if (has('durationSec')) out.duration_sec = int(b, 'durationSec', { min: 3, max: 600 }) ?? 10;
  if (has('sort')) out.sort = int(b, 'sort') ?? (current ? current.sort : (q.get<{ m: number }>('SELECT COALESCE(MAX(sort),0)+1 m FROM kiosk_content')!.m));
  if (has('startAt')) out.start_at = isoOrNull(b.startAt, 'startAt');
  if (has('endAt')) out.end_at = isoOrNull(b.endAt, 'endAt');
  const s = (out.start_at !== undefined ? out.start_at : current?.start_at) as string | null;
  const e = (out.end_at !== undefined ? out.end_at : current?.end_at) as string | null;
  if (s && e && e <= s) throw badRequest('VALIDATION', 'วันสิ้นสุดต้องหลังวันเริ่ม');
  if (has('dailyStart')) out.daily_start = hhmmOrNull(b.dailyStart, 'dailyStart');
  if (has('dailyEnd')) out.daily_end = hhmmOrNull(b.dailyEnd, 'dailyEnd');
  if (!!(out.daily_start ?? current?.daily_start) !== !!(out.daily_end ?? current?.daily_end)) throw badRequest('VALIDATION', 'ต้องระบุทั้งเวลาเริ่มและสิ้นสุดของแต่ละวัน');
  if (has('siteIds')) {
    const ids = idList(b.siteIds);
    out.site_ids = ids ? JSON.stringify(ids) : null;
  }
  if (has('deviceIds')) {
    const ids = idList(b.deviceIds);
    for (const id of ids ?? []) {
      const d = mustGet('devices', id, 'DEVICE_NOT_FOUND');
      if (!(KIOSK_TYPES as readonly string[]).includes(d.type)) throw badRequest('NOT_A_KIOSK', `${d.name} ไม่ใช่ Kiosk`);
    }
    out.device_ids = ids ? JSON.stringify(ids) : null;
  }
  if (has('kioskTypes')) {
    const t = strList(b.kioskTypes, KIOSK_TYPES);
    out.kiosk_types = t ? JSON.stringify(t) : null;
  }
  if (current && b.active !== undefined) out.active = bool(b, 'active') ? 1 : 0;
  return out;
}

kioskRouter.get(
  '/kiosk-content',
  guard,
  h((req, res) => {
    const rows = q.all(
      `SELECT c.*, u.display_name created_by_name FROM kiosk_content c LEFT JOIN users u ON u.id=c.created_by
        WHERE (?=1 OR c.active=1) ORDER BY c.active DESC, c.sort, c.id`,
      req.query.all === '0' ? 0 : 1,
    );
    const kiosks = q.all(
      `SELECT d.id, d.name, d.type, d.site_id, d.status, s.name site_name FROM devices d LEFT JOIN sites s ON s.id=d.site_id
        WHERE d.active=1 AND d.type IN (${KIOSK_TYPES.map(() => '?').join(',')}) ORDER BY d.site_id, d.type, d.id`,
      ...KIOSK_TYPES,
    );
    res.json({ items: rows.map(contentView), kiosks, kioskTypes: KIOSK_TYPES, categories: CATEGORIES });
  }),
);

kioskRouter.post(
  '/kiosk-content',
  guard,
  h((req, res) => {
    const row = { ...contentRow(body(req)), created_by: req.user!.id };
    const id = q.insert('kiosk_content', row);
    audit(req, { action: 'kiosk_content.create', entityType: 'kiosk_content', entityId: id, after: row });
    broadcastKioskContent('create');
    res.json({ id });
  }),
);

/** Reorder the playlist: ids in the desired order. */
kioskRouter.post(
  '/kiosk-content/reorder',
  guard,
  h((req, res) => {
    const ids = idList(body(req).ids);
    if (!ids) throw badRequest('VALIDATION', 'ids required');
    const before = q.all('SELECT id, sort FROM kiosk_content ORDER BY sort, id');
    tx(() => ids.forEach((id, i) => q.run('UPDATE kiosk_content SET sort=? WHERE id=?', i + 1, id)));
    audit(req, { action: 'kiosk_content.reorder', entityType: 'kiosk_content', before: before.map((r) => r.id), after: ids });
    broadcastKioskContent('reorder');
    res.json({ ok: true });
  }),
);

/** "Apply to all kiosks": clear device / type / site targeting on the given items (or all). */
kioskRouter.post(
  '/kiosk-content/apply-all',
  requirePerm('kiosk_content.manage'),
  h((req, res) => {
    if (!req.user!.permissions.has('configuration.apply_all') && !req.user!.permissions.has('configuration.apply')) {
      throw badRequest('APPLY_FORBIDDEN', 'ต้องมีสิทธิ์ configuration.apply');
    }
    const ids = idList(body(req).ids);
    const rows = ids ? q.all(`SELECT * FROM kiosk_content WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : q.all('SELECT * FROM kiosk_content WHERE active=1');
    tx(() => rows.forEach((r) => q.run('UPDATE kiosk_content SET device_ids=NULL, kiosk_types=NULL, site_ids=NULL WHERE id=?', r.id)));
    audit(req, {
      action: 'kiosk_content.apply_all',
      entityType: 'kiosk_content',
      entityId: rows.map((r) => r.id).join(','),
      before: rows.map((r) => ({ id: r.id, device_ids: r.device_ids, kiosk_types: r.kiosk_types, site_ids: r.site_ids })),
      after: { device_ids: null, kiosk_types: null, site_ids: null },
    });
    broadcastKioskContent('apply_all');
    res.json({ ok: true, count: rows.length });
  }),
);

kioskRouter.put(
  '/kiosk-content/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('kiosk_content', id);
    const patch = contentRow(body(req), before);
    const diff: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (before[k] !== v) diff[k] = v;
    q.update('kiosk_content', id, diff);
    const prev: Record<string, unknown> = {};
    for (const k of Object.keys(diff)) prev[k] = before[k];
    audit(req, { action: 'kiosk_content.update', entityType: 'kiosk_content', entityId: id, before: prev, after: diff });
    broadcastKioskContent('update');
    res.json({ ok: true });
  }),
);

kioskRouter.delete(
  '/kiosk-content/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('kiosk_content', id);
    q.run('DELETE FROM kiosk_content WHERE id=?', id);
    audit(req, { action: 'kiosk_content.delete', entityType: 'kiosk_content', entityId: id, before });
    broadcastKioskContent('delete');
    res.json({ ok: true });
  }),
);

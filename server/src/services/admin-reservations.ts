/**
 * Admin: reservations (reservations.manage). Codes are RS + yymmdd + daily
 * sequence; capacity is checked per zone (or site when no zone is chosen)
 * against overlapping bookings plus cars currently parked.
 */
import { Router } from 'express';
import { q, tx, type Row } from '../db/index.ts';
import { body, h, int, num, oneOf, reqStr, str, badRequest, conflict, paging } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { nextSequence, ymd } from '../lib/sequence.ts';
import { assertSiteWrite, beforeOf, changed, idParam, isoOrNull, like, mustGet, plateFrom } from './admin-common.ts';

export const reservationsRouter = Router();
const guard = requirePerm('reservations.manage');

type Obj = Record<string, unknown>;
const STATUSES = ['BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
/** Allowed manual transitions. CHECKED_IN is normally set by the entry gate. */
const TRANSITIONS: Record<string, string[]> = {
  BOOKED: ['CANCELLED', 'NO_SHOW', 'CHECKED_IN'],
  CHECKED_IN: ['COMPLETED'],
  CANCELLED: ['BOOKED'],
  NO_SHOW: ['BOOKED'],
  COMPLETED: [],
};

export function reservationLoad(siteId: number, zoneId: number | null, startAt: string, endAt: string, excludeId?: number) {
  const cap = zoneId ? (q.get('SELECT capacity FROM zones WHERE id=?', zoneId)?.capacity ?? 0) : (q.get('SELECT capacity FROM sites WHERE id=?', siteId)?.capacity ?? 0);
  const booked = q.get<{ n: number }>(
    `SELECT COUNT(*) n FROM reservations WHERE site_id=? AND (? IS NULL OR zone_id=?) AND status IN ('BOOKED','CHECKED_IN')
       AND start_at<? AND end_at>? AND id!=?`,
    siteId, zoneId, zoneId, endAt, startAt, excludeId ?? -1,
  )!.n;
  const parked = q.get<{ n: number }>(
    "SELECT COUNT(*) n FROM parking_sessions WHERE site_id=? AND (? IS NULL OR zone_id=?) AND status='ACTIVE' AND reservation_id IS NULL",
    siteId, zoneId, zoneId,
  )!.n;
  return { capacity: cap, booked, parked, available: cap > 0 ? Math.max(0, cap - booked - parked) : null };
}

function assertCapacity(siteId: number, zoneId: number | null, startAt: string, endAt: string, excludeId?: number) {
  const load = reservationLoad(siteId, zoneId, startAt, endAt, excludeId);
  if (load.available !== null && load.available <= 0) throw conflict('ZONE_FULL', `ที่จอดเต็มในช่วงเวลานี้ (ความจุ ${load.capacity}, จองแล้ว ${load.booked}, จอดอยู่ ${load.parked})`, load);
  return load;
}

function resRow(b: Obj, current?: Row) {
  const out: Record<string, unknown> = {};
  let siteId = current?.site_id as number | undefined;
  if (!current || b.siteId !== undefined) {
    siteId = int(b, 'siteId', { required: true })!;
    mustGet('sites', siteId, 'SITE_NOT_FOUND');
    out.site_id = siteId;
  }
  if (!current || b.zoneId !== undefined || b.siteId !== undefined) {
    const zoneId = int(b, 'zoneId') ?? null;
    if (zoneId) {
      const z = mustGet('zones', zoneId, 'ZONE_NOT_FOUND');
      if (z.site_id !== siteId) throw conflict('ZONE_SITE_MISMATCH');
    }
    out.zone_id = zoneId;
  }
  if (!current || b.plate !== undefined || b.prefix !== undefined || b.province !== undefined) {
    const p = plateFrom({ prefix: str(b, 'prefix'), number: str(b, 'number'), plate: str(b, 'plate'), province: str(b, 'province') });
    Object.assign(out, { plate_key: p.key, plate_text: p.plateText, province: p.provinceCode });
  }
  if (!current || b.name !== undefined) out.name = reqStr(b, 'name', 200);
  if (!current || b.phone !== undefined) {
    const ph = reqStr(b, 'phone', 20).replace(/[\s-]/g, '');
    if (!/^\+?\d{9,15}$/.test(ph)) throw badRequest('INVALID_PHONE', 'เบอร์โทรศัพท์ไม่ถูกต้อง');
    out.phone = ph;
  }
  if (!current || b.startAt !== undefined) out.start_at = isoOrNull(b.startAt, 'startAt');
  if (!current || b.endAt !== undefined) out.end_at = isoOrNull(b.endAt, 'endAt');
  const start = (out.start_at ?? current?.start_at) as string | null;
  const end = (out.end_at ?? current?.end_at) as string | null;
  if (!start || !end) throw badRequest('VALIDATION', 'startAt and endAt are required');
  if (end <= start) throw badRequest('VALIDATION', 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
  if (!current || b.fee !== undefined) out.fee = num(b, 'fee', { min: 0 }) ?? 0;
  return out;
}

reservationsRouter.get(
  '/reservations',
  guard,
  h((req, res) => {
    const { limit, offset } = paging(req);
    const l = like(typeof req.query.q === 'string' ? req.query.q : undefined);
    const ids = req.user!.siteIds;
    const where = `(? IS NULL OR r.code LIKE ? OR r.name LIKE ? OR r.phone LIKE ? OR replace(r.plate_text,' ','') LIKE ?)
      AND (? IS NULL OR r.status=?) AND (? IS NULL OR r.end_at>=?) AND (? IS NULL OR r.start_at<=?)`;
    const from = isoOrNull(req.query.from, 'from');
    const to = isoOrNull(req.query.to, 'to');
    const st = req.query.status ? String(req.query.status) : null;
    const params = [l, l, l, l, l ? l.replace(/\s/g, '') : null, st, st, from, from, to, to];
    const rows = q
      .all(
        `SELECT r.*, s.name site_name, z.name zone_name, p.parking_no FROM reservations r
           LEFT JOIN sites s ON s.id=r.site_id LEFT JOIN zones z ON z.id=r.zone_id LEFT JOIN parking_sessions p ON p.id=r.session_id
          WHERE ${where} ORDER BY r.start_at DESC LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset,
      )
      .filter((r) => !ids || ids.includes(r.site_id));
    const total = q.get<{ n: number }>(`SELECT COUNT(*) n FROM reservations r WHERE ${where}`, ...params)!.n;
    res.json({ total, items: rows });
  }),
);

/** Availability for a window (used by the booking form before saving). */
reservationsRouter.get(
  '/reservations/availability',
  guard,
  h((req, res) => {
    const siteId = Number(req.query.siteId);
    if (!siteId) throw badRequest('VALIDATION', 'siteId is required');
    const start = isoOrNull(req.query.startAt, 'startAt');
    const end = isoOrNull(req.query.endAt, 'endAt');
    if (!start || !end) throw badRequest('VALIDATION', 'startAt and endAt are required');
    const zoneId = req.query.zoneId ? Number(req.query.zoneId) : null;
    res.json(reservationLoad(siteId, zoneId, start, end, req.query.excludeId ? Number(req.query.excludeId) : undefined));
  }),
);

reservationsRouter.post(
  '/reservations',
  guard,
  h((req, res) => {
    const row = resRow(body(req));
    assertSiteWrite(req, row.site_id as number);
    const out = tx(() => {
      assertCapacity(row.site_id as number, row.zone_id as number | null, row.start_at as string, row.end_at as string);
      const tz = q.get('SELECT tz_offset FROM sites WHERE id=?', row.site_id)?.tz_offset ?? 420;
      const day = ymd(new Date(row.start_at as string), tz).slice(2);
      const code = `RS${day}${String(nextSequence('reservation', day)).padStart(3, '0')}`;
      const id = q.insert('reservations', { ...row, code });
      return { id, code };
    });
    audit(req, { action: 'reservation.create', entityType: 'reservation', entityId: out.id, siteId: row.site_id as number, after: { ...row, code: out.code } });
    res.json(out);
  }),
);

reservationsRouter.put(
  '/reservations/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('reservations', id);
    assertSiteWrite(req, before.site_id);
    if (before.status !== 'BOOKED') throw conflict('RESERVATION_LOCKED', 'แก้ไขได้เฉพาะการจองสถานะ BOOKED');
    const diff = changed(before, resRow(body(req), before));
    if ('site_id' in diff) assertSiteWrite(req, diff.site_id as number);
    tx(() => {
      const next = { ...before, ...diff };
      if (['site_id', 'zone_id', 'start_at', 'end_at'].some((k) => k in diff)) assertCapacity(next.site_id, next.zone_id, next.start_at, next.end_at, id);
      q.update('reservations', id, diff);
    });
    audit(req, { action: 'reservation.update', entityType: 'reservation', entityId: id, siteId: before.site_id, before: beforeOf(before, diff), after: diff });
    res.json({ ok: true });
  }),
);

reservationsRouter.post(
  '/reservations/:id/status',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('reservations', id);
    assertSiteWrite(req, before.site_id);
    const b = body(req);
    const status = oneOf(b, 'status', STATUSES, true)!;
    if (!TRANSITIONS[before.status]?.includes(status)) throw conflict('INVALID_TRANSITION', `${before.status} → ${status} ไม่ได้`);
    tx(() => {
      if (status === 'BOOKED') assertCapacity(before.site_id, before.zone_id, before.start_at, before.end_at, id);
      q.run('UPDATE reservations SET status=? WHERE id=?', status, id);
    });
    audit(req, { action: `reservation.${status.toLowerCase()}`, entityType: 'reservation', entityId: id, siteId: before.site_id, before: { status: before.status }, after: { status }, reason: str(b, 'reason', { max: 500 }) ?? null });
    res.json({ ok: true });
  }),
);

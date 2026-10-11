/**
 * Edge agent sync. When the site loses its connection to the central server,
 * the edge agent keeps the gates running from a local queue (SQLite) and
 * replays events here when back online. Every event carries a UUID; replays
 * are idempotent (idempotency_keys), so nothing is created twice.
 */
import { Router } from 'express';
import { provinceByCode } from '@pp/shared';
import { q, json, tx, nowIso } from '../db/index.ts';
import { body, h, HttpError } from '../lib/http.ts';
import { requireDevice } from '../auth/middleware.ts';
import { raiseAlert } from '../lib/alerts.ts';
import { audit } from '../lib/audit.ts';
import { createSession, closeSession, quote, sessionByToken, findActiveByKey } from '../services/sessions.ts';
import { recordDetection } from '../services/detections.ts';
import { getSetting } from '../lib/settings.ts';

export const router = Router();
router.use(requireDevice('EDGE'));

interface EdgeEvent {
  id: string;
  type: 'ENTRY' | 'EXIT' | 'DETECTION' | 'BARRIER_OPEN';
  gateId: number;
  occurredAt: string;
  payload: any;
}

router.post(
  '/sync',
  h(async (req, res) => {
    const events = (body(req).events ?? []) as EdgeEvent[];
    if (!Array.isArray(events) || events.length > 500) throw new HttpError(400, 'INVALID_BATCH');
    const results = [];
    for (const ev of events) {
      const key = `edge:${req.device!.id}:${ev.id}`;
      const done = q.get('SELECT response_json FROM idempotency_keys WHERE key=?', key);
      if (done) {
        results.push({ id: ev.id, ...json(done.response_json, {}), replay: true });
        continue;
      }
      let result: Record<string, unknown>;
      try {
        result = processEvent(req.device!.id, req.device!.siteId, ev);
      } catch (e) {
        result = { ok: false, error: (e as HttpError).code ?? (e as Error).message };
        raiseAlert({ type: 'SYNC_CONFLICT', siteId: req.device!.siteId, refType: 'edge_event', refId: ev.id, message: `ซิงก์เหตุการณ์ ${ev.type} ไม่สำเร็จ: ${result.error}`, data: ev });
      }
      q.run('INSERT OR IGNORE INTO idempotency_keys (key, scope, response_json) VALUES (?,?,?)', key, 'edge', JSON.stringify(result));
      results.push({ id: ev.id, ...result });
    }
    res.json({ results, serverTime: nowIso() });
  }),
);

function processEvent(deviceId: number, siteId: number | null, ev: EdgeEvent): Record<string, unknown> {
  const gate = q.get('SELECT * FROM gates WHERE id=?', ev.gateId);
  if (!gate || (siteId && gate.site_id !== siteId)) throw new HttpError(403, 'GATE_FORBIDDEN');
  // Edge clock is trusted only within a sane window.
  const t = new Date(ev.occurredAt).getTime();
  if (!Number.isFinite(t) || t > Date.now() + 5 * 60_000 || t < Date.now() - 14 * 24 * 3600_000) throw new HttpError(400, 'INVALID_TIMESTAMP');
  const p = ev.payload ?? {};
  switch (ev.type) {
    case 'DETECTION': {
      const { detection } = recordDetection({ gateId: gate.id, cameraId: p.cameraId ?? null, capturedAt: ev.occurredAt, image: p.image, candidates: p.candidates ?? [], edgeEventId: `${deviceId}:${ev.id}` });
      return { ok: true, detectionId: detection.id };
    }
    case 'ENTRY': {
      const plate = p.plate?.prefix
        ? { prefix: p.plate.prefix, number: String(p.plate.number), provinceCode: p.plate.provinceCode ?? null, key: p.plate.key, text: `${p.plate.prefix} ${p.plate.number}`, source: p.plate.source ?? 'REAL_PLATE' }
        : null;
      const r = tx(() =>
        createSession({
          siteId: gate.site_id,
          zoneId: gate.zone_id,
          gateId: gate.id,
          plate,
          vehicleType: p.vehicleType ?? 'CAR',
          entryAt: ev.occurredAt,
          idempotencyKey: `edge:${deviceId}:${ev.id}`,
          presetToken: p.token ?? null,
          presetParkingNo: p.parkingNo ?? null,
          offline: true,
          force: true, // the car is already inside; record it even if lists changed
        }),
      );
      return { ok: true, sessionId: r.session.id, parkingNo: r.session.parking_no };
    }
    case 'EXIT': {
      const s = (p.token && sessionByToken(p.token)) || (p.parkingNo && q.get("SELECT * FROM parking_sessions WHERE parking_no=? AND status='ACTIVE'", p.parkingNo)) || (p.plateKey && findActiveByKey(p.plateKey));
      if (!s) return { ok: false, error: 'SESSION_NOT_FOUND' };
      if (s.status !== 'ACTIVE') return { ok: true, alreadyClosed: true };
      const qt = quote(s, new Date(ev.occurredAt));
      closeSession(s.id, { exitGateId: gate.id, exitAt: ev.occurredAt });
      if (qt.due > 0) {
        q.run('UPDATE parking_sessions SET flags=? WHERE id=?', JSON.stringify([...json<string[]>(s.flags, []), 'OFFLINE_EXIT_UNPAID']), s.id);
        raiseAlert({ type: 'SYNC_CONFLICT', severity: 'WARNING', siteId: gate.site_id, refType: 'session', refId: s.id, message: `รถออกระหว่างออฟไลน์โดยยังค้างชำระ ${qt.due} บาท: ${s.plate_text ?? s.parking_no} ${provinceByCode(s.province)?.th ?? ''}` });
      }
      return { ok: true, sessionId: s.id, dueAtExit: qt.due };
    }
    case 'BARRIER_OPEN': {
      audit(null, { action: 'gate.offline_barrier_open', entityType: 'gate', entityId: gate.id, siteId: gate.site_id, deviceId, reason: p.reason ?? null, meta: { occurredAt: ev.occurredAt, by: p.by } });
      return { ok: true };
    }
    default:
      throw new HttpError(400, 'UNKNOWN_EVENT');
  }
}

/** Snapshot for offline operation: active sessions with paid state and token hashes. */
router.get(
  '/cache',
  h((req, res) => {
    const rows = q.all("SELECT * FROM parking_sessions WHERE status='ACTIVE' AND site_id=?", req.device!.siteId ?? 0);
    res.json({
      generatedAt: nowIso(),
      offlineExitPolicy: getSetting('operation').offlineExitPolicy,
      sessions: rows.map((s) => {
        const qt = quote(s);
        return { id: s.id, parkingNo: s.parking_no, plateKey: s.plate_key, tokenHash: s.token_hash, paid: qt.due <= 0, exitDeadlineAt: s.exit_deadline_at, ticketless: !!s.ticketless };
      }),
      passes: q.all("SELECT plate_key, valid_to, ticketless FROM passes WHERE active=1 AND valid_to>=?", nowIso()),
      lists: q.all("SELECT plate_key, list_type FROM plate_lists WHERE active=1 AND list_type IN ('WHITELIST','BLACKLIST','EXEMPT')"),
      gates: q.all('SELECT id, name, direction, settings_json FROM gates WHERE site_id=? AND active=1', req.device!.siteId ?? 0),
      devices: q.all('SELECT id, type, name, gate_id, connection_json, settings_json FROM devices WHERE site_id=? AND active=1', req.device!.siteId ?? 0).map((d) => ({ ...d, connection: json(d.connection_json, {}), settings: json(d.settings_json, {}) })),
      lpr: getSetting('lpr'),
      ticket: getSetting('ticket'),
    });
  }),
);

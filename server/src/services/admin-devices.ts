/**
 * Admin: devices (devices.manage). Connection settings are type specific and
 * sanitised to known keys. Credentials (passwords, API tokens, URL userinfo)
 * are stored but only ever returned masked; sending the mask back on update
 * keeps the stored secret.
 */
import { Router } from 'express';
import { EscPos, SOURCE_TYPES, type DetectionZone } from '@pp/shared';
import { q, json, nowIso, type Row } from '../db/index.ts';
import { body, h, int, oneOf, reqStr, str, bool, badRequest, conflict, paging } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { emit } from '../lib/realtime.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import { config } from '../config.ts';
import { printRaw } from './printers.ts';
import { openBarrier } from './barrier.ts';
import { assertSiteWrite, idParam, mustGet } from './admin-common.ts';

export const devicesRouter = Router();
const guard = requirePerm('devices.manage');

export const DEVICE_TYPES = ['CAMERA', 'PRINTER', 'BARRIER', 'ENTRY_KIOSK', 'EXIT_KIOSK', 'PAYMENT_KIOSK', 'COUNTER', 'EDGE', 'DISPLAY', 'POS'] as const;
export const KIOSK_TYPES = ['ENTRY_KIOSK', 'EXIT_KIOSK', 'PAYMENT_KIOSK'] as const;
export const MASK = '********';
const SECRET_KEY = /pass(word)?$|secret|token|api_?key|credential/i;

// ------------------------------------------------------------ secrets ------

function maskUrl(u: string): string {
  return u.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/:@\s]+):([^@/\s]+)@/i, `$1:${MASK}@`);
}

/** Deep copy with every credential replaced by MASK. */
export function maskSecrets(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(maskSecrets);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (SECRET_KEY.test(k) && typeof x === 'string' && x) out[k] = MASK;
      else out[k] = maskSecrets(x);
    }
    return out;
  }
  return typeof v === 'string' ? maskUrl(v) : v;
}

/** Put stored secrets back where the client sent the mask. */
function restoreSecrets(incoming: unknown, stored: unknown): unknown {
  if (Array.isArray(incoming)) return incoming.map((x, i) => restoreSecrets(x, Array.isArray(stored) ? stored[i] : undefined));
  if (incoming && typeof incoming === 'object') {
    const st = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(incoming)) out[k] = restoreSecrets(x, st[k]);
    return out;
  }
  if (typeof incoming === 'string') {
    if (incoming === MASK) return typeof stored === 'string' ? stored : '';
    if (incoming.includes(`:${MASK}@`) && typeof stored === 'string') {
      const m = /^([a-z][a-z0-9+.-]*:\/\/[^/:@\s]+):([^@/\s]+)@/i.exec(stored);
      return m ? incoming.replace(`:${MASK}@`, `:${m[2]}@`) : incoming.replace(`:${MASK}@`, '@');
    }
  }
  return incoming;
}

// --------------------------------------------------------- sanitising ------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const n = (v: unknown, min = 0, max = 65535) => {
  const x = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? Math.trunc(x) : undefined;
};
const e = <T extends string>(v: unknown, values: readonly T[]) => (values.includes(v as T) ? (v as T) : undefined);
function clean(o: Obj): Obj {
  for (const k of Object.keys(o)) if (o[k] === undefined || (typeof o[k] === 'object' && o[k] !== null && !Array.isArray(o[k]) && !Object.keys(o[k] as Obj).length)) delete o[k];
  return o;
}
function urlOk(v: unknown, schemes: string[]) {
  const u = s(v, 1000);
  if (!u) return undefined;
  if (!schemes.some((p) => u.toLowerCase().startsWith(p))) throw badRequest('INVALID_URL', `URL ต้องขึ้นต้นด้วย ${schemes.join(' / ')}`);
  return u;
}

function edgeId(v: unknown): number | undefined {
  const id = n(v, 1, Number.MAX_SAFE_INTEGER);
  if (id === undefined) return undefined;
  const d = q.get("SELECT id FROM devices WHERE id=? AND type='EDGE'", id);
  if (!d) throw badRequest('EDGE_NOT_FOUND', 'edgeDeviceId ต้องเป็นอุปกรณ์ประเภท EDGE');
  return id;
}

export function detectionZones(v: unknown): DetectionZone[] {
  if (!Array.isArray(v)) return [];
  const clamp = (x: unknown) => Math.min(1, Math.max(0, Number(x) || 0));
  return v.slice(0, 20).map((z, i) => {
    const o = obj(z);
    const r = obj(o.rect);
    const x = clamp(r.x);
    const y = clamp(r.y);
    return {
      name: s(o.name, 60) ?? `Zone ${i + 1}`,
      rect: { x, y, w: Math.min(clamp(r.w), 1 - x), h: Math.min(clamp(r.h), 1 - y) },
      expect: e(o.expect, SOURCE_TYPES) ?? 'GENERAL_OCR',
    };
  }).filter((z) => z.rect.w > 0.005 && z.rect.h > 0.005);
}

function connectionFor(type: string, v: unknown): Obj {
  const c = obj(v);
  switch (type) {
    case 'CAMERA': {
      const onvif = obj(c.onvif);
      return clean({
        protocol: e(c.protocol, ['rtsp', 'onvif', 'http-lpr', 'platerecognizer'] as const) ?? 'rtsp',
        rtspUrl: urlOk(c.rtspUrl, ['rtsp://', 'rtsps://']),
        onvif: clean({ host: s(onvif.host, 200), port: n(onvif.port, 1), username: s(onvif.username, 100), password: s(onvif.password, 200) }),
        snapshotUrl: urlOk(c.snapshotUrl, ['http://', 'https://']),
        lprFormat: s(c.lprFormat, 40),
        apiToken: s(c.apiToken, 300),
        edgeDeviceId: edgeId(c.edgeDeviceId),
      });
    }
    case 'PRINTER':
      return clean({
        mode: e(c.mode, ['lan', 'edge', 'bridge'] as const) ?? 'lan',
        host: s(c.host, 200),
        port: n(c.port, 1),
        bridgeUrl: urlOk(c.bridgeUrl, ['http://', 'https://']),
        usbPath: s(c.usbPath, 200),
        bluetoothAddress: s(c.bluetoothAddress, 40),
        paperWidth: e(String(c.paperWidth ?? ''), ['58', '80'] as const) ?? '80',
        edgeDeviceId: edgeId(c.edgeDeviceId),
      });
    case 'BARRIER': {
      const hex = s(c.payloadHex, 400)?.replace(/\s+/g, '');
      if (hex && !/^([0-9a-f]{2})+$/i.test(hex)) throw badRequest('INVALID_PAYLOAD_HEX');
      return clean({
        mode: e(c.mode, ['http', 'tcp', 'edge', 'none'] as const) ?? 'edge',
        url: urlOk(c.url, ['http://', 'https://']),
        method: e(c.method, ['GET', 'POST'] as const),
        body: s(c.body, 2000),
        host: s(c.host, 200),
        port: n(c.port, 1),
        payloadHex: hex,
        edgeDeviceId: edgeId(c.edgeDeviceId),
      });
    }
    default:
      return clean({ host: s(c.host, 200), bridgeUrl: urlOk(c.bridgeUrl, ['http://', 'https://']), edgeDeviceId: edgeId(c.edgeDeviceId), note: s(c.note, 500) });
  }
}

/** Settings: known structured keys + flat primitive options (kiosk flags etc.). */
function settingsFor(type: string, v: unknown): Obj {
  const src = obj(v);
  const out: Obj = {};
  for (const [k, x] of Object.entries(src).slice(0, 50)) {
    if (k === 'zones') continue;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k)) continue;
    if (typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x))) out[k] = x;
    else if (typeof x === 'string') out[k] = x.slice(0, 1000);
    else if (Array.isArray(x) && x.every((i) => ['string', 'number'].includes(typeof i))) out[k] = x.slice(0, 50);
  }
  if (type === 'CAMERA') out.zones = detectionZones(src.zones);
  return out;
}

export function publicDevice(d: Row) {
  return {
    ...d,
    api_key_hash: undefined,
    hasKey: !!d.api_key_hash,
    connection: maskSecrets(json(d.connection_json, {})),
    settings: json(d.settings_json, {}),
    connection_json: undefined,
    settings_json: undefined,
  };
}

// ------------------------------------------------------------- routes ------

devicesRouter.get(
  '/devices',
  guard,
  h((req, res) => {
    const ids = req.user!.siteIds;
    const rows = q.all(
      `SELECT d.*, s.name site_name, g.name gate_name, g.direction gate_direction, m.name merchant_name
         FROM devices d LEFT JOIN sites s ON s.id=d.site_id LEFT JOIN gates g ON g.id=d.gate_id LEFT JOIN merchants m ON m.id=d.merchant_id
        WHERE (?=1 OR d.active=1) ORDER BY d.site_id, d.type, d.id`,
      req.query.all === '1' ? 1 : 0,
    ).filter((d) => !ids || d.site_id == null || ids.includes(d.site_id));
    const logs = new Map<number, Row[]>();
    for (const l of q.all('SELECT * FROM (SELECT l.*, ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY id DESC) rn FROM device_status_log l) WHERE rn<=5')) {
      if (!logs.has(l.device_id)) logs.set(l.device_id, []);
      logs.get(l.device_id)!.push({ status: l.status, detail: l.detail, created_at: l.created_at });
    }
    res.json({ items: rows.map((d) => ({ ...publicDevice(d), recentLog: logs.get(d.id) ?? [] })), types: DEVICE_TYPES });
  }),
);

devicesRouter.get(
  '/devices/:id/log',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const { limit, offset } = paging(req);
    res.json({ items: q.all('SELECT * FROM device_status_log WHERE device_id=? ORDER BY id DESC LIMIT ? OFFSET ?', id, limit, offset) });
  }),
);

function placement(b: Obj, current?: Row) {
  const siteId = b.siteId !== undefined ? (int(b, 'siteId') ?? null) : (current?.site_id ?? null);
  const gateId = b.gateId !== undefined ? (int(b, 'gateId') ?? null) : (current?.gate_id ?? null);
  if (siteId) mustGet('sites', siteId, 'SITE_NOT_FOUND');
  if (gateId) {
    const g = mustGet('gates', gateId, 'GATE_NOT_FOUND');
    if (siteId && g.site_id !== siteId) throw conflict('GATE_SITE_MISMATCH');
    return { site_id: g.site_id, gate_id: gateId };
  }
  return { site_id: siteId, gate_id: null };
}

devicesRouter.post(
  '/devices',
  guard,
  h((req, res) => {
    const b = body(req);
    const type = oneOf(b, 'type', DEVICE_TYPES, true)!;
    const place = placement(b);
    assertSiteWrite(req, place.site_id);
    const merchantId = int(b, 'merchantId') ?? null;
    if (merchantId) mustGet('merchants', merchantId, 'MERCHANT_NOT_FOUND');
    const conn = connectionFor(type, b.connection);
    const settings = settingsFor(type, b.settings);
    const row = {
      type,
      name: reqStr(b, 'name', 200),
      model: str(b, 'model', { max: 200 }) ?? null,
      ...place,
      merchant_id: merchantId,
      connection_json: JSON.stringify(conn),
      settings_json: JSON.stringify(settings),
    };
    const id = q.insert('devices', row);
    audit(req, { action: 'device.create', entityType: 'device', entityId: id, siteId: place.site_id, deviceId: id, after: { ...row, connection_json: undefined, connection: maskSecrets(conn) } });
    res.json({ id });
  }),
);

devicesRouter.put(
  '/devices/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('devices', id);
    assertSiteWrite(req, before.site_id);
    const b = body(req);
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch.name = reqStr(b, 'name', 200);
    if (b.model !== undefined) patch.model = str(b, 'model', { max: 200 }) ?? null;
    if (b.siteId !== undefined || b.gateId !== undefined) {
      Object.assign(patch, placement(b, before));
      assertSiteWrite(req, patch.site_id as number | null);
    }
    if (b.merchantId !== undefined) {
      const m = int(b, 'merchantId') ?? null;
      if (m) mustGet('merchants', m, 'MERCHANT_NOT_FOUND');
      patch.merchant_id = m;
    }
    const storedConn = json(before.connection_json, {});
    let newConn: Obj | null = null;
    if (b.connection !== undefined) {
      newConn = connectionFor(before.type, restoreSecrets(b.connection, storedConn));
      patch.connection_json = JSON.stringify(newConn);
    }
    if (b.settings !== undefined) patch.settings_json = JSON.stringify(settingsFor(before.type, b.settings));
    if (b.active !== undefined) patch.active = bool(b, 'active') ? 1 : 0;
    const diff: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (before[k] !== v) diff[k] = v;
    q.update('devices', id, diff);
    const redact = (r: Record<string, unknown>, conn: unknown) => ('connection_json' in r ? { ...r, connection_json: undefined, connection: maskSecrets(conn) } : r);
    const beforeVals: Record<string, unknown> = {};
    for (const k of Object.keys(diff)) beforeVals[k] = before[k];
    audit(req, { action: 'device.update', entityType: 'device', entityId: id, deviceId: id, siteId: before.site_id, before: redact(beforeVals, storedConn), after: redact(diff, newConn) });
    emit.device(id, 'device:config', { deviceId: id });
    res.json({ ok: true });
  }),
);

devicesRouter.delete(
  '/devices/:id',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const before = mustGet('devices', id);
    assertSiteWrite(req, before.site_id);
    // Deactivating also revokes the key so the device can no longer authenticate.
    q.run("UPDATE devices SET active=0, api_key_hash=NULL, status='OFFLINE' WHERE id=?", id);
    audit(req, { action: 'device.deactivate', entityType: 'device', entityId: id, deviceId: id, siteId: before.site_id, before: { active: before.active, hasKey: !!before.api_key_hash }, after: { active: 0, hasKey: false } });
    res.json({ ok: true });
  }),
);

/** Generate a new device key. The plain key is returned once and never stored. */
devicesRouter.post(
  '/devices/:id/key',
  guard,
  h((req, res) => {
    const id = idParam(req);
    const d = mustGet('devices', id);
    assertSiteWrite(req, d.site_id);
    if (!d.active) throw conflict('DEVICE_INACTIVE');
    const key = randomToken(24);
    q.run('UPDATE devices SET api_key_hash=? WHERE id=?', sha256(key), id);
    audit(req, { action: 'device.key_generate', entityType: 'device', entityId: id, deviceId: id, siteId: d.site_id, before: { hadKey: !!d.api_key_hash }, after: { hasKey: true } });
    res.json({ key, setupUrl: `${config.publicUrl.replace(/\/$/, '')}/setup?key=${encodeURIComponent(key)}`, device: { id, name: d.name, type: d.type } });
  }),
);

devicesRouter.post(
  '/devices/:id/test',
  guard,
  h(async (req, res) => {
    const id = idParam(req);
    const d = mustGet('devices', id);
    assertSiteWrite(req, d.site_id);
    const conn = json<Obj>(d.connection_json, {});
    if (d.type === 'PRINTER') {
      const viaBridge = conn.mode === 'bridge' || (!conn.host && conn.mode !== 'edge' && !conn.edgeDeviceId);
      audit(req, { action: 'device.test', entityType: 'device', entityId: id, deviceId: id, siteId: d.site_id, meta: { type: d.type, via: viaBridge ? 'bridge' : conn.mode } });
      if (viaBridge) return res.json({ ok: true, bridge: true, connection: maskSecrets(conn) });
      const p = new EscPos()
        .init()
        .align('center')
        .text('*** PRINTER TEST ***\n')
        .text(`Device #${d.id}\n`)
        .text(`${nowIso().replace('T', ' ').slice(0, 19)} UTC\n`)
        .text(`Paper ${conn.paperWidth ?? '80'}mm  ${String(conn.mode ?? 'lan').toUpperCase()}\n`)
        .text('--------------------------------\n')
        .text('Smart Parking Management\n')
        .feed(3)
        .cut();
      const r = await printRaw(id, Buffer.from(p.bytes()), { job: 'test', ref: `device:${id}` });
      return res.json({ ...r, bridge: false });
    }
    if (d.type === 'BARRIER') {
      if (!d.gate_id) throw conflict('BARRIER_NO_GATE', 'ไม้กั้นยังไม่ได้ผูกกับทางเข้า/ออก');
      const r = await openBarrier(d.gate_id, { reason: 'TEST', userId: req.user!.id });
      audit(req, { action: 'barrier.test_open', entityType: 'gate', entityId: d.gate_id, deviceId: id, siteId: d.site_id, after: r, reason: 'TEST' });
      return res.json(r);
    }
    // Other devices: report reachability from heartbeat state and ping the device room.
    emit.device(id, 'device:ping', { at: nowIso() });
    audit(req, { action: 'device.test', entityType: 'device', entityId: id, deviceId: id, siteId: d.site_id, meta: { type: d.type } });
    res.json({ ok: d.status === 'ONLINE', status: d.status, lastSeenAt: d.last_seen_at, lastError: d.last_error });
  }),
);

import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { setIo } from './lib/realtime.ts';
import { userFromToken, deviceFromKey } from './auth/middleware.ts';
import { sessionByToken, quote } from './services/sessions.ts';
import { q, nowIso } from './db/index.ts';
import { resolveAlerts, raiseAlert } from './lib/alerts.ts';

/**
 * Socket auth (handshake.auth):
 *   { token }         staff user  → joins staff, site:<id>…, merchant:<id>
 *   { deviceKey }     device      → joins device:<id>, gate:<id>
 *   { parkingToken }  customer    → joins session:<id> (read-only)
 *   { system }        any client  → joins config:<system> for design pushes
 */
export function attachRealtime(http: HttpServer) {
  const io = new Server(http, { cors: { origin: true, credentials: true }, path: '/socket.io' });
  setIo(io);
  io.on('connection', (socket) => {
    const a = (socket.handshake.auth ?? {}) as Record<string, string>;
    const user = userFromToken(a.token);
    const device = deviceFromKey(a.deviceKey);
    if (user) {
      if (!user.merchantId) socket.join('staff');
      for (const s of user.siteIds ?? q.all<{ id: number }>('SELECT id FROM sites').map((r) => r.id)) socket.join(`site:${s}`);
      if (user.merchantId) socket.join(`merchant:${user.merchantId}`);
    }
    if (device) {
      socket.join(`device:${device.id}`);
      if (device.gateId) socket.join(`gate:${device.gateId}`);
      if (device.merchantId) socket.join(`merchant:${device.merchantId}`);
      markDevice(device.id, 'ONLINE');
      socket.on('disconnect', () => {
        // Give the device a short window to reconnect before raising OFFLINE.
        setTimeout(() => {
          const still = [...io.sockets.sockets.values()].some((s) => (s.data as { deviceId?: number }).deviceId === device.id);
          if (!still) markDevice(device.id, 'OFFLINE');
        }, 15_000);
      });
      socket.data.deviceId = device.id;
    }
    if (a.parkingToken) {
      const s = sessionByToken(a.parkingToken);
      if (s) {
        socket.join(`session:${s.id}`);
        socket.emit('session:update', quote(s));
      } else socket.emit('session:invalid', {});
    }
    // Gate kiosks opened by staff (no device key) can watch a gate.
    socket.on('gate:watch', (gateId: number) => {
      if (user || device) socket.join(`gate:${Number(gateId)}`);
    });
    const systems = String(a.system ?? '').split(',').filter(Boolean);
    for (const s of systems) socket.join(`config:${s}`);
    socket.on('config:ack', (p: { versionId: number; system?: string; clientId: string }) => {
      if (!p?.versionId || !p.clientId) return;
      q.run(
        'INSERT OR IGNORE INTO config_deliveries (version_id, client_id, system, device_id) VALUES (?,?,?,?)',
        p.versionId,
        String(p.clientId).slice(0, 80),
        p.system ?? null,
        device?.id ?? null,
      );
    });
    socket.on('heartbeat', (p: { status?: Record<string, string> }) => {
      if (!device) return;
      markDevice(device.id, 'ONLINE');
      // Edge agents report the health of attached hardware (camera/printer/barrier ids).
      for (const [id, st] of Object.entries(p?.status ?? {})) markDevice(Number(id), st === 'ONLINE' ? 'ONLINE' : 'OFFLINE');
    });
  });
  return io;
}

export function markDevice(id: number, status: 'ONLINE' | 'OFFLINE') {
  const d = q.get('SELECT * FROM devices WHERE id=?', id);
  if (!d) return;
  q.run("UPDATE devices SET status=?, last_seen_at=CASE WHEN ?='ONLINE' THEN ? ELSE last_seen_at END WHERE id=?", status, status, nowIso(), id);
  if (d.status !== status) {
    q.insert('device_status_log', { device_id: id, status });
    if (status === 'OFFLINE') {
      raiseAlert({ type: 'DEVICE_OFFLINE', severity: 'CRITICAL', siteId: d.site_id, refType: 'device', refId: id, message: `อุปกรณ์ ${d.name} (${d.type}) ขาดการเชื่อมต่อ`, dedupeKey: `DEVICE:${id}` });
    } else {
      resolveAlerts(`DEVICE:${id}`);
    }
  }
}

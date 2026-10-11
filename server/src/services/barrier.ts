/**
 * Barrier control. A gate's BARRIER device is driven either
 *  - directly by the server (connection.mode = "http": relay boards / IP I/O
 *    controllers exposing an HTTP endpoint, or "tcp": raw command to host:port), or
 *  - through the site edge agent (connection.mode = "edge"), which receives
 *    `barrier:open` over the realtime channel and toggles its local relay /
 *    serial / Modbus controller (see edge/src/adapters/barrier.ts).
 */
import net from 'node:net';
import { q, json, nowIso } from '../db/index.ts';
import { emit } from '../lib/realtime.ts';
import { raiseAlert } from '../lib/alerts.ts';

export interface BarrierConnection {
  mode?: 'http' | 'tcp' | 'edge' | 'none';
  url?: string;          // http: e.g. http://10.0.0.21/relay/0?turn=on&timer=2
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  host?: string;         // tcp
  port?: number;
  payloadHex?: string;   // tcp command bytes
  edgeDeviceId?: number; // edge agent that owns this barrier
}

export async function openBarrier(gateId: number, ctx: { reason: string; sessionId?: number | null; userId?: number | null }) {
  const dev = q.get("SELECT * FROM devices WHERE gate_id=? AND type='BARRIER' AND active=1 ORDER BY id LIMIT 1", gateId);
  const command = { gateId, reason: ctx.reason, sessionId: ctx.sessionId ?? null, at: nowIso(), deviceId: dev?.id ?? null };
  // Always notify the gate room (kiosk animation, edge agents listening on the gate).
  emit.gate(gateId, 'barrier:open', command);
  if (!dev) return { ok: true, mode: 'none' as const };
  const conn = json<BarrierConnection>(dev.connection_json, {});
  try {
    if (conn.mode === 'http' && conn.url) {
      const r = await fetch(conn.url, { method: conn.method ?? 'GET', body: conn.method === 'POST' ? conn.body : undefined, headers: conn.headers, signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } else if (conn.mode === 'tcp' && conn.host && conn.port) {
      await sendTcp(conn.host, conn.port, Buffer.from(conn.payloadHex ?? '', 'hex'));
    } else if (conn.mode === 'edge' || conn.edgeDeviceId) {
      emit.device(conn.edgeDeviceId ?? dev.id, 'barrier:open', command);
    }
    q.run("UPDATE devices SET status='ONLINE', last_seen_at=?, last_error=NULL WHERE id=?", nowIso(), dev.id);
    return { ok: true, mode: conn.mode ?? 'edge' };
  } catch (e) {
    const msg = (e as Error).message;
    q.run("UPDATE devices SET status='ERROR', last_error=? WHERE id=?", msg, dev.id);
    raiseAlert({ type: 'DEVICE_OFFLINE', severity: 'CRITICAL', siteId: dev.site_id, refType: 'device', refId: dev.id, message: `ไม้กั้น ${dev.name} สั่งงานไม่สำเร็จ: ${msg}`, dedupeKey: `DEVICE:${dev.id}` });
    return { ok: false, error: msg };
  }
}

export function sendTcp(host: string, port: number, data: Uint8Array, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    const t = setTimeout(() => {
      sock.destroy();
      reject(new Error('TCP timeout'));
    }, timeoutMs);
    sock.on('connect', () => {
      sock.write(data, () => {
        sock.end();
      });
    });
    sock.on('close', () => {
      clearTimeout(t);
      resolve();
    });
    sock.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

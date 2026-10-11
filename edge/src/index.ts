/**
 * Site edge agent.
 *  - Printer Bridge on http://127.0.0.1:9110 (kiosk browsers POST ESC/POS bytes)
 *  - Executes `barrier:open` and `printer:job` commands pushed by the server
 *  - Captures frames from RTSP/ONVIF/HTTP cameras on trigger, runs OCR, posts candidates
 *  - Keeps gates working offline: durable local queue + cached sessions, then
 *    replays to /api/edge/sync (idempotent) when the connection returns.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { io } from 'socket.io-client';
import { plateKey, parsePlateText } from '@pp/shared';
import { cfg } from './config.ts';
import { ack, count, enqueue, fail, kvGet, kvSet, nextLocalSeq, pending } from './queue.ts';
import { writeRaw, type PrinterConn } from './adapters/printer.ts';
import { pulse, type BarrierConn } from './adapters/barrier.ts';
import { grabFrame, recognise } from './adapters/camera.ts';

let online = false;
const headers = { 'Content-Type': 'application/json', 'X-Device-Key': cfg.deviceKey };

async function call(path: string, body?: unknown) {
  const r = await fetch(cfg.serverUrl + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status} ${await r.text()}`);
  return r.json() as Promise<any>;
}

// ---------------------------------------------------------------- cache ---
interface Cache {
  sessions: Array<{ parkingNo: string; plateKey: string | null; tokenHash: string; paid: boolean; exitDeadlineAt: string | null }>;
  devices: Array<{ id: number; type: string; gate_id: number | null; connection: any; settings: any }>;
  gates: Array<{ id: number; direction: string }>;
  lists: Array<{ plate_key: string; list_type: string }>;
  passes: Array<{ plate_key: string; ticketless: number }>;
  offlineExitPolicy: 'DENY' | 'ALLOW_PAID_CACHE' | 'ALLOW_ALL';
}
let cache: Cache = kvGet<Cache>('cache', { sessions: [], devices: [], gates: [], lists: [], passes: [], offlineExitPolicy: 'ALLOW_PAID_CACHE' });

async function refreshCache() {
  try {
    cache = await call('/api/edge/cache');
    kvSet('cache', cache);
  } catch (e) {
    console.warn('cache refresh failed:', (e as Error).message);
  }
}

const deviceFor = (gateId: number, type: string) => cache.devices.find((d) => d.gate_id === gateId && d.type === type);

// --------------------------------------------------------------- hardware ---
async function openBarrier(gateId: number, reason: string) {
  const dev = deviceFor(gateId, 'BARRIER');
  if (!dev) return console.warn(`no barrier configured for gate ${gateId}`);
  await pulse(dev.connection as BarrierConn);
  console.log(`barrier ${dev.id} opened (${reason})`);
}

async function printBytes(data: Buffer, conn?: PrinterConn) {
  const c: PrinterConn = conn ?? { host: process.env.PRINTER_HOST, port: Number(process.env.PRINTER_PORT ?? 9100), usbPath: process.env.PRINTER_DEVICE };
  await writeRaw(c, data);
}

/** Minimal offline ticket using printer-native text + QR (GS ( k). */
function offlineTicket(parkingNo: string, plate: string | null, url: string) {
  const b: number[] = [0x1b, 0x40, 0x1b, 0x61, 1];
  const text = (s: string) => b.push(...Buffer.from(s.replace(/[^\x20-\x7e]/g, '?') + '\n', 'ascii'));
  text('SMART PARKING');
  text('PARKING ENTRY TICKET (OFFLINE)');
  text(parkingNo);
  if (plate) text(plate.replace(/[^\x20-\x7e]/g, '') || '');
  text(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' }));
  const d = Buffer.from(url);
  const len = d.length + 3;
  b.push(0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00); // model 2
  b.push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 8); // module size
  b.push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31); // EC level M
  b.push(0x1d, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...d);
  b.push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);
  b.push(0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0);
  return Buffer.from(b);
}

// ---------------------------------------------------------------- cameras ---
async function handleTrigger(cameraId: number) {
  const cam = cache.devices.find((d) => d.id === cameraId && d.type === 'CAMERA');
  if (!cam?.gate_id) throw new Error('unknown camera');
  const frame = await grabFrame(cam.connection);
  const candidates = await recognise(frame);
  const image = frame.toString('base64');
  if (online) {
    return call('/api/lpr/events', { gateId: cam.gate_id, cameraId, image, candidates, eventId: crypto.randomUUID() });
  }
  return offlineDecision(cam.gate_id, cameraId, candidates);
}

/** Offline gate logic — conservative, everything is replayed to the server later. */
async function offlineDecision(gateId: number, cameraId: number, candidates: any[]) {
  enqueue('DETECTION', gateId, { cameraId, candidates });
  const best = candidates.map((c) => ({ c, p: parsePlateText(c.plate ? `${c.plate} ${c.province ?? ''}` : (c.text ?? '')) })).find((x) => x.p);
  const gate = cache.gates.find((g) => g.id === gateId);
  const key = best?.p ? plateKey(best.p.prefix, best.p.number, null) : null;
  if (gate?.direction === 'ENTRY') {
    if (key && cache.lists.some((l) => l.list_type === 'BLACKLIST' && l.plate_key.startsWith(key.slice(0, -1)))) return { decision: 'DENY_BLACKLIST' };
    const token = crypto.randomBytes(24).toString('base64url');
    const day = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
    const parkingNo = `PK${day}E${String(nextLocalSeq(day)).padStart(4, '0')}`;
    const plate = best?.p ? { prefix: best.p.prefix, number: best.p.number, provinceCode: null, key, source: best.c.sourceType } : null;
    enqueue('ENTRY', gateId, { plate, token, parkingNo });
    await printBytes(offlineTicket(parkingNo, plate ? `${plate.prefix} ${plate.number}` : null, `${cfg.serverUrl}/p/${token}`)).catch((e) => console.error('print failed', e.message));
    await openBarrier(gateId, 'OFFLINE_ENTRY');
    return { decision: 'OFFLINE_TICKET', parkingNo };
  }
  const s = key ? cache.sessions.find((x) => x.plateKey?.startsWith(key.slice(0, -1))) : undefined;
  const allowed =
    cache.offlineExitPolicy === 'ALLOW_ALL' ||
    (cache.offlineExitPolicy === 'ALLOW_PAID_CACHE' && s?.paid && (!s.exitDeadlineAt || s.exitDeadlineAt > new Date().toISOString()));
  if (allowed) {
    enqueue('EXIT', gateId, { parkingNo: s?.parkingNo, plateKey: s?.plateKey });
    await openBarrier(gateId, 'OFFLINE_EXIT');
    return { decision: 'OFFLINE_EXIT_OPEN' };
  }
  return { decision: 'OFFLINE_CALL_STAFF' };
}

// ------------------------------------------------------------------- sync ---
async function flush() {
  const batch = pending(200);
  if (!batch.length) return;
  try {
    const r = await call('/api/edge/sync', { events: batch });
    for (const res of r.results) res.ok === false && res.error !== 'SESSION_NOT_FOUND' ? fail(res.id, res.error) : ack(res.id);
    console.log(`synced ${batch.length} events, ${count()} remaining`);
  } catch (e) {
    console.warn('sync failed:', (e as Error).message);
  }
}

// ------------------------------------------------------------------ socket --
const socket = io(cfg.serverUrl, { path: '/socket.io', transports: ['websocket', 'polling'], auth: { deviceKey: cfg.deviceKey } });
socket.on('connect', async () => {
  online = true;
  console.log('connected to server');
  await refreshCache();
  await flush();
});
socket.on('disconnect', () => {
  online = false;
  console.warn('server connection lost — offline mode');
});
socket.on('barrier:open', (cmd: { gateId: number; reason: string }) => openBarrier(cmd.gateId, cmd.reason).catch((e) => console.error('barrier failed', e.message)));
socket.on('printer:job', (job: { data: string; connection: PrinterConn }) => printBytes(Buffer.from(job.data, 'base64'), job.connection).catch((e) => console.error('print job failed', e.message)));

setInterval(() => {
  if (!online) return;
  const status: Record<string, string> = {};
  socket.emit('heartbeat', { status, queue: count() });
  flush();
}, 30_000);
setInterval(() => online && refreshCache(), cfg.cacheRefreshSeconds * 1000);
if (cfg.pollSeconds > 0) {
  setInterval(() => {
    for (const cam of cache.devices.filter((d) => d.type === 'CAMERA' && d.connection?.edgeDeviceId)) handleTrigger(cam.id).catch(() => undefined);
  }, cfg.pollSeconds * 1000);
}

// ------------------------------------------------------- local HTTP bridge --
http
  .createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.end();
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, online, queue: count() });
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      if (req.method === 'POST' && req.url === '/print') {
        await printBytes(Buffer.from(body.data, 'base64'), body.connection);
        return send(200, { ok: true });
      }
      const m = req.url?.match(/^\/trigger\/(\d+)$/); // loop detector / IO input
      if (req.method === 'POST' && m) return send(200, await handleTrigger(Number(m[1])));
      send(404, { error: 'NOT_FOUND' });
    } catch (e) {
      send(500, { error: (e as Error).message });
    }
  })
  .listen(cfg.bridgePort, '127.0.0.1', () => console.log(`printer bridge on http://127.0.0.1:${cfg.bridgePort}`));

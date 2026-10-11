/**
 * Thermal printer output. Clients render tickets/receipts to an ESC/POS raster
 * (bitmap — keeps Thai/custom fonts identical to the preview) and post the
 * bytes here. Delivery by printer connection:
 *   lan  — server opens TCP host:9100 (RAW / JetDirect)
 *   edge — relayed to the site edge agent, which writes to USB (/dev/usb/lp*),
 *          serial/Bluetooth SPP, or a LAN printer the server cannot reach
 *   bridge — client prints locally through the Printer Bridge (edge agent on
 *          the kiosk PC at http://127.0.0.1:9110); server only logs
 */
import { q, json, nowIso } from '../db/index.ts';
import { emit } from '../lib/realtime.ts';
import { HttpError, notFound } from '../lib/http.ts';
import { raiseAlert } from '../lib/alerts.ts';
import { sendTcp } from './barrier.ts';

export interface PrinterConnection {
  mode?: 'lan' | 'edge' | 'bridge';
  host?: string;
  port?: number;
  edgeDeviceId?: number;
  usbPath?: string;      // used by edge agent
  bluetoothAddress?: string;
  bridgeUrl?: string;    // e.g. http://127.0.0.1:9110
  paperWidth?: '58' | '80';
}

export async function printRaw(printerId: number, data: Buffer, meta: { job: string; ref?: string }) {
  const dev = q.get("SELECT * FROM devices WHERE id=? AND type='PRINTER'", printerId);
  if (!dev) throw notFound('PRINTER_NOT_FOUND');
  const conn = json<PrinterConnection>(dev.connection_json, {});
  try {
    if (conn.mode === 'lan' && conn.host) {
      await sendTcp(conn.host, conn.port ?? 9100, data);
    } else if (conn.mode === 'edge' || conn.edgeDeviceId) {
      emit.device(conn.edgeDeviceId ?? dev.id, 'printer:job', { printerId, job: meta.job, ref: meta.ref, connection: conn, data: data.toString('base64') });
    } else {
      throw new HttpError(400, 'PRINT_VIA_BRIDGE', 'this printer is attached to a client bridge');
    }
    q.run("UPDATE devices SET status='ONLINE', last_seen_at=?, last_error=NULL WHERE id=?", nowIso(), dev.id);
    return { ok: true };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const msg = (e as Error).message;
    q.run("UPDATE devices SET status='ERROR', last_error=? WHERE id=?", msg, dev.id);
    raiseAlert({ type: 'DEVICE_OFFLINE', severity: 'CRITICAL', siteId: dev.site_id, refType: 'device', refId: dev.id, message: `เครื่องพิมพ์ ${dev.name} ขัดข้อง: ${msg}`, dedupeKey: `DEVICE:${dev.id}` });
    throw new HttpError(502, 'PRINTER_ERROR', msg);
  }
}

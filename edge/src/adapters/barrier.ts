/**
 * Barrier controllers: HTTP relay boards (Shelly / IP I/O), raw TCP command,
 * serial relay (e.g. USB relay "A0 01 01 A2"), or Linux GPIO sysfs pulse.
 */
import fs from 'node:fs';
import net from 'node:net';

export interface BarrierConn {
  mode?: string;
  url?: string;
  method?: 'GET' | 'POST';
  host?: string;
  port?: number;
  payloadHex?: string;
  serialPath?: string;
  gpio?: number;
  pulseMs?: number;
}

export async function pulse(c: BarrierConn) {
  if (c.url) {
    const r = await fetch(c.url, { method: c.method ?? 'GET', signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`relay HTTP ${r.status}`);
    return;
  }
  if (c.host && c.port) {
    await new Promise<void>((res, rej) => {
      const s = net.createConnection({ host: c.host!, port: c.port! }, () => s.end(Buffer.from(c.payloadHex ?? '', 'hex')));
      s.on('close', () => res());
      s.on('error', rej);
    });
    return;
  }
  if (c.serialPath) {
    await fs.promises.writeFile(c.serialPath, Buffer.from(c.payloadHex ?? 'A00101A2', 'hex'));
    return;
  }
  if (c.gpio != null) {
    const p = `/sys/class/gpio/gpio${c.gpio}/value`;
    await fs.promises.writeFile(p, '1');
    await new Promise((r) => setTimeout(r, c.pulseMs ?? 500));
    await fs.promises.writeFile(p, '0');
    return;
  }
  throw new Error('barrier connection not configured');
}

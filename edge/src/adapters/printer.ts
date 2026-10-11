/**
 * Raw printer output: LAN (RAW/9100), USB character device (/dev/usb/lp0),
 * serial / Bluetooth SPP device file (/dev/rfcomm0, /dev/ttyUSB0).
 */
import fs from 'node:fs';
import net from 'node:net';

export interface PrinterConn {
  mode?: string;
  host?: string;
  port?: number;
  usbPath?: string;
  serialPath?: string;
  bluetoothPath?: string;
}

export async function writeRaw(conn: PrinterConn, data: Buffer) {
  if (conn.host) return tcp(conn.host, conn.port ?? 9100, data);
  const dev = conn.usbPath ?? conn.serialPath ?? conn.bluetoothPath ?? process.env.PRINTER_DEVICE ?? '/dev/usb/lp0';
  await fs.promises.writeFile(dev, data);
}

function tcp(host: string, port: number, data: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const s = net.createConnection({ host, port });
    const t = setTimeout(() => (s.destroy(), reject(new Error('printer timeout'))), 5000);
    s.on('connect', () => s.end(data));
    s.on('close', () => (clearTimeout(t), resolve()));
    s.on('error', (e) => (clearTimeout(t), reject(e)));
  });
}

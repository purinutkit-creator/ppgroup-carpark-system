/**
 * Printers attached directly to this computer, driven from the browser:
 *   - WebUSB  : USB thermal printers (ESC/POS) — "ค้นหาเครื่องพิมพ์" opens the browser chooser
 *   - Web Serial: USB-serial / Bluetooth-SPP printers
 *   - browser : OS print dialog (any printer with an installed driver)
 * The selection is remembered per computer (localStorage) and, once chosen,
 * every ticket / receipt on this computer prints to it.
 * Chrome / Edge only for WebUSB & Web Serial; page must be https or localhost.
 */
import { storage } from '../lib/api';

export type LocalPrinterKind = 'webusb' | 'webserial' | 'browser';

export interface LocalPrinter {
  kind: LocalPrinterKind;
  name: string;
  paperWidth: '58' | '80';
  vendorId?: number;
  productId?: number;
  serialNumber?: string | null;
  baudRate?: number;
  usbVendorId?: number; // serial port info
  usbProductId?: number;
}

const KEY = 'pp.localPrinter';

export function getLocalPrinter(): LocalPrinter | null {
  try {
    return JSON.parse(storage.get(KEY) ?? 'null');
  } catch {
    return null;
  }
}
export function setLocalPrinter(p: LocalPrinter | null) {
  storage.set(KEY, p ? JSON.stringify(p) : null);
}

const nav = navigator as any;
export const supportsUsb = () => !!nav.usb;
export const supportsSerial = () => !!nav.serial;

// ------------------------------------------------------------------ WebUSB --

function describe(d: any) {
  return [d.manufacturerName, d.productName].filter(Boolean).join(' ') || `USB ${d.vendorId.toString(16)}:${d.productId.toString(16)}`;
}

/** Opens the browser's device chooser. Printer-class devices are listed first; any USB device may be picked. */
export async function findUsbPrinter(paperWidth: '58' | '80' = '80'): Promise<LocalPrinter> {
  if (!supportsUsb()) throw new Error('เบราว์เซอร์นี้ไม่รองรับ WebUSB — ใช้ Google Chrome หรือ Microsoft Edge');
  const d = await nav.usb.requestDevice({ filters: [] });
  const p: LocalPrinter = { kind: 'webusb', name: describe(d), paperWidth, vendorId: d.vendorId, productId: d.productId, serialNumber: d.serialNumber ?? null };
  setLocalPrinter(p);
  return p;
}

/** USB devices this site was already allowed to use (no chooser needed). */
export async function authorizedUsbDevices(): Promise<Array<{ name: string; vendorId: number; productId: number; serialNumber: string | null }>> {
  if (!supportsUsb()) return [];
  const list = await nav.usb.getDevices();
  return list.map((d: any) => ({ name: describe(d), vendorId: d.vendorId, productId: d.productId, serialNumber: d.serialNumber ?? null }));
}

async function openUsb(p: LocalPrinter) {
  const list = await nav.usb.getDevices();
  const d = list.find((x: any) => x.vendorId === p.vendorId && x.productId === p.productId && (!p.serialNumber || x.serialNumber === p.serialNumber));
  if (!d) throw new Error('ไม่พบเครื่องพิมพ์ USB ที่เลือกไว้ — ตรวจสอบสาย USB แล้วกด "ค้นหาเครื่องพิมพ์" อีกครั้ง');
  if (!d.opened) await d.open();
  if (d.configuration === null) await d.selectConfiguration(1);
  // Find an interface with a bulk OUT endpoint (printer class 7 preferred).
  const ifaces = d.configuration.interfaces as any[];
  const pick =
    ifaces.find((i) => i.alternates.some((a: any) => a.interfaceClass === 7 && a.endpoints.some((e: any) => e.direction === 'out'))) ??
    ifaces.find((i) => i.alternates.some((a: any) => a.endpoints.some((e: any) => e.direction === 'out' && e.type === 'bulk')));
  if (!pick) throw new Error('อุปกรณ์นี้ไม่ใช่เครื่องพิมพ์ (ไม่มีช่องส่งข้อมูล)');
  const alt = pick.alternates.find((a: any) => a.endpoints.some((e: any) => e.direction === 'out')) ?? pick.alternates[0];
  if (!pick.claimed) {
    try {
      await d.claimInterface(pick.interfaceNumber);
    } catch (e) {
      throw new Error(
        `เบราว์เซอร์เข้าถึงเครื่องพิมพ์ไม่ได้ (${(e as Error).message}). บน Windows ต้องเปลี่ยนไดรเวอร์เป็น WinUSB (เช่นด้วยโปรแกรม Zadig) หรือเลือกโหมด "หน้าต่างพิมพ์ของระบบ"`,
      );
    }
  }
  if (alt.alternateSetting) await d.selectAlternateInterface(pick.interfaceNumber, alt.alternateSetting);
  const ep = alt.endpoints.find((e: any) => e.direction === 'out');
  return { d, ep: ep.endpointNumber as number };
}

async function writeUsb(p: LocalPrinter, data: Uint8Array) {
  const { d, ep } = await openUsb(p);
  for (let i = 0; i < data.length; i += 16384) {
    const r = await d.transferOut(ep, data.subarray(i, i + 16384));
    if (r.status !== 'ok') throw new Error(`USB transfer ${r.status}`);
  }
}

// ------------------------------------------------------------- Web Serial --

export async function findSerialPrinter(paperWidth: '58' | '80' = '80', baudRate = 9600): Promise<LocalPrinter> {
  if (!supportsSerial()) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Serial — ใช้ Chrome หรือ Edge');
  const port = await nav.serial.requestPort();
  const info = port.getInfo?.() ?? {};
  const p: LocalPrinter = { kind: 'webserial', name: `Serial ${info.usbVendorId ? info.usbVendorId.toString(16) + ':' + (info.usbProductId ?? 0).toString(16) : 'port'}`, paperWidth, baudRate, usbVendorId: info.usbVendorId, usbProductId: info.usbProductId };
  setLocalPrinter(p);
  return p;
}

async function writeSerial(p: LocalPrinter, data: Uint8Array) {
  const ports = await nav.serial.getPorts();
  const port = ports.find((x: any) => {
    const i = x.getInfo?.() ?? {};
    return !p.usbVendorId || (i.usbVendorId === p.usbVendorId && i.usbProductId === p.usbProductId);
  });
  if (!port) throw new Error('ไม่พบพอร์ตเครื่องพิมพ์ที่เลือกไว้ — กด "ค้นหาเครื่องพิมพ์" อีกครั้ง');
  if (!port.writable) await port.open({ baudRate: p.baudRate ?? 9600 });
  const w = port.writable.getWriter();
  try {
    await w.write(data);
  } finally {
    w.releaseLock();
  }
}

/** Send raw ESC/POS bytes to the printer chosen on this computer. */
export async function writeLocal(p: LocalPrinter, data: Uint8Array) {
  if (p.kind === 'webusb') return writeUsb(p, data);
  if (p.kind === 'webserial') return writeSerial(p, data);
  throw new Error('browser mode prints through the dialog');
}

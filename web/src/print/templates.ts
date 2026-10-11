/**
 * Print document builders shared by kiosks, counters and admin template
 * previews. Element paths map to the design registry so typography set in
 * Appearance → Print Fonts applies to the printout.
 */
import type { PrintBlock, PrintDoc } from './print';
import { date, money, time } from '../lib/format';

export interface TicketData {
  paperWidth: '58' | '80';
  title: string;
  subtitle: string;
  logoUrl?: string;
  plate: string | null;
  province: string | null;
  parkingNo: string;
  entryAt: string;
  freeTime: string | null;
  rateText: string | null;
  qrUrl: string;
  qrCount: number;
  qrSize: number;
  footerText: string;
  extraLines?: string[];
  fontScale?: number;
}

export function ticketDoc(t: TicketData): PrintDoc {
  const b: PrintBlock[] = [];
  if (t.logoUrl) b.push({ type: 'image', url: t.logoUrl, width: 180 });
  b.push({ type: 'text', text: t.title, el: 'parking-ticket/ticket/header/title' });
  b.push({ type: 'text', text: t.subtitle, el: 'parking-ticket/ticket/header/subtitle' });
  b.push({ type: 'line' });
  b.push({ type: 'text', text: t.plate ?? 'ไม่ระบุทะเบียน', el: 'parking-ticket/ticket/vehicle/plate' });
  if (t.province) b.push({ type: 'text', text: t.province, el: 'parking-ticket/ticket/vehicle/province' });
  b.push({ type: 'space', height: 6 });
  b.push({ type: 'row', left: 'หมายเลขบัตร', right: t.parkingNo, el: 'parking-ticket/ticket/info/row' });
  b.push({ type: 'row', left: 'วันที่เข้า', right: date(t.entryAt), el: 'parking-ticket/ticket/info/row' });
  b.push({ type: 'row', left: 'เวลาเข้า', right: `${time(t.entryAt)} น.`, el: 'parking-ticket/ticket/info/row' });
  if (t.freeTime) b.push({ type: 'row', left: 'จอดฟรี', right: t.freeTime, el: 'parking-ticket/ticket/info/row' });
  if (t.rateText) b.push({ type: 'row', left: 'อัตราค่าจอด', right: t.rateText, el: 'parking-ticket/ticket/info/row' });
  for (const l of t.extraLines ?? []) b.push({ type: 'text', text: l, el: 'parking-ticket/ticket/info/row' });
  b.push({ type: 'line', dashed: true });
  const n = Math.max(1, Math.min(3, t.qrCount || 1));
  for (let i = 0; i < n; i++) {
    b.push({ type: 'qr', data: t.qrUrl, size: t.qrSize || 240, caption: i === n - 1 ? t.footerText : undefined });
    if (i < n - 1) b.push({ type: 'line', dashed: true });
  }
  return { paperWidth: t.paperWidth, blocks: b, fontScale: t.fontScale ?? 1.5, cut: true };
}

export interface ParkingReceiptData {
  paperWidth: '58' | '80';
  companyName: string;
  companyTaxId?: string;
  companyAddress?: string;
  header: string;
  footer: string;
  docNo?: string | null;
  parkingNo: string;
  plate: string | null;
  province: string | null;
  entryAt: string;
  paidAt: string;
  durationText: string;
  gross: number;
  discount: number;
  amount: number;
  method: string;
  vatRate?: number;
  showVat?: boolean;
  exitBefore?: string | null;
}

export function parkingReceiptDoc(r: ParkingReceiptData): PrintDoc {
  const b: PrintBlock[] = [
    { type: 'text', text: r.companyName, el: 'receipt/parking/header/title' },
    ...(r.companyTaxId ? [{ type: 'text', text: `เลขประจำตัวผู้เสียภาษี ${r.companyTaxId}`, align: 'center', size: 13 } as PrintBlock] : []),
    ...(r.companyAddress ? [{ type: 'text', text: r.companyAddress, align: 'center', size: 13 } as PrintBlock] : []),
    { type: 'text', text: r.header, el: 'receipt/parking/header/title', size: 18 },
    { type: 'line' },
  ];
  if (r.docNo) b.push({ type: 'row', left: 'เลขที่', right: r.docNo, size: 14 });
  b.push(
    { type: 'row', left: 'Parking ID', right: r.parkingNo, size: 14 },
    { type: 'row', left: 'ทะเบียน', right: `${r.plate ?? '-'} ${r.province ?? ''}`.trim(), size: 14 },
    { type: 'row', left: 'เวลาเข้า', right: `${date(r.entryAt)} ${time(r.entryAt)}`, size: 14 },
    { type: 'row', left: 'เวลาชำระ', right: `${date(r.paidAt)} ${time(r.paidAt)}`, size: 14 },
    { type: 'row', left: 'ระยะเวลาจอด', right: r.durationText, size: 14 },
    { type: 'line', dashed: true },
    { type: 'row', left: 'ค่าจอดรถ', right: money(r.gross), size: 15 },
    { type: 'row', left: 'ส่วนลด', right: `-${money(r.discount)}`, size: 15 },
    { type: 'row', left: 'ยอดชำระ', right: money(r.amount), el: 'receipt/parking/totals/total' },
    { type: 'row', left: 'ชำระโดย', right: r.method, size: 14 },
  );
  if (r.showVat && r.vatRate) {
    const vat = Math.round(((r.amount * r.vatRate) / (100 + r.vatRate)) * 100) / 100;
    b.push({ type: 'row', left: `VAT ${r.vatRate}% (รวมในราคา)`, right: money(vat), size: 13 });
  }
  if (r.exitBefore) b.push({ type: 'space' }, { type: 'text', text: `กรุณานำรถออกก่อน ${time(r.exitBefore)} น.`, align: 'center', weight: 700, size: 18, invert: true });
  b.push({ type: 'line' }, { type: 'text', text: r.footer, el: 'receipt/pos/footer/text' });
  return { paperWidth: r.paperWidth, blocks: b, cut: true };
}

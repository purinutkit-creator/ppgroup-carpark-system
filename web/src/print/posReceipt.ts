/**
 * Merchant POS receipt: store header → items → totals → payments → PARKING
 * VALIDATION section (QR of the PV1 reference + Code128 of the receipt no).
 * The barcode carries only a reference; the information counter reads the
 * amount and refund state from the server.
 */
import type { DesignConfig } from '@pp/shared/design/index';
import type { PrintBlock, PrintDoc, PrinterTarget } from './print';
import { printDoc } from './print';
import { date, money, num, time } from '../lib/format';
import type { ReceiptData } from '../components/pos/types';

const PAY: Record<string, string> = { CASH: 'เงินสด', PROMPTPAY: 'PromptPay', CARD: 'บัตร', TRANSFER: 'โอนเงิน', EWALLET: 'e-Wallet', EXTERNAL: 'POS ภายนอก' };
const amt = (n: number) => num(n, 2);

export interface PosReceiptOptions {
  paperWidth?: '58' | '80';
  reprint?: boolean;
  openDrawer?: boolean;
  fontScale?: number;
}

export function posReceiptDoc(r: ReceiptData, opts: PosReceiptOptions = {}): PrintDoc {
  const b: PrintBlock[] = [];
  if (r.store.logoUrl) b.push({ type: 'image', url: r.store.logoUrl, width: 160 });
  b.push({ type: 'text', text: r.store.name, el: 'receipt/pos/header/store' });
  if (r.store.header && r.store.header !== r.store.name) b.push({ type: 'text', text: r.store.header, el: 'receipt/pos/header/info' });
  b.push({ type: 'text', text: `สาขา ${r.store.branchName} (${r.store.branchCode})${r.store.unitNo ? ` · ห้อง ${r.store.unitNo}` : ''}`, el: 'receipt/pos/header/info' });
  if (r.store.vatRegistered && r.store.taxId) {
    b.push({ type: 'text', text: `เลขประจำตัวผู้เสียภาษี ${r.store.taxId}`, el: 'receipt/pos/header/info' });
    b.push({ type: 'text', text: 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ', el: 'receipt/pos/header/info' });
  } else b.push({ type: 'text', text: 'ใบเสร็จรับเงิน', el: 'receipt/pos/header/info' });
  if (opts.reprint || r.reprintCount > 0) b.push({ type: 'text', text: `*** สำเนา (REPRINT${r.reprintCount ? ` #${r.reprintCount}` : ''}) ***`, align: 'center', weight: 700 });
  if (r.status === 'VOIDED') b.push({ type: 'text', text: '*** ยกเลิกแล้ว (VOID) ***', align: 'center', weight: 700, invert: true });
  b.push({ type: 'line' });
  b.push({ type: 'row', left: 'เลขที่', right: r.receiptNo, el: 'receipt/pos/header/receiptNo' });
  b.push({ type: 'row', left: 'วันที่', right: `${date(r.issuedAt)} ${time(r.issuedAt)}`, el: 'receipt/pos/header/date' });
  if (r.cashier) b.push({ type: 'row', left: 'พนักงาน', right: r.cashier, el: 'receipt/pos/header/date' });
  if (r.memberPhone) b.push({ type: 'row', left: 'สมาชิก', right: r.memberPhone.replace(/^(\d{3})\d+(\d{3})$/, '$1xxxx$2'), el: 'receipt/pos/header/date' });
  b.push({ type: 'line', dashed: true });
  for (const l of r.items) {
    b.push({ type: 'row', left: `${l.name} x${num(l.qty)}`, right: amt(l.gross), el: 'receipt/pos/items/name' });
    const meta = [l.variant, ...l.modifiers.map((m) => m.name)].filter(Boolean).join(' · ');
    if (meta) b.push({ type: 'text', text: `  ${meta}  @${amt(l.unitPrice)}`, el: 'receipt/pos/items/meta' });
    if (l.discount > 0) b.push({ type: 'row', left: '  ส่วนลดรายการ', right: `-${amt(l.discount)}`, el: 'receipt/pos/items/meta' });
  }
  b.push({ type: 'line', dashed: true });
  b.push({ type: 'row', left: 'รวม', right: amt(r.subtotal), el: 'receipt/pos/totals/row' });
  if (r.discount > 0) b.push({ type: 'row', left: 'ส่วนลด', right: `-${amt(r.discount)}`, el: 'receipt/pos/totals/row' });
  if (r.serviceCharge > 0) b.push({ type: 'row', left: 'ค่าบริการ', right: amt(r.serviceCharge), el: 'receipt/pos/totals/row' });
  if (r.vat > 0) b.push({ type: 'row', left: r.vatMode === 'EXCLUDED' ? `VAT ${r.vatRate}%` : `VAT ${r.vatRate}% (รวมในราคา)`, right: amt(r.vat), el: 'receipt/pos/totals/row' });
  b.push({ type: 'row', left: 'ยอดสุทธิ', right: money(r.total), el: 'receipt/pos/totals/total' });
  for (const p of r.payments) b.push({ type: 'row', left: `${PAY[p.method] ?? p.method}${p.ref ? ` (${p.ref})` : ''}`, right: amt(p.amount), el: 'receipt/pos/payments/row' });
  if (r.change > 0) b.push({ type: 'row', left: 'เงินทอน', right: amt(r.change), el: 'receipt/pos/payments/row' });
  if (r.refundedAmount > 0) b.push({ type: 'row', left: 'คืนเงินแล้ว', right: `-${amt(r.refundedAmount)}`, el: 'receipt/pos/payments/row' });

  if (r.parking && r.status !== 'VOIDED') {
    b.push({ type: 'space', height: 8 }, { type: 'line' });
    b.push({ type: 'text', text: 'PARKING VALIDATION', el: 'receipt/pos/parking/title' });
    b.push({ type: 'text', text: `Receipt ID: ${r.parking.receiptNo}`, el: 'receipt/pos/parking/receiptId' });
    b.push({ type: 'qr', data: r.parking.payload, size: 220 });
    b.push({ type: 'barcode', data: r.parking.receiptNo, height: 70 });
    b.push({ type: 'text', text: `ยอดซื้อที่ใช้คำนวณสิทธิ์ ${money(r.parking.eligibleAmount)}`, el: 'receipt/pos/parking/amount' });
    b.push({ type: 'text', text: 'นำใบเสร็จไปแสดงที่ประชาสัมพันธ์ เพื่อรับสิทธิ์ส่วนลดค่าจอดรถ', el: 'receipt/pos/promo/text' });
    b.push({ type: 'line' });
  }
  b.push({ type: 'space', height: 6 }, { type: 'text', text: r.store.footer, el: 'receipt/pos/footer/text' });
  return { paperWidth: opts.paperWidth ?? '80', blocks: b, cut: true, openDrawer: opts.openDrawer, fontScale: opts.fontScale ?? 1.5 };
}

/** Print through the POS device's printer (bridge / server) or fall back to the browser dialog. */
export function printPosReceipt(r: ReceiptData, design: DesignConfig | null, printer: PrinterTarget | null | undefined, opts: PosReceiptOptions = {}) {
  const doc = posReceiptDoc(r, { paperWidth: printer?.connection?.paperWidth ?? opts.paperWidth, ...opts });
  return printDoc(doc, design, printer ?? null, { job: 'pos-receipt', ref: r.receiptNo });
}

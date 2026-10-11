/** Print the parking receipt for a paid session (payment kiosk / counter). */
import type { DesignConfig } from '@pp/shared/design/index';
import { get } from '../../lib/api';
import { durationText } from '../../lib/format';
import { printDoc, type PrinterTarget } from '../../print/print';
import { parkingReceiptDoc } from '../../print/templates';
import type { Payment, Quote, ReceiptTemplate, SessionSummary } from './types';

export const METHOD_TEXT: Record<string, string> = { PROMPTPAY: 'PromptPay', CARD: 'บัตรเครดิต/เดบิต', CASH: 'เงินสด', EWALLET: 'e-Wallet' };

export async function printParkingReceipt(sessionId: number, design: DesignConfig | null, printer: PrinterTarget | null, opts: { device?: boolean } = {}) {
  const r = await get<{ session: SessionSummary; payment: Payment; quote: Quote; template: ReceiptTemplate }>(`/api/kiosk/sessions/${sessionId}/receipt`, { device: opts.device });
  const { session: s, payment: p, quote: q, template: tpl } = r;
  const doc = parkingReceiptDoc({
    paperWidth: tpl.paperWidth,
    companyName: tpl.companyName,
    companyTaxId: tpl.companyTaxId,
    companyAddress: tpl.companyAddress,
    header: tpl.header,
    footer: tpl.footer,
    docNo: null,
    parkingNo: s.parkingNo,
    plate: s.plateText,
    province: s.province,
    entryAt: s.entryAt,
    paidAt: p.paidAt ?? p.createdAt,
    durationText: durationText(Math.max(0, (new Date(p.paidAt ?? q.now).getTime() - new Date(s.entryAt).getTime()) / 1000)),
    gross: q.gross,
    discount: q.discountTotal,
    amount: p.amount,
    method: METHOD_TEXT[p.method] ?? p.method,
    vatRate: tpl.vatRate,
    showVat: tpl.showVat,
    exitBefore: q.exitDeadlineAt,
  });
  return printDoc(doc, design, printer, { device: opts.device, job: 'parking-receipt', ref: s.parkingNo });
}

/** Validation slip printed at the counter after applying receipts (Appearance → Print Templates → validation). */
import type { PrintBlock, PrintDoc } from '../../../print/print';
import { dateTime, money } from '../../../lib/format';
import { rewardText } from '../receiptReasons';
import type { ExternalReceipt, Quote, ValidationPreview } from '../types';

export function validationSlipDoc(opts: { preview: ValidationPreview; after: Quote; external: ExternalReceipt[]; counter: string; paperWidth?: '58' | '80'; footer?: string }): PrintDoc {
  const { preview: p, after } = opts;
  const row = (left: string, right: string): PrintBlock => ({ type: 'row', left, right, el: 'print-templates/validation/body/row' });
  const b: PrintBlock[] = [
    { type: 'text', text: 'PARKING VALIDATION', el: 'print-templates/validation/header/title' },
    { type: 'line' },
    row('Parking ID', after.parkingNo),
    row('ทะเบียน', `${after.plate.text ?? '-'} ${after.plate.province ?? ''}`.trim()),
    row('เวลาเข้า', dateTime(after.entryAt)),
    row('เวลาตรวจ', dateTime(new Date().toISOString())),
    { type: 'line', dashed: true },
  ];
  for (const r of p.receipts.filter((x) => x.ok && x.receipt)) {
    b.push(row(r.receipt!.merchantName, money(r.receipt!.total)), { type: 'text', text: r.receipt!.receiptNo, size: 12 });
  }
  for (const e of opts.external) b.push(row(`ใบเสร็จภายนอก ${e.ref}`, money(e.amount)));
  b.push(row('ยอดซื้อรวม', money(p.eligibleSpend)));
  for (const a of p.reward.applied) b.push({ type: 'text', text: `• ${a.ruleName}: ${rewardText(a.reward)}`, el: 'print-templates/validation/body/row' });
  b.push(
    { type: 'line', dashed: true },
    row('ค่าจอดก่อนส่วนลด', money(p.session.due)),
    row('ส่วนลดค่าจอด', `-${money(Math.max(0, p.session.due - after.due))}`),
    { type: 'row', left: 'ค่าจอดคงเหลือ', right: money(after.due), el: 'print-templates/validation/body/total' },
    { type: 'line' },
    { type: 'text', text: `${opts.counter}`, el: 'print-templates/validation/footer/text' },
  );
  if (opts.footer) b.push({ type: 'text', text: opts.footer, el: 'print-templates/validation/footer/text' });
  return { paperWidth: opts.paperWidth ?? '80', blocks: b, cut: true };
}

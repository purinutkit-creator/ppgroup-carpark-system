import type { ElementDef } from '../resolve.ts';

/** Text elements of the "print-templates" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'print-templates/validation/header/title', label: 'ใบ Validation', role: 'receipt', defaults: { fontSize: 20, fontWeight: 700, textAlign: 'center' }, sample: 'PARKING VALIDATION' },
  { path: 'print-templates/shift/header/title', label: 'Shift Report', role: 'receipt', defaults: { fontSize: 20, fontWeight: 700, textAlign: 'center' }, sample: 'SHIFT REPORT' },
  { path: 'print-templates/tax/header/title', label: 'Tax Invoice', role: 'receipt', defaults: { fontSize: 20, fontWeight: 700, textAlign: 'center' }, sample: 'ใบกำกับภาษีอย่างย่อ' },
  { path: 'print-templates/validation/body/row', label: 'ใบ Validation — รายการ', role: 'receipt', defaults: { fontSize: 15 }, sample: 'ส่วนลดค่าจอด ฿100.00' },
  { path: 'print-templates/validation/body/total', label: 'ใบ Validation — ยอดคงเหลือ', role: 'receipt', defaults: { fontSize: 20, fontWeight: 700 }, sample: 'ค่าจอดคงเหลือ ฿20.00' },
  { path: 'print-templates/validation/footer/text', label: 'ใบ Validation — ท้าย', role: 'receipt', defaults: { fontSize: 13, textAlign: 'center' }, sample: 'ขอบคุณที่ใช้บริการ' },
];

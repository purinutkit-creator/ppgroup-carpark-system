import type { ElementDef } from '../resolve.ts';

/** Text elements of the "info-counter" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'info-counter/main/vehicle/plate', label: 'เลขทะเบียน', role: 'plate', defaults: { fontSize: 36, fontWeight: 700 }, sample: 'กข 1234' },
  { path: 'info-counter/main/vehicle/province', label: 'จังหวัด', role: 'plate', defaults: { fontSize: 18 }, sample: 'กรุงเทพมหานคร' },
  { path: 'info-counter/main/fee/value', label: 'ค่าจอด', role: 'number', defaults: { fontSize: 32, fontWeight: 700 }, sample: '฿120.00' },
  { path: 'info-counter/main/receipt/status', label: 'สถานะใบเสร็จ', role: 'heading', defaults: { fontSize: 22, fontWeight: 700 }, sample: '✓ VERIFIED RECEIPT' },
];

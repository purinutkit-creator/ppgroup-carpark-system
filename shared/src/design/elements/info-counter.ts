import type { ElementDef } from '../resolve.ts';

/** Text elements of the "info-counter" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'info-counter/main/vehicle/plate', label: 'เลขทะเบียน', role: 'plate', defaults: { fontSize: 36, fontWeight: 700 }, sample: 'กข 1234' },
  { path: 'info-counter/main/vehicle/province', label: 'จังหวัด', role: 'plate', defaults: { fontSize: 18 }, sample: 'กรุงเทพมหานคร' },
  { path: 'info-counter/main/fee/value', label: 'ค่าจอด', role: 'number', defaults: { fontSize: 32, fontWeight: 700 }, sample: '฿120.00' },
  { path: 'info-counter/main/receipt/status', label: 'สถานะใบเสร็จ', role: 'heading', defaults: { fontSize: 22, fontWeight: 700 }, sample: '✓ VERIFIED RECEIPT' },
  { path: 'info-counter/main/section/title', label: 'หัวข้อส่วน', role: 'heading', defaults: { fontSize: 17, fontWeight: 600 }, sample: 'ค้นหารถ' },
  { path: 'info-counter/main/receipt/merchant', label: 'ชื่อร้านค้า', role: 'heading', defaults: { fontSize: 18, fontWeight: 600 }, sample: 'ร้าน ABC' },
  { path: 'info-counter/main/receipt/label', label: 'หัวข้อใบเสร็จ', role: 'primary', defaults: { fontSize: 14 }, sample: 'ยอดชำระจริง' },
  { path: 'info-counter/main/receipt/value', label: 'ค่าใบเสร็จ', role: 'number', defaults: { fontSize: 15, fontWeight: 600 }, sample: '฿1,250.00' },
  { path: 'info-counter/main/preview/label', label: 'หัวข้อสรุปส่วนลด', role: 'primary', defaults: { fontSize: 16 }, sample: 'ยอดซื้อ' },
  { path: 'info-counter/main/preview/value', label: 'ค่าสรุปส่วนลด', role: 'number', defaults: { fontSize: 18, fontWeight: 600 }, sample: '฿1,250.00' },
  { path: 'info-counter/main/preview/total', label: 'ค่าจอดคงเหลือ', role: 'number', defaults: { fontSize: 30, fontWeight: 700 }, sample: '฿20.00' },
];

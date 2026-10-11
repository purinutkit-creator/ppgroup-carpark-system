import type { ElementDef } from '../resolve.ts';

/** Text elements of the "customer-web" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'customer-web/session/header/siteName', label: 'ชื่อสถานที่', role: 'heading', defaults: { fontSize: 22, fontWeight: 700, textAlign: 'center' }, sample: 'SMART PARKING' },
  { path: 'customer-web/session/header/status', label: 'สถานะ', role: 'primary', defaults: { fontSize: 14, fontWeight: 600, textAlign: 'center' }, sample: 'กำลังจอดรถ' },
  { path: 'customer-web/session/vehicle/plate', label: 'เลขทะเบียน', role: 'plate', defaults: { fontSize: 40, fontWeight: 700, letterSpacing: 1, textAlign: 'center' }, sample: 'กข 1234' },
  { path: 'customer-web/session/vehicle/province', label: 'จังหวัด', role: 'plate', defaults: { fontSize: 18, textAlign: 'center' }, sample: 'กรุงเทพมหานคร' },
  { path: 'customer-web/session/timer/value', label: 'ระยะเวลาจอด', role: 'number', defaults: { fontSize: 44, fontWeight: 700, textAlign: 'center', letterSpacing: 1 }, sample: '03:25:18' },
  { path: 'customer-web/session/fee/current', label: 'ค่าจอดปัจจุบัน', role: 'number', defaults: { fontSize: 32, fontWeight: 700, textAlign: 'center' }, sample: '฿40.00' },
  { path: 'customer-web/session/details/label', label: 'หัวข้อรายละเอียด', role: 'primary', defaults: { fontSize: 15 }, sample: 'เวลาเข้า' },
  { path: 'customer-web/session/details/value', label: 'ค่ารายละเอียด', role: 'number', defaults: { fontSize: 15, fontWeight: 600 }, sample: '10:30 น.' },
  { path: 'customer-web/session/amount/total', label: 'ยอดชำระ', role: 'number', defaults: { fontSize: 36, fontWeight: 700, textAlign: 'center' }, sample: '฿40.00' },
  { path: 'customer-web/session/actions/pay', label: 'ปุ่มชำระเงิน', role: 'button', defaults: { fontSize: 18, fontWeight: 600 }, sample: 'ชำระค่าจอดรถ' },
];

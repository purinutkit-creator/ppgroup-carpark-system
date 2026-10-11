import type { ElementDef } from '../resolve.ts';

/** Text elements of the "payment-kiosk" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'payment-kiosk/idle/header/welcome', label: 'ข้อความต้อนรับ', role: 'heading', defaults: { fontSize: 56, fontWeight: 700, textAlign: 'center' }, sample: 'WELCOME' },
  { path: 'payment-kiosk/idle/actions/start', label: 'ปุ่มเริ่มต้น', role: 'button', defaults: { fontSize: 36, fontWeight: 600 }, sample: 'ชำระค่าจอดรถ' },
  { path: 'payment-kiosk/search/form/label', label: 'หัวข้อฟอร์ม', role: 'kiosk', defaults: { fontSize: 28, fontWeight: 500 }, sample: 'กรอกทะเบียนรถ' },
  { path: 'payment-kiosk/summary/vehicle/plate', label: 'เลขทะเบียน', role: 'plate', defaults: { fontSize: 64, fontWeight: 700, letterSpacing: 2, textAlign: 'center' }, sample: 'กข 1234' },
  { path: 'payment-kiosk/summary/vehicle/province', label: 'จังหวัด', role: 'plate', defaults: { fontSize: 28, textAlign: 'center' }, sample: 'กรุงเทพมหานคร' },
  { path: 'payment-kiosk/summary/lines/label', label: 'รายการ', role: 'kiosk', defaults: { fontSize: 24 }, sample: 'ค่าจอดปกติ' },
  { path: 'payment-kiosk/summary/lines/value', label: 'จำนวนเงินรายการ', role: 'number', defaults: { fontSize: 24, fontWeight: 600 }, sample: '฿120.00' },
  { path: 'payment-kiosk/summary/amount/total', label: 'ยอดชำระ', role: 'number', defaults: { fontSize: 72, fontWeight: 700, textAlign: 'center' }, sample: '฿20.00' },
  { path: 'payment-kiosk/summary/actions/pay', label: 'ปุ่มชำระเงิน', role: 'button', defaults: { fontSize: 32, fontWeight: 600 }, sample: 'ชำระเงิน' },
];

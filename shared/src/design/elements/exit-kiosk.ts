import type { ElementDef } from '../resolve.ts';

/** Text elements of the "exit-kiosk" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'exit-kiosk/main/header/siteName', label: 'ชื่อสถานที่', role: 'heading', defaults: { fontSize: 36, fontWeight: 700 }, sample: 'SMART PARKING' },
  { path: 'exit-kiosk/main/status/message', label: 'ข้อความสถานะ', role: 'kiosk', defaults: { fontSize: 36, fontWeight: 600, textAlign: 'center' }, sample: 'ขอบคุณที่ใช้บริการ' },
  { path: 'exit-kiosk/main/vehicle/plate', label: 'เลขทะเบียน', role: 'plate', defaults: { fontSize: 72, fontWeight: 700, letterSpacing: 2, textAlign: 'center' }, sample: 'กข 1234' },
  { path: 'exit-kiosk/main/vehicle/province', label: 'จังหวัด', role: 'plate', defaults: { fontSize: 32, textAlign: 'center' }, sample: 'กรุงเทพมหานคร' },
  { path: 'exit-kiosk/main/amount/total', label: 'ยอดชำระ', role: 'number', defaults: { fontSize: 80, fontWeight: 700, textAlign: 'center' }, sample: '฿20.00' },
  { path: 'exit-kiosk/main/actions/button', label: 'ปุ่ม', role: 'button', defaults: { fontSize: 28, fontWeight: 600 }, sample: 'เรียกเจ้าหน้าที่' },
  { path: 'exit-kiosk/main/header/clock', label: 'วันที่/เวลา', role: 'number', defaults: { fontSize: 24, fontWeight: 500 }, sample: '12/10/2026 10:30' },
  { path: 'exit-kiosk/main/status/hint', label: 'ข้อความอธิบาย', role: 'kiosk', defaults: { fontSize: 22, textAlign: 'center' }, sample: 'กรุณาสแกนบัตรจอดรถ' },
  { path: 'exit-kiosk/main/info/label', label: 'หัวข้อข้อมูล', role: 'kiosk', defaults: { fontSize: 22 }, sample: 'เวลาเข้า' },
  { path: 'exit-kiosk/main/info/value', label: 'ค่าข้อมูล', role: 'number', defaults: { fontSize: 26, fontWeight: 600 }, sample: '10:30 น.' },
];

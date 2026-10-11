import type { ElementDef } from '../resolve.ts';

/** Text elements of the "entry-kiosk" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'entry-kiosk/main/header/siteName', label: 'ชื่อสถานที่', role: 'heading', defaults: { fontSize: 36, fontWeight: 700 }, sample: 'SMART PARKING' },
  { path: 'entry-kiosk/main/header/clock', label: 'วันที่/เวลา', role: 'number', defaults: { fontSize: 24, fontWeight: 500 }, sample: '12/10/2026 10:30' },
  { path: 'entry-kiosk/main/status/message', label: 'ข้อความสถานะ', role: 'kiosk', defaults: { fontSize: 32, fontWeight: 600, textAlign: 'center' }, sample: 'ยินดีต้อนรับ' },
  { path: 'entry-kiosk/main/vehicle/plate', label: 'เลขทะเบียน', role: 'plate', defaults: { fontSize: 72, fontWeight: 700, letterSpacing: 2, textAlign: 'center' }, sample: 'กข 1234' },
  { path: 'entry-kiosk/main/vehicle/province', label: 'จังหวัด', role: 'plate', defaults: { fontSize: 32, fontWeight: 400, textAlign: 'center' }, sample: 'กรุงเทพมหานคร' },
  { path: 'entry-kiosk/main/info/label', label: 'หัวข้อข้อมูล', role: 'kiosk', defaults: { fontSize: 20, fontWeight: 400 }, sample: 'เวลาเข้า' },
  { path: 'entry-kiosk/main/info/value', label: 'ค่าข้อมูล', role: 'number', defaults: { fontSize: 28, fontWeight: 600 }, sample: '10:30 น.' },
  { path: 'entry-kiosk/main/actions/button', label: 'ปุ่ม', role: 'button', defaults: { fontSize: 32, fontWeight: 600 }, sample: 'กดรับบัตร' },
  { path: 'entry-kiosk/main/status/hint', label: 'ข้อความอธิบาย', role: 'kiosk', defaults: { fontSize: 22, fontWeight: 400, textAlign: 'center' }, sample: 'กรุณาขับรถเข้ามาที่จุดหยุดรถ' },
  { path: 'entry-kiosk/main/ticket/number', label: 'หมายเลขบัตร', role: 'number', defaults: { fontSize: 40, fontWeight: 700, letterSpacing: 1, textAlign: 'center' }, sample: 'PK202610120001' },
];

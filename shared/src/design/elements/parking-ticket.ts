import type { ElementDef } from '../resolve.ts';

/** Text elements of the "parking-ticket" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'parking-ticket/ticket/header/title', label: 'หัวบัตร', role: 'heading', defaults: { fontSize: 26, fontWeight: 700, textAlign: 'center' }, sample: 'SMART PARKING' },
  { path: 'parking-ticket/ticket/header/subtitle', label: 'หัวรอง', role: 'receipt', defaults: { fontSize: 16, fontWeight: 600, textAlign: 'center' }, sample: 'PARKING ENTRY TICKET' },
  { path: 'parking-ticket/ticket/vehicle/plate', label: 'ทะเบียน', role: 'plate', defaults: { fontSize: 40, fontWeight: 700, textAlign: 'center' }, sample: 'กข 1234' },
  { path: 'parking-ticket/ticket/vehicle/province', label: 'จังหวัด', role: 'plate', defaults: { fontSize: 20, textAlign: 'center' }, sample: 'กรุงเทพมหานคร' },
  { path: 'parking-ticket/ticket/info/row', label: 'ข้อมูล', role: 'receipt', defaults: { fontSize: 18 }, sample: 'เวลาเข้า 10:30 น.' },
  { path: 'parking-ticket/ticket/footer/text', label: 'ข้อความท้ายบัตร', role: 'receipt', defaults: { fontSize: 16, textAlign: 'center' }, sample: 'สแกนเพื่อดูเวลาจอดและชำระเงิน' },
];

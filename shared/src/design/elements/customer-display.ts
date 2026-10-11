import type { ElementDef } from '../resolve.ts';

/** Text elements of the "customer-display" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'customer-display/main/amount/total', label: 'ยอดรวม', role: 'number', defaults: { fontSize: 64, fontWeight: 700, textAlign: 'center' }, sample: '฿1,250.00' },
  { path: 'customer-display/main/items/name', label: 'ชื่อสินค้า', role: 'primary', defaults: { fontSize: 22 }, sample: 'Latte' },
  { path: 'customer-display/main/header/store', label: 'ชื่อร้าน', role: 'heading', defaults: { fontSize: 28, fontWeight: 700 }, sample: 'ABC Coffee' },
  { path: 'customer-display/main/items/price', label: 'ราคาสินค้า', role: 'number', defaults: { fontSize: 22, fontWeight: 600 }, sample: '฿130.00' },
  { path: 'customer-display/main/amount/label', label: 'ป้ายยอดรวม', role: 'primary', defaults: { fontSize: 22, textAlign: 'center' }, sample: 'ยอดชำระ' },
  { path: 'customer-display/main/summary/row', label: 'สรุปยอด', role: 'primary', defaults: { fontSize: 18 }, sample: 'ส่วนลด -฿50.00' },
  { path: 'customer-display/thanks/message/title', label: 'ข้อความขอบคุณ', role: 'heading', defaults: { fontSize: 48, fontWeight: 700, textAlign: 'center' }, sample: 'ขอบคุณที่ใช้บริการ' },
  { path: 'customer-display/thanks/amount/change', label: 'เงินทอน', role: 'number', defaults: { fontSize: 40, fontWeight: 700, textAlign: 'center' }, sample: 'เงินทอน ฿50.00' },
  { path: 'customer-display/idle/message/title', label: 'ข้อความรอลูกค้า', role: 'heading', defaults: { fontSize: 40, fontWeight: 600, textAlign: 'center' }, sample: 'ยินดีต้อนรับ' },
];

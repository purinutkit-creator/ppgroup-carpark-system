import type { ElementDef } from '../resolve.ts';

/** Text elements of the "receipt" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'receipt/pos/header/store', label: 'ร้านค้า', role: 'receipt', defaults: { fontSize: 24, fontWeight: 700, textAlign: 'center' }, sample: 'ABC Coffee' },
  { path: 'receipt/pos/header/receiptNo', label: 'เลขใบเสร็จ', role: 'receipt', defaults: { fontSize: 15 }, sample: 'M000124-B01-20261012-000158' },
  { path: 'receipt/pos/header/date', label: 'วันที่', role: 'receipt', defaults: { fontSize: 15 }, sample: '12/10/2026 14:21' },
  { path: 'receipt/pos/items/name', label: 'รายการสินค้า', role: 'receipt', defaults: { fontSize: 16 }, sample: 'Latte x2' },
  { path: 'receipt/pos/items/price', label: 'ราคา', role: 'receipt', defaults: { fontSize: 16 }, sample: '130.00' },
  { path: 'receipt/pos/totals/total', label: 'Total', role: 'receipt', defaults: { fontSize: 24, fontWeight: 700 }, sample: '฿1,250.00' },
  { path: 'receipt/pos/barcode/caption', label: 'Barcode Caption', role: 'receipt', defaults: { fontSize: 14, textAlign: 'center' }, sample: 'PARKING VALIDATION' },
  { path: 'receipt/pos/promo/text', label: 'ข้อความโปรโมชั่น', role: 'receipt', defaults: { fontSize: 15, textAlign: 'center' }, sample: 'นำใบเสร็จไปแสดงที่ประชาสัมพันธ์' },
  { path: 'receipt/pos/footer/text', label: 'Footer', role: 'receipt', defaults: { fontSize: 14, textAlign: 'center' }, sample: 'ขอบคุณที่ใช้บริการ' },
  { path: 'receipt/parking/header/title', label: 'หัวใบเสร็จค่าจอด', role: 'receipt', defaults: { fontSize: 22, fontWeight: 700, textAlign: 'center' }, sample: 'ใบเสร็จค่าจอดรถ' },
  { path: 'receipt/parking/totals/total', label: 'ยอดชำระค่าจอด', role: 'receipt', defaults: { fontSize: 24, fontWeight: 700 }, sample: '฿20.00' },
];

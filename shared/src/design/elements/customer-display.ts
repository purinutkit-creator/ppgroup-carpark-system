import type { ElementDef } from '../resolve.ts';

/** Text elements of the "customer-display" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'customer-display/main/amount/total', label: 'ยอดรวม', role: 'number', defaults: { fontSize: 64, fontWeight: 700, textAlign: 'center' }, sample: '฿1,250.00' },
  { path: 'customer-display/main/items/name', label: 'ชื่อสินค้า', role: 'primary', defaults: { fontSize: 22 }, sample: 'Latte' },
];

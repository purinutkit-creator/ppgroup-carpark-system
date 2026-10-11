import type { ElementDef } from '../resolve.ts';

/** Text elements of the "merchant-pos" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'merchant-pos/sell/products/name', label: 'Product Name', role: 'primary', defaults: { fontSize: 15, fontWeight: 600 }, sample: 'Latte' },
  { path: 'merchant-pos/sell/products/price', label: 'Product Price', role: 'number', defaults: { fontSize: 14, fontWeight: 500 }, sample: '฿65.00' },
  { path: 'merchant-pos/sell/categories/name', label: 'Category', role: 'primary', defaults: { fontSize: 14, fontWeight: 600 }, sample: 'Coffee' },
  { path: 'merchant-pos/sell/cart/item', label: 'Cart Item', role: 'primary', defaults: { fontSize: 15 }, sample: 'Latte x2' },
  { path: 'merchant-pos/sell/cart/total', label: 'Total', role: 'number', defaults: { fontSize: 32, fontWeight: 700 }, sample: '฿130.00' },
  { path: 'merchant-pos/sell/payment/title', label: 'Payment', role: 'heading', defaults: { fontSize: 22, fontWeight: 600 }, sample: 'ชำระเงิน' },
  { path: 'merchant-pos/sell/actions/button', label: 'Button', role: 'button', defaults: { fontSize: 16, fontWeight: 600 }, sample: 'ชำระเงิน' },
  { path: 'merchant-pos/sell/modal/title', label: 'Modal Title', role: 'heading', defaults: { fontSize: 20, fontWeight: 600 }, sample: 'Hold Bill' },
];

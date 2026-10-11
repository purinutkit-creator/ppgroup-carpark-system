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
  { path: 'merchant-pos/sell/topbar/store', label: 'Store (Top Bar)', role: 'heading', defaults: { fontSize: 18, fontWeight: 700 }, sample: 'ABC Coffee' },
  { path: 'merchant-pos/sell/topbar/info', label: 'Top Bar Info', role: 'primary', defaults: { fontSize: 13 }, sample: 'B01 · แคชเชียร์ · กะเปิด' },
  { path: 'merchant-pos/sell/cart/price', label: 'Cart Line Price', role: 'number', defaults: { fontSize: 15, fontWeight: 600 }, sample: '฿130.00' },
  { path: 'merchant-pos/sell/cart/meta', label: 'Cart Line Options', role: 'primary', defaults: { fontSize: 12 }, sample: 'Iced · Extra shot' },
  { path: 'merchant-pos/sell/cart/row', label: 'Cart Summary Row', role: 'primary', defaults: { fontSize: 14 }, sample: 'VAT 7% (รวมในราคา)' },
  { path: 'merchant-pos/sell/payment/amount', label: 'Payment Due', role: 'number', defaults: { fontSize: 40, fontWeight: 700 }, sample: '฿1,250.00' },
  { path: 'merchant-pos/sell/payment/change', label: 'Change', role: 'number', defaults: { fontSize: 28, fontWeight: 700 }, sample: 'เงินทอน ฿50.00' },
  { path: 'merchant-pos/shift/summary/value', label: 'Shift Summary Value', role: 'number', defaults: { fontSize: 20, fontWeight: 700 }, sample: '฿5,420.00' },
  { path: 'merchant-pos/receipts/list/receiptNo', label: 'Receipt No (History)', role: 'number', defaults: { fontSize: 14, fontWeight: 600 }, sample: 'M000124-B01-20261012-000158' },
];

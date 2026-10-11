import type { ElementDef } from '../resolve.ts';

/** Text elements of the "merchant-portal" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'merchant-portal/dashboard/kpi/value', label: 'KPI Value', role: 'number', defaults: { fontSize: 28, fontWeight: 700 }, sample: '฿12,450' },
  { path: 'merchant-portal/dashboard/kpi/label', label: 'KPI Label', role: 'primary', defaults: { fontSize: 13 }, sample: 'ยอดขายวันนี้' },
  { path: 'merchant-portal/layout/header/title', label: 'Page Title', role: 'heading', defaults: { fontSize: 22, fontWeight: 600 }, sample: 'Dashboard' },
  { path: 'merchant-portal/layout/nav/item', label: 'Nav Item', role: 'primary', defaults: { fontSize: 14 }, sample: 'ยอดขาย & ใบเสร็จ' },
  { path: 'merchant-portal/layout/header/store', label: 'Store Name', role: 'heading', defaults: { fontSize: 17, fontWeight: 700 }, sample: 'ABC Coffee' },
  { path: 'merchant-portal/sales/table/receiptNo', label: 'Receipt No', role: 'number', defaults: { fontSize: 13, fontWeight: 600 }, sample: 'M000124-B01-20261012-000158' },
  { path: 'merchant-portal/register/form/title', label: 'Register Title', role: 'heading', defaults: { fontSize: 26, fontWeight: 700 }, sample: 'สมัครร้านค้า' },
  { path: 'merchant-portal/register/form/section', label: 'Register Section', role: 'heading', defaults: { fontSize: 17, fontWeight: 600 }, sample: 'ข้อมูลร้านค้า' },
  { path: 'merchant-portal/register/success/reference', label: 'Reference Number', role: 'number', defaults: { fontSize: 30, fontWeight: 700, textAlign: 'center' }, sample: 'REG-20261012-00004' },
];

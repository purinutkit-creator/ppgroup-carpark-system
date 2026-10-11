import type { ElementDef } from '../resolve.ts';

/** Text elements of the "admin" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'admin/layout/header/title', label: 'Page Title', role: 'heading', defaults: { fontSize: 22, fontWeight: 600 }, sample: 'Dashboard' },
  { path: 'admin/layout/nav/item', label: 'Menu Item', role: 'primary', defaults: { fontSize: 14, fontWeight: 500 }, sample: 'รายการจอดรถ' },
  { path: 'admin/common/table/cell', label: 'Table Cell', role: 'primary', defaults: { fontSize: 14 }, sample: 'กข 1234' },
];

import type { ElementDef } from '../resolve.ts';

/** Text elements of the "merchant-portal" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'merchant-portal/dashboard/kpi/value', label: 'KPI Value', role: 'number', defaults: { fontSize: 28, fontWeight: 700 }, sample: '฿12,450' },
  { path: 'merchant-portal/dashboard/kpi/label', label: 'KPI Label', role: 'primary', defaults: { fontSize: 13 }, sample: 'ยอดขายวันนี้' },
  { path: 'merchant-portal/layout/header/title', label: 'Page Title', role: 'heading', defaults: { fontSize: 22, fontWeight: 600 }, sample: 'Dashboard' },
];

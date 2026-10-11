import type { ElementDef } from '../resolve.ts';

/** Text elements of the "dashboard" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'dashboard/main/kpi/value', label: 'KPI Value', role: 'number', defaults: { fontSize: 30, fontWeight: 700 }, sample: '1,284' },
  { path: 'dashboard/main/kpi/label', label: 'KPI Label', role: 'primary', defaults: { fontSize: 13 }, sample: 'รถในลานขณะนี้' },
  { path: 'dashboard/main/section/title', label: 'Section Title', role: 'heading', defaults: { fontSize: 16, fontWeight: 600 }, sample: 'อัตราการใช้พื้นที่' },
  { path: 'dashboard/main/occupancy/label', label: 'Occupancy Label', role: 'primary', defaults: { fontSize: 13 }, sample: 'Zone A (B1)' },
  { path: 'dashboard/main/alert/message', label: 'Alert Message', role: 'primary', defaults: { fontSize: 13 }, sample: 'กล้อง LPR ทางเข้า 1 ออฟไลน์' },
];

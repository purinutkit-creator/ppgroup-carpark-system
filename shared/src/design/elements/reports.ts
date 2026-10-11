import type { ElementDef } from '../resolve.ts';

/** Text elements of the "reports" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'reports/main/header/title', label: 'หัวรายงาน', role: 'heading', defaults: { fontSize: 22, fontWeight: 700 }, sample: 'รายงานรายได้ประจำวัน' },
  { path: 'reports/main/table/cell', label: 'ตาราง', role: 'primary', defaults: { fontSize: 12 }, sample: '1,250.00' },
  { path: 'reports/main/header/subtitle', label: 'ช่วงเวลารายงาน', role: 'primary', defaults: { fontSize: 13 }, sample: '01/10/2026 – 31/10/2026' },
  { path: 'reports/main/table/header', label: 'หัวตาราง', role: 'primary', defaults: { fontSize: 12, fontWeight: 600 }, sample: 'รายได้สุทธิ' },
  { path: 'reports/main/kpi/value', label: 'ตัวเลขสรุป', role: 'number', defaults: { fontSize: 22, fontWeight: 700 }, sample: '฿125,400.00' },
  { path: 'reports/main/kpi/label', label: 'ป้ายตัวเลขสรุป', role: 'primary', defaults: { fontSize: 12 }, sample: 'รายได้สุทธิ' },
];

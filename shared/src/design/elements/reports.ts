import type { ElementDef } from '../resolve.ts';

/** Text elements of the "reports" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'reports/main/header/title', label: 'หัวรายงาน', role: 'heading', defaults: { fontSize: 22, fontWeight: 700 }, sample: 'รายงานรายได้ประจำวัน' },
  { path: 'reports/main/table/cell', label: 'ตาราง', role: 'primary', defaults: { fontSize: 12 }, sample: '1,250.00' },
];

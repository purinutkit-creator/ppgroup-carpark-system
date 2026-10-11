import type { ElementDef } from '../resolve.ts';

/** Text elements of the "print-templates" system. UI code marks them with data-el="<path>". */
export const elements: ElementDef[] = [
  { path: 'print-templates/validation/header/title', label: 'ใบ Validation', role: 'receipt', defaults: { fontSize: 20, fontWeight: 700, textAlign: 'center' }, sample: 'PARKING VALIDATION' },
  { path: 'print-templates/shift/header/title', label: 'Shift Report', role: 'receipt', defaults: { fontSize: 20, fontWeight: 700, textAlign: 'center' }, sample: 'SHIFT REPORT' },
  { path: 'print-templates/tax/header/title', label: 'Tax Invoice', role: 'receipt', defaults: { fontSize: 20, fontWeight: 700, textAlign: 'center' }, sample: 'ใบกำกับภาษีอย่างย่อ' },
];

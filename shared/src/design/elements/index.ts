import type { ElementDef } from '../resolve.ts';
import { elements as admin } from './admin.ts';
import { elements as entryKiosk } from './entry-kiosk.ts';
import { elements as exitKiosk } from './exit-kiosk.ts';
import { elements as paymentKiosk } from './payment-kiosk.ts';
import { elements as merchantPos } from './merchant-pos.ts';
import { elements as merchantPortal } from './merchant-portal.ts';
import { elements as infoCounter } from './info-counter.ts';
import { elements as customerWeb } from './customer-web.ts';
import { elements as customerDisplay } from './customer-display.ts';
import { elements as dashboard } from './dashboard.ts';
import { elements as receipt } from './receipt.ts';
import { elements as parkingTicket } from './parking-ticket.ts';
import { elements as reports } from './reports.ts';
import { elements as printTemplates } from './print-templates.ts';

export const ELEMENTS: ElementDef[] = [
  ...admin, ...entryKiosk, ...exitKiosk, ...paymentKiosk, ...merchantPos, ...merchantPortal, ...infoCounter,
  ...customerWeb, ...customerDisplay, ...dashboard, ...receipt, ...parkingTicket, ...reports, ...printTemplates,
];

export function elementsFor(system: string): ElementDef[] {
  return ELEMENTS.filter((e) => e.path.startsWith(system + '/'));
}

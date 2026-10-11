import { q, json } from '../db/index.ts';

export const PERMISSIONS = [
  'dashboard.view',
  'sessions.view', 'sessions.edit', 'sessions.create_manual', 'sessions.cancel', 'sessions.lost_ticket',
  'lpr.review', 'images.view',
  'gate.control', 'gate.open_manual',
  'rates.manage', 'validation.rules', 'validation.apply', 'validation.manual_amount', 'validation.override',
  'discount.manual', 'discount.approve', 'waive.create', 'waive.approve',
  'payment.cash', 'payment.refund', 'payment.refund_approve', 'payment.view', 'tax.issue',
  'merchants.view', 'merchants.manage', 'merchants.approve',
  'kiosk_content.manage', 'devices.manage', 'sites.manage', 'users.manage',
  'members.manage', 'lists.manage', 'reservations.manage',
  'reports.view', 'reports.export', 'audit.view', 'alerts.manage',
  'settings.manage', 'backup.manage', 'pdpa.manage',
  'appearance.edit', 'font.upload', 'font.google.manage',
  'configuration.apply', 'configuration.apply_all', 'configuration.rollback',
  // merchant-scoped
  'merchant.portal', 'merchant.staff', 'merchant.settings',
  'pos.sell', 'pos.void', 'pos.refund', 'pos.products', 'pos.shift', 'pos.reports',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'OWNER', 'ADMIN', 'MANAGER', 'INFORMATION', 'CASHIER', 'PARKING_STAFF', 'AUDITOR',
  'MERCHANT_OWNER', 'MERCHANT_MANAGER', 'MERCHANT_CASHIER',
] as const;
export type Role = (typeof ROLES)[number];

const ALL = [...PERMISSIONS];
const MERCHANT_PERMS: Permission[] = ['merchant.portal', 'merchant.staff', 'merchant.settings', 'pos.sell', 'pos.void', 'pos.refund', 'pos.products', 'pos.shift', 'pos.reports'];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL.filter((p) => !['backup.manage', 'configuration.apply_all'].includes(p) && !MERCHANT_PERMS.includes(p)).concat(['configuration.apply_all']),
  MANAGER: [
    'dashboard.view', 'sessions.view', 'sessions.edit', 'sessions.create_manual', 'sessions.cancel', 'sessions.lost_ticket',
    'lpr.review', 'images.view', 'gate.control', 'gate.open_manual', 'validation.apply', 'validation.manual_amount', 'validation.override',
    'discount.manual', 'discount.approve', 'waive.create', 'waive.approve', 'payment.cash', 'payment.refund', 'payment.refund_approve',
    'payment.view', 'tax.issue', 'merchants.view', 'members.manage', 'lists.manage', 'reservations.manage', 'reports.view',
    'reports.export', 'audit.view', 'alerts.manage', 'configuration.apply',
  ],
  INFORMATION: ['sessions.view', 'validation.apply', 'members.manage', 'reservations.manage', 'sessions.lost_ticket', 'payment.view'],
  CASHIER: ['sessions.view', 'payment.cash', 'payment.view', 'tax.issue', 'validation.apply', 'sessions.lost_ticket'],
  PARKING_STAFF: ['dashboard.view', 'sessions.view', 'sessions.create_manual', 'lpr.review', 'images.view', 'gate.control', 'gate.open_manual', 'alerts.manage'],
  AUDITOR: ['dashboard.view', 'sessions.view', 'images.view', 'payment.view', 'merchants.view', 'reports.view', 'reports.export', 'audit.view'],
  MERCHANT_OWNER: MERCHANT_PERMS,
  MERCHANT_MANAGER: ['merchant.portal', 'pos.sell', 'pos.void', 'pos.refund', 'pos.products', 'pos.shift', 'pos.reports'],
  MERCHANT_CASHIER: ['pos.sell', 'pos.shift'],
};

/** Actions that always need a second person (approver) with these permissions. */
export const APPROVAL_REQUIRED: Record<string, Permission> = {
  WAIVE: 'waive.approve',
  MANUAL_DISCOUNT: 'discount.approve',
  MANUAL_BARRIER_OPEN: 'gate.open_manual',
  REFUND: 'payment.refund_approve',
  VALIDATION_OVERRIDE: 'validation.override',
  POS_VOID: 'pos.void',
  POS_REFUND: 'pos.refund',
};

let cache: Map<string, Set<string>> | null = null;
export function invalidatePermissionCache() {
  cache = null;
}

export function permissionsFor(role: string): Set<string> {
  if (!cache) {
    cache = new Map();
    for (const r of ROLES) cache.set(r, new Set(DEFAULT_ROLE_PERMISSIONS[r]));
    for (const row of q.all<{ role: string; permissions: string }>('SELECT role, permissions FROM role_permissions')) {
      cache.set(row.role, new Set(json<string[]>(row.permissions, [])));
    }
  }
  return cache.get(role) ?? new Set();
}

export function isMerchantRole(role: string) {
  return role.startsWith('MERCHANT_');
}

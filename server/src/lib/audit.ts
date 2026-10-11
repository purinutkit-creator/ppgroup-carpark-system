import type { Request } from 'express';
import { q } from '../db/index.ts';
import { emit } from './realtime.ts';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | number | null;
  siteId?: number | null;
  deviceId?: number | null;
  merchantId?: number | null;
  sessionId?: number | null;
  parkingNo?: string | null;
  receiptNo?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  approvedBy?: { userId: number; username: string } | null;
  meta?: unknown;
}

/** Who / what / when / which device / which shop / which parking ID / which receipt / before → after. */
export function audit(req: Request | null, e: AuditEntry): void {
  const user = req?.user;
  const id = q.insert('audit_logs', {
    user_id: user?.id ?? null,
    username: user?.username ?? (req?.device ? `device:${req.device.name}` : 'system'),
    role: user?.role ?? (req?.device ? req.device.type : null),
    action: e.action,
    entity_type: e.entityType ?? null,
    entity_id: e.entityId != null ? String(e.entityId) : null,
    site_id: e.siteId ?? null,
    device_id: e.deviceId ?? req?.device?.id ?? null,
    merchant_id: e.merchantId ?? null,
    session_id: e.sessionId ?? null,
    parking_no: e.parkingNo ?? null,
    receipt_no: e.receiptNo ?? null,
    before_json: e.before === undefined ? null : JSON.stringify(e.before),
    after_json: e.after === undefined ? null : JSON.stringify(e.after),
    reason: e.reason ?? null,
    approved_by: e.approvedBy?.userId ?? null,
    approved_by_name: e.approvedBy?.username ?? null,
    ip: req?.ip ?? null,
    meta_json: e.meta === undefined ? null : JSON.stringify(e.meta),
  });
  emit.staff('audit:new', { id, action: e.action, at: new Date().toISOString() });
}

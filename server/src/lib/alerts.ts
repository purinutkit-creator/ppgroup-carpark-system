import { q, nowIso } from '../db/index.ts';
import { emit } from './realtime.ts';

export type AlertType =
  | 'DEVICE_OFFLINE' | 'DEVICE_ONLINE' | 'LONG_STAY' | 'BLACKLIST' | 'PLATE_MISMATCH' | 'LPR_REVIEW'
  | 'DUPLICATE_PAYMENT' | 'LOT_FULL' | 'RECEIPT_REFUND' | 'MANUAL_BARRIER' | 'PAYMENT_FAILED' | 'EXIT_ASSIST' | 'SYNC_CONFLICT';

export function raiseAlert(a: {
  type: AlertType;
  message: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  siteId?: number | null;
  refType?: string;
  refId?: string | number;
  data?: unknown;
  dedupeKey?: string;
}): number | null {
  if (a.dedupeKey) {
    const open = q.get('SELECT id FROM alerts WHERE dedupe_key=? AND resolved_at IS NULL', a.dedupeKey);
    if (open) return null;
  }
  const id = q.insert('alerts', {
    type: a.type,
    severity: a.severity ?? 'WARNING',
    site_id: a.siteId ?? null,
    ref_type: a.refType ?? null,
    ref_id: a.refId != null ? String(a.refId) : null,
    message: a.message,
    data_json: a.data === undefined ? null : JSON.stringify(a.data),
    dedupe_key: a.dedupeKey ?? null,
  });
  const alert = q.get('SELECT * FROM alerts WHERE id=?', id);
  emit.staff('alert:new', alert);
  if (a.siteId) emit.site(a.siteId, 'alert:new', alert);
  return id;
}

export function resolveAlerts(dedupeKey: string) {
  const r = q.run('UPDATE alerts SET resolved_at=? WHERE dedupe_key=? AND resolved_at IS NULL', nowIso(), dedupeKey);
  if (r.changes) emit.staff('alert:resolved', { dedupeKey });
}

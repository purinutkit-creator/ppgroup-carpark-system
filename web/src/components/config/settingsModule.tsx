/**
 * Settings modules: load / edit / save with "Apply To…" targets, plus the
 * version history + rollback panel shown under every settings form.
 */
import { useCallback, useEffect, useState } from 'react';
import { get, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime } from '../../lib/format';
import { Badge, Button, ConfirmDialog, Empty, Modal, TextArea, useToast, errorText, type ApplyTarget } from '../ui';
import { same } from './common';

export interface ModuleVersion {
  id: number;
  version_no: number;
  data: unknown;
  applied_to: string[] | 'ALL' | null;
  note: string | null;
  rolled_back_from: number | null;
  rolled_back_from_no: number | null;
  created_by_name: string | null;
  created_at: string;
}

/** Editable copy of a settings module with dirty tracking and save/apply helpers. */
export function useSettingsModule<T>(module: string) {
  const [saved, setSaved] = useState<T | null>(null);
  const [draft, setDraft] = useState<T | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await get<{ value: T; version: number }>(`/api/admin/settings/${module}`);
      setSaved(r.value);
      setDraft(structuredClone(r.value));
      setVersion(r.version);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [module]);
  useEffect(() => {
    load();
  }, [load]);
  const save = useCallback(
    async (appliedTo?: string[] | 'ALL', note?: string) => {
      const r = await put<{ value: T; version: { version_no: number } }>(`/api/admin/settings/${module}`, { value: draft, appliedTo, note });
      setSaved(r.value);
      setDraft(structuredClone(r.value));
      setVersion(r.version.version_no);
      return r;
    },
    [module, draft],
  );
  const patch = useCallback((p: Partial<T>) => setDraft((d) => (d ? { ...d, ...p } : d)), []);
  return {
    value: draft,
    saved,
    version,
    error,
    dirty: !!draft && !same(draft, saved),
    set: setDraft,
    patch,
    reset: () => setDraft(saved ? structuredClone(saved) : null),
    save,
    reload: load,
  };
}

/** Footer props wiring for a module: Save / Save & Apply To… / Apply to All. */
export function useApplyPermissions() {
  const { can } = useAuth();
  return { canApply: can('configuration.apply', 'configuration.apply_all'), canApplyAll: can('configuration.apply_all') };
}

export function targetsLabel(t: ModuleVersion['applied_to'], targets: ApplyTarget[] = []) {
  if (!t) return '-';
  if (t === 'ALL' || (Array.isArray(t) && t.includes('ALL'))) return 'ทั้งหมด';
  return t.map((id) => targets.find((x) => x.id === id)?.label ?? id).join(', ');
}

export function VersionHistory({ module, version, targets, onRolledBack }: { module: string; version: number; targets?: ApplyTarget[]; onRolledBack: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<ModuleVersion[]>([]);
  const [view, setView] = useState<ModuleVersion | null>(null);
  const [rollback, setRollback] = useState<ModuleVersion | null>(null);
  const [reason, setReason] = useState('');
  const load = useCallback(() => {
    get<{ items: ModuleVersion[] }>(`/api/admin/settings/${module}/versions`)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [module]);
  useEffect(() => {
    load();
  }, [load, version]);
  return (
    <details className="card">
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>ประวัติการตั้งค่า (Version History) · ปัจจุบัน v{version || 0}</summary>
      <div className="table-wrap mt">
        {items.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>วันเวลา</th>
                <th>ผู้แก้ไข</th>
                <th>Apply ไปที่</th>
                <th>หมายเหตุ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id}>
                  <td>
                    v{v.version_no} {v.version_no === version && <Badge tone="success">ใช้งานอยู่</Badge>}
                    {v.rolled_back_from_no && <span className="small muted"> (rollback จาก v{v.rolled_back_from_no})</span>}
                  </td>
                  <td className="nowrap">{dateTime(v.created_at)}</td>
                  <td>{v.created_by_name ?? '-'}</td>
                  <td className="small">{targetsLabel(v.applied_to, targets)}</td>
                  <td className="small">{v.note ?? ''}</td>
                  <td className="nowrap right">
                    <Button size="sm" variant="ghost" onClick={() => setView(v)}>
                      ดูข้อมูล
                    </Button>
                    {can('configuration.rollback') && v.version_no !== version && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setReason('');
                          setRollback(v);
                        }}
                      >
                        Rollback
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>ยังไม่มีประวัติ — ระบบใช้ค่าเริ่มต้น</Empty>
        )}
      </div>
      <Modal open={!!view} title={`ข้อมูล v${view?.version_no}`} onClose={() => setView(null)} size="lg">
        <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {JSON.stringify(view?.data, null, 2)}
        </pre>
      </Modal>
      <ConfirmDialog
        open={!!rollback}
        title={`Rollback เป็น v${rollback?.version_no}?`}
        confirmText="Rollback"
        danger
        message={
          <div className="col">
            <div>ระบบจะสร้างเวอร์ชันใหม่จากข้อมูลของ v{rollback?.version_no} และส่งไปยังทุกอุปกรณ์ทันที</div>
            <TextArea value={reason} placeholder="เหตุผล (บันทึกใน Audit Log)" onChange={(e) => setReason(e.target.value)} />
          </div>
        }
        onClose={() => setRollback(null)}
        onConfirm={async () => {
          try {
            await post(`/api/admin/settings/${module}/rollback/${rollback!.id}`, { reason: reason || undefined });
            toast(`Rollback เป็น v${rollback!.version_no} แล้ว`, 'success');
            load();
            onRolledBack();
          } catch (e) {
            toast(errorText(e), 'error');
          }
        }}
      />
    </details>
  );
}

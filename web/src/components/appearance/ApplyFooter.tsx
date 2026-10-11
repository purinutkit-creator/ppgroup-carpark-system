/**
 * Appearance variant of the standard settings footer:
 *   Cancel · Preview · Save · Save & Apply To… · Save & Apply to All
 * The apply dialog lists every system with group shortcuts
 * (Entire System, All Kiosks, All Merchant POS, …) and asks for confirmation.
 */
import { useState, type ReactNode } from 'react';
import { SYSTEM_GROUPS, SYSTEMS, type SystemId } from '@pp/shared/design/index';
import { Button, Check, Field, Input, Modal, errorText, useToast } from '../ui';

/** Group shortcuts shown in the dialog, in display order. */
const GROUP_ORDER = ['all', 'kiosk', 'merchant', 'customer', 'customerKiosk', 'posReceipt', 'print'];

export function ApplyFooter({
  dirty,
  onCancel,
  onPreview,
  onSave,
  onApply,
  canSave = true,
  canApply = true,
  canApplyAll = true,
  subject,
  saveLabel = 'Save',
  saveHint,
  extra,
}: {
  dirty?: boolean;
  onCancel?: () => void;
  onPreview?: () => void;
  onSave?: (note: string) => Promise<unknown> | void;
  onApply?: (systems: SystemId[], all: boolean, note: string) => Promise<unknown> | void;
  canSave?: boolean;
  canApply?: boolean;
  canApplyAll?: boolean;
  subject?: string;
  saveLabel?: string;
  saveHint?: ReactNode;
  extra?: ReactNode;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<null | 'some' | 'all'>(null);
  const [sel, setSel] = useState<SystemId[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const all = SYSTEMS.map((s) => s.id) as SystemId[];

  const run = async (fn: () => Promise<unknown> | void, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg, 'success');
      setNote('');
      return true;
    } catch (e) {
      toast(errorText(e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const open = (m: 'some' | 'all') => {
    setSel(m === 'all' ? all : []);
    setMode(m);
  };
  const toggleGroup = (ids: SystemId[]) => {
    const on = ids.every((s) => sel.includes(s));
    setSel((cur) => (on ? cur.filter((s) => !ids.includes(s)) : [...new Set([...cur, ...ids])]));
  };

  return (
    <>
      <div className="settings-footer">
        {dirty && <span className="dirty">● มีการแก้ไขที่ยังไม่บันทึก</span>}
        {!dirty && saveHint && <span className="small muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>{saveHint}</span>}
        {extra}
        {onCancel && (
          <Button onClick={onCancel} disabled={!dirty || busy}>
            Cancel
          </Button>
        )}
        {onPreview && <Button onClick={onPreview}>Preview</Button>}
        {onSave && canSave && (
          <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => run(() => onSave(note), 'บันทึกและเผยแพร่แล้ว')}>
            {saveLabel}
          </Button>
        )}
        {onApply && canApply && (
          <Button onClick={() => open('some')} disabled={busy}>
            Save & Apply To…
          </Button>
        )}
        {onApply && canApplyAll && (
          <Button variant="secondary" onClick={() => open('all')} disabled={busy}>
            Save & Apply to All
          </Button>
        )}
      </div>
      <Modal
        open={!!mode}
        onClose={() => setMode(null)}
        title={mode === 'all' ? (subject ? `Apply “${subject}” to all systems?` : 'Apply to all systems?') : subject ? `Apply “${subject}” to…` : 'Apply to…'}
        footer={
          <>
            <Button onClick={() => setMode(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!sel.length || (sel.length === all.length && !canApplyAll)}
              loading={busy}
              onClick={async () => {
                const isAll = all.every((s) => sel.includes(s));
                if (await run(() => onApply!(sel, isAll, note), `Applied to ${isAll ? 'all systems' : `${sel.length} systems`}`)) setMode(null);
              }}
            >
              CONFIRM & APPLY
            </Button>
          </>
        }
      >
        <div className="col">
          {mode === 'some' && (
            <div className="row" style={{ gap: 6 }}>
              {GROUP_ORDER.filter((g) => SYSTEM_GROUPS[g]).map((g) => {
                const grp = SYSTEM_GROUPS[g];
                const on = grp.systems.every((s) => sel.includes(s));
                return (
                  <Button key={g} size="sm" variant={on ? 'primary' : 'default'} onClick={() => toggleGroup(grp.systems)} disabled={g === 'all' && !canApplyAll}>
                    {grp.label}
                  </Button>
                );
              })}
            </div>
          )}
          <div className="ap-check-grid">
            {SYSTEMS.map((s) => (
              <Check key={s.id} label={s.name} checked={sel.includes(s.id)} onChange={(v) => setSel((cur) => (v ? [...cur, s.id] : cur.filter((x) => x !== s.id)))} />
            ))}
          </div>
          {sel.length === all.length && !canApplyAll && <div className="small" style={{ color: 'var(--color-danger)' }}>ต้องมีสิทธิ์ configuration.apply_all เพื่อใช้กับทุกระบบ</div>}
          <Field label="หมายเหตุ (บันทึกใน Version / Audit Log)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เปลี่ยนฟอนต์ตามแบรนด์ใหม่" />
          </Field>
          <div className="small muted">ระบบจะบันทึก Design Configuration Version ใหม่ และส่งการตั้งค่าไปยังอุปกรณ์ที่เกี่ยวข้องแบบ Real-Time (ไม่ต้องรีโหลดหน้าจอ)</div>
        </div>
      </Modal>
    </>
  );
}

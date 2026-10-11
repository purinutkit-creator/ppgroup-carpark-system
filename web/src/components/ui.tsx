/**
 * Shared UI kit. Styling comes from styles.css + design-config CSS variables.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { PROVINCES } from '@pp/shared/provinces';
import { ApiError } from '../lib/api';

// ------------------------------------------------------------------ basics --

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'default';
export function Button({
  variant = 'default',
  size,
  block,
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'lg' | 'xl'; block?: boolean; loading?: boolean }) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={rest.disabled || loading} {...rest}>
      {loading ? '…' : null}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className, ...rest }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string } & Record<string, unknown>) {
  return (
    <div className={`card ${className ?? ''}`} {...rest}>
      {(title || actions) && (
        <div className="card-title">
          <span>{title}</span>
          <span className="spacer" />
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Kpi({ label, value, hint, el }: { label: ReactNode; value: ReactNode; hint?: ReactNode; el?: { label?: string; value?: string } }) {
  return (
    <div className="card kpi">
      <span className="kpi-label" data-el={el?.label}>
        {label}
      </span>
      <span className="kpi-value" data-el={el?.value}>
        {value}
      </span>
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}

export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className ?? ''}`} {...rest} />;
}
export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`input ${className ?? ''}`} {...rest} />;
}
export function Select({ className, options, placeholder, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string | number; label: ReactNode } | string>; placeholder?: string }) {
  return (
    <select className={`input ${className ?? ''}`} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) =>
        typeof o === 'string' ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={String(o.value)} value={o.value}>
            {o.label as string}
          </option>
        ),
      )}
    </select>
  );
}
export function Check({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function NumberInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | null | undefined; onChange: (v: number | null) => void }) {
  return <Input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} {...rest} />;
}

export function ProvinceSelect({ value, onChange, allowEmpty = true, className }: { value: string | null | undefined; onChange: (code: string | null) => void; allowEmpty?: boolean; className?: string }) {
  return (
    <select className={`input ${className ?? ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">— ไม่ระบุจังหวัด —</option>}
      {PROVINCES.map((p) => (
        <option key={p.code} value={p.code}>
          {p.th}
        </option>
      ))}
    </select>
  );
}

const BADGE: Record<string, string> = {
  ACTIVE: 'info', PAID: 'success', UNPAID: 'warning', WAIVED: 'success', FREE: 'success', EXITED: '', CANCELLED: 'danger',
  PENDING: 'warning', APPROVED: 'info', SUSPENDED: 'danger', CLOSED: '', REJECTED: 'danger', FAILED: 'danger', EXPIRED: '',
  REFUNDED: 'danger', PARTIALLY_REFUNDED: 'warning', VOIDED: 'danger', ONLINE: 'success', OFFLINE: 'danger', ERROR: 'danger', UNKNOWN: '',
  AUTO_CONFIRM: 'success', KIOSK_CONFIRM: 'info', MANUAL_REVIEW: 'warning', NO_READ: 'danger', VALIDATED: 'success',
  REFUNDED_AFTER_VALIDATION: 'danger', REVOKED: 'danger', CRITICAL: 'danger', WARNING: 'warning', INFO: 'info', RESOLVED: 'success',
  NOT_USED: '', USED: 'info', OPEN: 'info', BOOKED: 'info', CHECKED_IN: 'success', COMPLETED: '',
};
export function Badge({ children, tone }: { children: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'info' | '' }) {
  const t = tone ?? (typeof children === 'string' ? BADGE[children] : '') ?? '';
  return <span className={`badge ${t ? `badge-${t}` : ''}`}>{children}</span>;
}

export function PlateBadge({ plate, province, size = 16 }: { plate: string | null | undefined; province?: string | null; size?: number }) {
  if (!plate) return <span className="badge badge-warning">ไม่ทราบทะเบียน</span>;
  return (
    <span className="plate-badge" style={{ fontSize: size }}>
      <span className="p">{plate}</span>
      <span className="v">{province ?? 'ไม่ระบุจังหวัด'}</span>
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} type="button" className={t.id === value ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children = 'ไม่มีข้อมูล' }: { children?: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Pagination({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      <span className="small muted">
        หน้า {page}/{pages} · ทั้งหมด {total.toLocaleString()} รายการ
      </span>
      <Button size="sm" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>
        ก่อนหน้า
      </Button>
      <Button size="sm" disabled={page >= pages} onClick={() => onChange(offset + limit)}>
        ถัดไป
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------- modal --

export function Modal({ open, title, onClose, children, footer, size }: { open: boolean; title?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ? `modal-${size}` : ''}`} role="dialog" aria-modal="true">
        {title && (
          <div className="modal-header">
            <span>{title}</span>
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="close">
              ✕
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ toasts --

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}
const ToastCtx = createContext<(text: string, kind?: ToastItem['kind']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: ToastItem['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return `${e.message}${e.code && e.code !== e.message ? ` (${e.code})` : ''}`;
  return (e as Error)?.message ?? String(e);
}

// ------------------------------------------------------------ async helper --

/** Load data on mount / when deps change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const r = await fn();
      if (n === seq.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(errorText(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

// ------------------------------------------------------ confirm & approval --

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'ยืนยัน',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      {message}
    </Modal>
  );
}

export interface ApprovalInput {
  reason: string;
  approval?: { username: string; pin: string };
}

/**
 * Sensitive actions (waive, manual discount, manual barrier open, refund):
 * captures a reason and — when the current user cannot self-approve — the
 * approver's username + PIN. The server re-verifies everything.
 */
export function ApprovalDialog({
  open,
  title,
  description,
  requireApprover,
  children,
  onSubmit,
  onClose,
  submitText = 'ยืนยัน',
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  /** Force second-person approval fields to be shown. */
  requireApprover?: boolean;
  children?: ReactNode;
  onSubmit: (v: ApprovalInput) => Promise<void>;
  onClose: () => void;
  submitText?: string;
}) {
  const [reason, setReason] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showApprover, setShowApprover] = useState(!!requireApprover);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setUsername('');
      setPin('');
      setErr(null);
      setShowApprover(!!requireApprover);
    }
  }, [open, requireApprover]);
  const submit = async () => {
    if (!reason.trim()) return setErr('กรุณาระบุเหตุผล');
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({ reason: reason.trim(), approval: showApprover && username ? { username, pin } : undefined });
      onClose();
    } catch (e) {
      const code = (e as ApiError).code;
      if (code === 'APPROVAL_REQUIRED' || code === 'SELF_APPROVAL_NOT_ALLOWED') setShowApprover(true);
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {submitText}
          </Button>
        </>
      }
    >
      <div className="col">
        {description && <div className="muted">{description}</div>}
        {children}
        <Field label="เหตุผล (บันทึกใน Audit Log)">
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ระบุเหตุผล" />
        </Field>
        {showApprover ? (
          <fieldset className="group">
            <legend>ผู้อนุมัติ</legend>
            <div className="grid grid-2">
              <Field label="ชื่อผู้ใช้ผู้อนุมัติ">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="PIN">
                <Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />
              </Field>
            </div>
          </fieldset>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowApprover(true)}>
            + ระบุผู้อนุมัติ
          </button>
        )}
        {err && <div className="error" style={{ color: 'var(--color-danger)' }}>{err}</div>}
      </div>
    </Modal>
  );
}

// -------------------------------------------------- standard settings bar --

export interface ApplyTarget {
  id: string;
  label: string;
}

/**
 * Standard footer for every settings page:
 *   Cancel · Preview · Save · Save & Apply To… · Save & Apply to All
 * "Apply To…" / "Apply to All" open a confirmation listing the targets
 * (checkboxes) before anything is changed.
 */
export function SettingsFooter({
  dirty,
  onCancel,
  onPreview,
  onSave,
  onApply,
  targets,
  canApply = true,
  canApplyAll = true,
  applyAllLabel = 'Save & Apply to All',
  subject,
}: {
  dirty?: boolean;
  onCancel?: () => void;
  onPreview?: () => void;
  onSave: () => Promise<void> | void;
  /** Called with the selected target ids. Omit to hide the apply buttons. */
  onApply?: (targets: string[], all: boolean) => Promise<void> | void;
  targets?: ApplyTarget[];
  canApply?: boolean;
  canApplyAll?: boolean;
  applyAllLabel?: string;
  /** e.g. 'Sarabun' → confirmation reads: Apply “Sarabun” to … */
  subject?: string;
}) {
  const [mode, setMode] = useState<null | 'some' | 'all'>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const open = (m: 'some' | 'all') => {
    setSel(m === 'all' ? (targets ?? []).map((t) => t.id) : []);
    setMode(m);
  };
  const run = async (fn: () => Promise<void> | void, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg, 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="settings-footer">
        {dirty && <span className="dirty">● มีการแก้ไขที่ยังไม่บันทึก</span>}
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        {onPreview && <Button onClick={onPreview}>Preview</Button>}
        <Button variant="primary" loading={busy} onClick={() => run(onSave, 'บันทึกแล้ว')}>
          Save
        </Button>
        {onApply && targets && canApply && <Button onClick={() => open('some')}>Save & Apply To…</Button>}
        {onApply && targets && canApplyAll && (
          <Button variant="secondary" onClick={() => open('all')}>
            {applyAllLabel}
          </Button>
        )}
      </div>
      <Modal
        open={!!mode}
        onClose={() => setMode(null)}
        title={subject ? `Apply “${subject}” to ${mode === 'all' ? 'all systems' : 'selected'}?` : mode === 'all' ? 'Apply to all?' : 'Apply to…'}
        footer={
          <>
            <Button onClick={() => setMode(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!sel.length}
              loading={busy}
              onClick={() =>
                run(async () => {
                  await onApply!(sel, mode === 'all' && sel.length === (targets ?? []).length);
                  setMode(null);
                }, 'Applied')
              }
            >
              CONFIRM & APPLY
            </Button>
          </>
        }
      >
        <div className="col">
          <div className="row">
            <Button size="sm" onClick={() => setSel((targets ?? []).map((t) => t.id))}>
              เลือกทั้งหมด
            </Button>
            <Button size="sm" onClick={() => setSel([])}>
              ล้าง
            </Button>
          </div>
          {(targets ?? []).map((t) => (
            <Check key={t.id} label={t.label} checked={sel.includes(t.id)} onChange={(v) => setSel((s) => (v ? [...s, t.id] : s.filter((x) => x !== t.id)))} />
          ))}
          <div className="small muted">ระบบจะบันทึก Configuration Version ใหม่ และส่งการตั้งค่าไปยังอุปกรณ์ที่เกี่ยวข้องแบบ Real-Time</div>
        </div>
      </Modal>
    </>
  );
}

// ------------------------------------------------------ media / file input --

/** Upload field that shows the recommended size and a preview before saving. */
export function MediaInput({
  label,
  value,
  onChange,
  recommended,
  accept = 'image/*',
  upload,
}: {
  label: ReactNode;
  value: string | null | undefined;
  onChange: (url: string) => void;
  recommended?: string;
  accept?: string;
  upload: (file: File) => Promise<string>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isVideo = value && /\.(mp4|webm|mov)$/i.test(value);
  return (
    <Field label={label} hint={recommended ? `ขนาดแนะนำ: ${recommended}` : undefined} error={err}>
      <div className="row">
        {value ? (
          isVideo ? (
            <video src={value} className="img-thumb" muted />
          ) : (
            <img src={value} className="img-thumb" alt="" style={{ objectFit: 'contain' }} />
          )
        ) : (
          <div className="img-thumb" />
        )}
        <label className="btn btn-sm">
          {busy ? 'กำลังอัปโหลด…' : 'อัปโหลด'}
          <input
            type="file"
            accept={accept}
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              setErr(null);
              try {
                onChange(await upload(f));
              } catch (x) {
                setErr(errorText(x));
              } finally {
                setBusy(false);
                e.target.value = '';
              }
            }}
          />
        </label>
        {value && (
          <Button size="sm" variant="ghost" onClick={() => onChange('')}>
            ลบ
          </Button>
        )}
      </div>
    </Field>
  );
}

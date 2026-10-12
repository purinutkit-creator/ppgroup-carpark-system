/**
 * Generic list + create/edit/delete table for admin configuration entities.
 * Each page describes its columns and form fields; the server validates and
 * audits every change.
 */
import { useState, type ReactNode } from 'react';
import { del, get, post, put } from '../../lib/api';
import { toLocalInput, fromLocalInput } from '../../lib/format';
import { Button, Card, Check, ConfirmDialog, Empty, Field, Input, Modal, ProvinceSelect, Select, TextArea, errorText, useAsync, useToast } from '../ui';

export type FieldDef<F> = {
  key: keyof F & string;
  label: ReactNode;
  type?: 'text' | 'number' | 'select' | 'check' | 'datetime' | 'date' | 'time' | 'textarea' | 'province' | 'password' | 'custom';
  options?: Array<{ value: string | number; label: ReactNode }>;
  hint?: ReactNode;
  placeholder?: string;
  /** Only shown when creating. */
  createOnly?: boolean;
  wide?: boolean;
  show?: (form: F) => boolean;
  render?: (form: F, set: (patch: Partial<F>) => void) => ReactNode;
};

export interface Column<R> {
  label: ReactNode;
  render: (row: R) => ReactNode;
  className?: string;
}

export interface CrudProps<R, F> {
  title: ReactNode;
  url: string;                       // list + create
  listUrl?: string;                  // list endpoint when different from url
  rowsFrom?: (data: any) => any[];
  itemUrl?: (row: R) => string;      // update + delete (default url/:id)
  listKey?: string;
  query?: string;
  columns: Column<R>[];
  fields: FieldDef<F>[];
  empty: () => F;
  toForm: (row: R) => F;
  toBody: (form: F, editing: R | null) => Record<string, unknown>;
  canEdit?: boolean;
  canDelete?: boolean;
  deleteLabel?: string;
  actions?: (row: R, reload: () => void) => ReactNode;
  headerActions?: ReactNode;
  onSaved?: (result: any, editing: R | null) => void;
  rowKey?: (row: R) => string | number;
  filter?: (rows: R[]) => R[];
}

export function CrudTable<R extends Record<string, any>, F extends Record<string, any>>(p: CrudProps<R, F>) {
  const toast = useToast();
  const list = useAsync(() => get(`${p.listUrl ?? p.url}${p.query ?? ''}`), [p.url, p.listUrl, p.query]);
  const [editing, setEditing] = useState<R | null>(null);
  const [form, setForm] = useState<F | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<R | null>(null);
  const itemUrl = p.itemUrl ?? ((r: R) => `${p.url}/${r.id}`);
  const rows: R[] = (p.rowsFrom && list.data ? p.rowsFrom(list.data) : (list.data?.[p.listKey ?? 'items'] as R[])) ?? [];
  const shown = p.filter ? p.filter(rows) : rows;

  const open = (row: R | null) => {
    setEditing(row);
    setForm(row ? p.toForm(row) : p.empty());
    setErr(null);
  };
  const set = (patch: Partial<F>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErr(null);
    try {
      const body = p.toBody(form, editing);
      const r = editing ? await put(itemUrl(editing), body) : await post(p.url, body);
      toast('บันทึกแล้ว', 'success');
      p.onSaved?.(r, editing);
      setForm(null);
      list.reload();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={p.title}
      actions={
        <div className="row">
          {p.headerActions}
          {p.canEdit !== false && (
            <Button variant="primary" size="sm" onClick={() => open(null)}>
              + เพิ่ม
            </Button>
          )}
        </div>
      }
    >
      {list.error && <div style={{ color: 'var(--color-danger)' }}>{list.error}</div>}
      {list.loading && !list.data ? (
        <Empty>กำลังโหลด…</Empty>
      ) : !shown.length ? (
        <Empty />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {p.columns.map((c, i) => (
                  <th key={i}>{c.label}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={p.rowKey ? p.rowKey(r) : (r.id ?? i)}>
                  {p.columns.map((c, j) => (
                    <td key={j} className={c.className}>
                      {c.render(r)}
                    </td>
                  ))}
                  <td className="right nowrap">
                    {p.actions?.(r, list.reload)}
                    {p.canEdit !== false && (
                      <Button size="sm" onClick={() => open(r)}>
                        แก้ไข
                      </Button>
                    )}
                    {p.canDelete !== false && (
                      <Button size="sm" variant="ghost" onClick={() => setToDelete(r)}>
                        {p.deleteLabel ?? 'ลบ'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!form}
        size="lg"
        title={editing ? 'แก้ไข' : 'เพิ่มใหม่'}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>ยกเลิก</Button>
            <Button variant="primary" loading={busy} onClick={save}>
              บันทึก
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid grid-2">
            {p.fields
              .filter((f) => !(f.createOnly && editing) && (!f.show || f.show(form)))
              .map((f) => (
                <div key={f.key} style={f.wide || f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
                  <FieldInput field={f} form={form} set={set} />
                </div>
              ))}
            {err && <div style={{ gridColumn: '1 / -1', color: 'var(--color-danger)' }}>{err}</div>}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="ยืนยันการลบ / ปิดใช้งาน"
        message="รายการนี้จะถูกปิดใช้งานและบันทึกใน Audit Log"
        danger
        confirmText={p.deleteLabel ?? 'ลบ'}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          try {
            await del(itemUrl(toDelete!));
            toast('ลบแล้ว', 'success');
            list.reload();
          } catch (e) {
            toast(errorText(e), 'error');
          }
        }}
      />
    </Card>
  );
}

function FieldInput<F extends Record<string, any>>({ field: f, form, set }: { field: FieldDef<F>; form: F; set: (p: Partial<F>) => void }) {
  const v = form[f.key];
  const upd = (val: unknown) => set({ [f.key]: val } as Partial<F>);
  if (f.type === 'custom' && f.render) return <Field label={f.label} hint={f.hint}>{f.render(form, set)}</Field>;
  if (f.type === 'check') return <Check label={f.label} checked={!!v} onChange={upd} />;
  let input: ReactNode;
  switch (f.type) {
    case 'number':
      input = <Input type="number" value={v ?? ''} onChange={(e) => upd(e.target.value === '' ? null : Number(e.target.value))} />;
      break;
    case 'select':
      input = <Select value={v ?? ''} onChange={(e) => upd(e.target.value)} options={f.options ?? []} />;
      break;
    case 'datetime':
      input = <Input type="datetime-local" value={toLocalInput(v)} onChange={(e) => upd(fromLocalInput(e.target.value))} />;
      break;
    case 'date':
      input = <Input type="date" value={v ?? ''} onChange={(e) => upd(e.target.value || null)} />;
      break;
    case 'time':
      input = <Input type="time" value={v ?? ''} onChange={(e) => upd(e.target.value || null)} />;
      break;
    case 'textarea':
      input = <TextArea value={v ?? ''} onChange={(e) => upd(e.target.value)} />;
      break;
    case 'province':
      input = <ProvinceSelect value={v} onChange={upd} />;
      break;
    case 'password':
      input = <Input type="password" autoComplete="new-password" value={v ?? ''} placeholder={f.placeholder} onChange={(e) => upd(e.target.value)} />;
      break;
    default:
      input = <Input value={v ?? ''} placeholder={f.placeholder} onChange={(e) => upd(e.target.value)} />;
  }
  return (
    <Field label={f.label} hint={f.hint}>
      {input}
    </Field>
  );
}

export const activeBadge = (a: number | boolean) => (a ? <span className="badge badge-success">ใช้งาน</span> : <span className="badge">ปิด</span>);

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocketEvents } from '../../lib/useSocket';
import { dateTime } from '../../lib/format';
import { Badge, Button, Empty, errorText, Field, Input, Pagination, Select, useAsync, useToast } from '../../components/ui';
import { JsonDiff } from '../../components/ops/JsonDiff';
import { debounce, downloadAuthed, localDate } from '../../components/ops/download';
import { DEVICE_TYPE, label } from '../../components/ops/labels';

interface AuditRow {
  id: number;
  at: string;
  username: string;
  role: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  siteName: string | null;
  deviceId: number | null;
  deviceName: string | null;
  deviceType: string | null;
  merchantId: number | null;
  merchantName: string | null;
  sessionId: number | null;
  parkingNo: string | null;
  receiptNo: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  approvedByName: string | null;
  ip: string | null;
  meta: unknown;
}

const LIMIT = 50;
const EMPTY = { from: '', to: '', action: '', username: '', parkingNo: '', receiptNo: '', merchantId: '', q: '' };

/** Actions that change money, access or identity — highlighted in the list. */
const SENSITIVE = /waive|manual_discount|manual_open|refund|plate|province|override|void|force_close|cancel|apply|rollback|lost_ticket|reprint|permission|role/;

export default function AuditLog() {
  const { can } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState(EMPTY);
  const [f, setF] = useState(EMPTY);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [fresh, setFresh] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);

  const applySoon = useMemo(() => debounce((next: typeof EMPTY) => (setF(next), setOffset(0)), 400), []);
  useEffect(() => () => applySoon.cancel(), [applySoon]);
  const set = (k: keyof typeof EMPTY, v: string, immediate = false) => {
    const next = { ...draft, [k]: v };
    setDraft(next);
    if (immediate) (applySoon.cancel(), setF(next), setOffset(0));
    else applySoon(next);
  };

  const query = qs({ ...f, limit: LIMIT, offset });
  const list = useAsync(() => get<{ total: number; items: AuditRow[] }>(`/api/reports/audit${query}`), [query]);
  const actions = useAsync(() => get<{ items: Array<{ action: string; n: number }> }>('/api/reports/audit/actions').then((r) => r.items), []);
  useEffect(() => setFresh(0), [list.data]);
  useSocketEvents({ 'audit:new': () => setFresh((n) => n + 1) });

  const groups = useMemo(() => [...new Set((actions.data ?? []).map((a) => a.action.split('.')[0]))], [actions.data]);

  const exportFile = async (format: 'csv' | 'xlsx') => {
    setExporting(format);
    try {
      const { from, to, ...rest } = f;
      // The export endpoint needs a range; default to the last 10 years when none is set.
      await downloadAuthed('/api/reports/export', { type: 'audit', format, from: from || localDate(-3650), to: to || undefined, ...rest }, `audit.${format}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">Audit Log</h1>
        {list.data && <span className="small muted">{list.data.total.toLocaleString()} รายการ</span>}
        <div className="actions">
          {fresh > 0 && offset === 0 && (
            <Button size="sm" variant="secondary" onClick={list.reload}>
              มีรายการใหม่ {fresh} — โหลด
            </Button>
          )}
          <Button size="sm" onClick={() => (setDraft(EMPTY), setF(EMPTY), setOffset(0))}>
            ล้างตัวกรอง
          </Button>
          {can('reports.export') && (
            <>
              <Button size="sm" loading={exporting === 'csv'} onClick={() => exportFile('csv')}>
                ส่งออก CSV
              </Button>
              <Button size="sm" loading={exporting === 'xlsx'} onClick={() => exportFile('xlsx')}>
                ส่งออก XLSX
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="card filters">
        <Field label="ค้นหา">
          <Input value={draft.q} placeholder="ข้อความ / ค่าก่อน-หลัง / เหตุผล" onChange={(e) => set('q', e.target.value)} />
        </Field>
        <Field label="ตั้งแต่วันที่">
          <Input type="date" value={draft.from} onChange={(e) => set('from', e.target.value, true)} />
        </Field>
        <Field label="ถึง">
          <Input type="date" value={draft.to} onChange={(e) => set('to', e.target.value, true)} />
        </Field>
        <Field label="การกระทำ">
          <select className="input" value={draft.action} onChange={(e) => set('action', e.target.value, true)}>
            <option value="">ทั้งหมด</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                <option value={`${g}.*`}>{g}.* (ทั้งหมวด)</option>
                {(actions.data ?? [])
                  .filter((a) => a.action.split('.')[0] === g)
                  .map((a) => (
                    <option key={a.action} value={a.action}>
                      {a.action} ({a.n})
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="ผู้ใช้ / ผู้อนุมัติ">
          <Input value={draft.username} onChange={(e) => set('username', e.target.value)} />
        </Field>
        <Field label="Parking No">
          <Input value={draft.parkingNo} onChange={(e) => set('parkingNo', e.target.value)} />
        </Field>
        <Field label="เลขที่ใบเสร็จ">
          <Input value={draft.receiptNo} onChange={(e) => set('receiptNo', e.target.value)} />
        </Field>
        <Field label="รหัสร้านค้า (ID)">
          <Input value={draft.merchantId} inputMode="numeric" onChange={(e) => set('merchantId', e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>

      {list.error && <div className="card" style={{ color: 'var(--color-danger)' }}>{list.error}</div>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>เวลา</th>
              <th>ผู้ใช้</th>
              <th>การกระทำ</th>
              <th>อ้างอิง</th>
              <th>เหตุผล</th>
              <th>ผู้อนุมัติ</th>
              <th>อุปกรณ์ / ร้าน</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((a) => (
              <Fragment key={a.id}>
                <tr className="clickable" onClick={() => setOpen(open === a.id ? null : a.id)}>
                  <td className="small nowrap">{dateTime(a.at)}</td>
                  <td className="small">
                    {a.username}
                    {a.role && <div className="muted">{a.role}</div>}
                  </td>
                  <td>
                    <span className="mono small">
                      {open === a.id ? '▾' : '▸'} {a.action}
                    </span>
                    {SENSITIVE.test(a.action) && (
                      <>
                        {' '}
                        <Badge tone="warning">สำคัญ</Badge>
                      </>
                    )}
                  </td>
                  <td className="small" onClick={(e) => e.stopPropagation()}>
                    {a.parkingNo && (a.sessionId ? <Link to={`/admin/sessions/${a.sessionId}`} className="mono">{a.parkingNo}</Link> : <span className="mono">{a.parkingNo}</span>)}
                    {a.receiptNo && <div className="mono">{a.receiptNo}</div>}
                    {!a.parkingNo && !a.receiptNo && (a.entityType ? <span className="muted">{[a.entityType, a.entityId].filter(Boolean).join(':')}</span> : '-')}
                  </td>
                  <td className="small">{a.reason ?? '-'}</td>
                  <td className="small">{a.approvedByName ?? '-'}</td>
                  <td className="small">
                    {a.deviceName ? `${a.deviceName}${a.deviceType ? ` (${label(DEVICE_TYPE, a.deviceType)})` : ''}` : '-'}
                    {a.merchantName && <div className="muted">{a.merchantName}</div>}
                  </td>
                </tr>
                {open === a.id && (
                  <tr>
                    <td colSpan={7} style={{ background: 'color-mix(in srgb, var(--color-bg) 60%, transparent)' }}>
                      <div className="col" style={{ gap: 8 }}>
                        <div className="small muted">
                          #{a.id} · {a.entityType ?? '-'}:{a.entityId ?? '-'} {a.siteName ? `· ${a.siteName}` : ''} {a.ip ? `· IP ${a.ip}` : ''}
                        </div>
                        <JsonDiff before={a.before} after={a.after} />
                        {a.meta != null && (
                          <details>
                            <summary className="small">ข้อมูลเพิ่มเติม (meta)</summary>
                            <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                              {JSON.stringify(a.meta, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {list.data && !list.data.items.length && <Empty>ไม่พบรายการ</Empty>}
        {!list.data && list.loading && <div className="page-loading">กำลังโหลด…</div>}
      </div>
      {list.data && <Pagination total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
    </>
  );
}

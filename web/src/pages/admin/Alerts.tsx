import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocketEvents } from '../../lib/useSocket';
import { dateTime } from '../../lib/format';
import { Badge, Button, Empty, errorText, Field, Pagination, Select, useAsync, useToast } from '../../components/ui';
import { debounce } from '../../components/ops/download';
import { ALERT_TYPE, alertLink, label, SEVERITY } from '../../components/ops/labels';

interface Alert {
  id: number;
  type: string;
  severity: string;
  siteName: string | null;
  refType: string | null;
  refId: string | null;
  message: string;
  createdAt: string;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

const LIMIT = 50;

export default function Alerts() {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => setOffset(0), [status, type, severity]);

  const query = qs({ status, type, severity, limit: LIMIT, offset });
  const list = useAsync(() => get<{ total: number; items: Alert[]; types: string[] }>(`/api/reports/alerts${query}`), [query]);
  const refresh = useMemo(() => debounce(() => list.reload(), 800), [list.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => refresh.cancel(), [refresh]);
  useSocketEvents({ 'alert:new': refresh, 'alert:resolved': refresh });

  const act = async (a: Alert, action: 'ack' | 'resolve') => {
    setBusy(a.id);
    try {
      await post(`/api/reports/alerts/${a.id}/${action}`);
      toast(action === 'ack' ? 'รับทราบแล้ว' : 'ปิดการแจ้งเตือนแล้ว', 'success');
      await list.reload();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const types = [...new Set([...(list.data?.types ?? []), ...Object.keys(ALERT_TYPE)])];

  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">การแจ้งเตือน</h1>
        {list.data && <span className="small muted">{list.data.total.toLocaleString()} รายการ</span>}
      </div>
      <div className="card filters">
        <Field label="สถานะ">
          <Select
            value={status}
            options={[
              { value: 'open', label: 'ยังไม่ปิด' },
              { value: 'resolved', label: 'ปิดแล้ว' },
              { value: 'all', label: 'ทั้งหมด' },
            ]}
            onChange={(e) => setStatus(e.target.value)}
          />
        </Field>
        <Field label="ประเภท">
          <Select value={type} placeholder="ทั้งหมด" options={types.map((t) => ({ value: t, label: label(ALERT_TYPE, t) }))} onChange={(e) => setType(e.target.value)} />
        </Field>
        <Field label="ความรุนแรง">
          <Select value={severity} placeholder="ทั้งหมด" options={Object.entries(SEVERITY).map(([value, l]) => ({ value, label: l }))} onChange={(e) => setSeverity(e.target.value)} />
        </Field>
      </div>
      {list.error && <div className="card" style={{ color: 'var(--color-danger)' }}>{list.error}</div>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ความรุนแรง</th>
              <th>ข้อความ</th>
              <th>เวลา</th>
              <th>สถานะ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((a) => {
              const to = alertLink(a);
              return (
                <tr key={a.id} style={a.resolvedAt ? { opacity: 0.65 } : undefined}>
                  <td>
                    <Badge>{a.severity}</Badge>
                    <div className="small muted">{label(SEVERITY, a.severity)}</div>
                  </td>
                  <td>
                    {to ? <Link to={to}>{a.message}</Link> : a.message}
                    <div className="small muted">
                      {label(ALERT_TYPE, a.type)}
                      {a.siteName ? ` · ${a.siteName}` : ''}
                    </div>
                  </td>
                  <td className="small nowrap">{dateTime(a.createdAt)}</td>
                  <td className="small">
                    {a.resolvedAt ? (
                      <>
                        <Badge tone="success">ปิดแล้ว</Badge>
                        <div className="muted">{dateTime(a.resolvedAt)}</div>
                      </>
                    ) : a.acknowledgedAt ? (
                      <>
                        <Badge tone="info">รับทราบแล้ว</Badge>
                        <div className="muted">
                          {a.acknowledgedByName ?? ''} {dateTime(a.acknowledgedAt)}
                        </div>
                      </>
                    ) : (
                      <Badge tone="warning">ใหม่</Badge>
                    )}
                  </td>
                  <td>
                    {!a.resolvedAt && can('alerts.manage') && (
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        {!a.acknowledgedAt && (
                          <Button size="sm" loading={busy === a.id} onClick={() => act(a, 'ack')}>
                            รับทราบ
                          </Button>
                        )}
                        <Button size="sm" variant="primary" loading={busy === a.id} onClick={() => act(a, 'resolve')}>
                          ปิด
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.data && !list.data.items.length && <Empty>ไม่มีการแจ้งเตือน</Empty>}
      </div>
      {list.data && <Pagination total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
    </>
  );
}

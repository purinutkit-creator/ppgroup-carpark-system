import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, qs } from '../../lib/api';
import { useSocketEvents } from '../../lib/useSocket';
import { dateTime, durationText, money } from '../../lib/format';
import { Badge, Button, Empty, Field, Input, PlateBadge, Pagination, ProvinceSelect, Select, useAsync } from '../../components/ui';
import { debounce, localDate } from '../../components/ops/download';
import { FLAG, label, PAYMENT_STATUS, SESSION_STATUS, VEHICLE_TYPES } from '../../components/ops/labels';

interface SessionRow {
  id: number;
  parkingNo: string;
  plateText: string | null;
  province: string | null;
  vehicleType: string;
  entryAt: string;
  exitAt: string | null;
  status: string;
  paymentStatus: string;
  ticketless: boolean;
  unreadPlate: boolean;
  lostTicket: boolean;
  exempt: boolean;
  flags: string[];
  entryGateId: number | null;
  exitGateId: number | null;
  due?: number;
  net?: number;
}

interface Gate {
  id: number;
  name: string;
  direction: string;
  devices: Array<{ id: number; type: string; name: string }>;
}

const LIMIT = 50;
const FILTER_KEYS = ['q', 'status', 'paymentStatus', 'province', 'gateId', 'cameraId', 'flag', 'fromDate', 'toDate'] as const;

/** YYYY-MM-DD (Bangkok) → ISO bounds. */
const dayStart = (d: string) => (d ? new Date(Date.parse(`${d}T00:00:00+07:00`)).toISOString() : undefined);
const dayEnd = (d: string) => (d ? new Date(Date.parse(`${d}T23:59:59.999+07:00`)).toISOString() : undefined);

export default function Sessions() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const offset = Number(params.get('offset') ?? 0);
  const [q, setQ] = useState(f.q);
  useEffect(() => setQ(f.q), [f.q]);

  const set = (patch: Partial<Record<string, string>>, keepOffset = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    if (!keepOffset) next.delete('offset');
    setParams(next, { replace: true });
  };

  const gates = useAsync(() => get<{ gates: Gate[] }>('/api/gates').then((r) => r.gates), []);
  const cameras = (gates.data ?? []).flatMap((g) => g.devices.filter((d) => d.type === 'CAMERA'));
  const gateName = (id: number | null) => (gates.data ?? []).find((g) => g.id === id)?.name ?? '-';

  const query = qs({
    q: f.q,
    status: f.status,
    paymentStatus: f.paymentStatus,
    province: f.province,
    gateId: f.gateId,
    cameraId: f.cameraId,
    flag: f.flag,
    from: dayStart(f.fromDate),
    to: dayEnd(f.toDate),
    limit: LIMIT,
    offset,
  });
  const list = useAsync(() => get<{ total: number; items: SessionRow[] }>(`/api/sessions${query}`), [query]);
  const refresh = useMemo(() => debounce(() => list.reload(), 2000), [list.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => refresh.cancel(), [refresh]);
  useSocketEvents({ 'session:update': refresh });

  const searchSoon = useMemo(() => debounce((v: string) => set({ q: v }), 400), [params]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">รายการจอดรถ</h1>
        <span className="small muted">{list.data ? `${list.data.total.toLocaleString()} รายการ` : ''}</span>
        <div className="actions">
          <Button size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            ล้างตัวกรอง
          </Button>
          <Button size="sm" onClick={() => set({ status: 'ACTIVE', paymentStatus: '', fromDate: '', toDate: '' })}>
            รถในลานขณะนี้
          </Button>
          <Button size="sm" onClick={() => set({ fromDate: localDate(), toDate: localDate() })}>
            เข้าวันนี้
          </Button>
        </div>
      </div>

      <div className="card filters">
        <Field label="ทะเบียน / เลขบัตรจอด">
          <Input
            value={q}
            placeholder="เช่น กข1234 หรือ PK2026…"
            onChange={(e) => {
              setQ(e.target.value);
              searchSoon(e.target.value.trim());
            }}
          />
        </Field>
        <Field label="วันที่เข้า (ตั้งแต่)">
          <Input type="date" value={f.fromDate} onChange={(e) => set({ fromDate: e.target.value })} />
        </Field>
        <Field label="ถึง">
          <Input type="date" value={f.toDate} onChange={(e) => set({ toDate: e.target.value })} />
        </Field>
        <Field label="สถานะ">
          <Select value={f.status} placeholder="ทั้งหมด" options={Object.entries(SESSION_STATUS).map(([value, l]) => ({ value, label: l }))} onChange={(e) => set({ status: e.target.value })} />
        </Field>
        <Field label="การชำระ">
          <Select value={f.paymentStatus} placeholder="ทั้งหมด" options={Object.entries(PAYMENT_STATUS).map(([value, l]) => ({ value, label: l }))} onChange={(e) => set({ paymentStatus: e.target.value })} />
        </Field>
        <Field label="จังหวัด">
          <ProvinceSelect value={f.province} onChange={(v) => set({ province: v ?? '' })} />
        </Field>
        <Field label="ทางเข้า/ออก">
          <Select value={f.gateId} placeholder="ทั้งหมด" options={(gates.data ?? []).map((g) => ({ value: g.id, label: g.name }))} onChange={(e) => set({ gateId: e.target.value })} />
        </Field>
        <Field label="กล้อง">
          <Select value={f.cameraId} placeholder="ทั้งหมด" options={cameras.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => set({ cameraId: e.target.value })} />
        </Field>
        <Field label="Flag">
          <Select value={f.flag} placeholder="ทั้งหมด" options={Object.entries(FLAG).map(([value, l]) => ({ value, label: l }))} onChange={(e) => set({ flag: e.target.value })} />
        </Field>
      </div>

      {list.error && <div className="card" style={{ color: 'var(--color-danger)' }}>{list.error}</div>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ทะเบียน</th>
              <th>เลขบัตรจอด</th>
              <th>เวลาเข้า</th>
              <th>เวลาออก / ระยะเวลา</th>
              <th>ทางเข้า</th>
              <th>สถานะ</th>
              <th className="right">ค้างชำระ</th>
              <th>หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((s) => {
              const seconds = (Date.parse(s.exitAt ?? new Date().toISOString()) - Date.parse(s.entryAt)) / 1000;
              return (
                <tr key={s.id} className="clickable" onClick={() => nav(`/admin/sessions/${s.id}`)}>
                  <td>
                    <PlateBadge plate={s.plateText} province={s.province} size={14} />
                  </td>
                  <td className="mono small" data-el="admin/common/table/cell">
                    {s.parkingNo}
                  </td>
                  <td className="small nowrap">{dateTime(s.entryAt)}</td>
                  <td className="small nowrap">
                    {s.exitAt ? dateTime(s.exitAt) : <span className="muted">ยังไม่ออก</span>}
                    <div className="muted">{durationText(seconds)}</div>
                  </td>
                  <td className="small">{gateName(s.entryGateId)}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <Badge tone={s.status === 'ACTIVE' ? 'info' : s.status === 'CANCELLED' ? 'danger' : ''}>{label(SESSION_STATUS, s.status)}</Badge>
                      <Badge tone={s.paymentStatus === 'UNPAID' ? 'warning' : 'success'}>{label(PAYMENT_STATUS, s.paymentStatus)}</Badge>
                    </div>
                  </td>
                  <td className="right num">{s.due != null ? s.due > 0 ? <b style={{ color: 'var(--color-danger)' }}>{money(s.due)}</b> : money(0) : '-'}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {s.vehicleType !== 'CAR' && <Badge>{VEHICLE_TYPES.find((v) => v.value === s.vehicleType)?.label ?? s.vehicleType}</Badge>}
                      {s.ticketless && <Badge tone="info">ไม่ใช้บัตร</Badge>}
                      {s.unreadPlate && <Badge tone="warning">อ่านป้ายไม่ได้</Badge>}
                      {s.lostTicket && <Badge tone="danger">บัตรหาย</Badge>}
                      {s.exempt && <Badge tone="success">ยกเว้น</Badge>}
                      {s.flags.map((fl) => (
                        <Badge key={fl} tone="warning">
                          {label(FLAG, fl)}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.data && !list.data.items.length && <Empty>ไม่พบรายการ</Empty>}
        {!list.data && list.loading && <div className="page-loading">กำลังโหลด…</div>}
      </div>
      {list.data && <Pagination total={list.data.total} limit={LIMIT} offset={offset} onChange={(o) => set({ offset: String(o) }, true)} />}
    </>
  );
}

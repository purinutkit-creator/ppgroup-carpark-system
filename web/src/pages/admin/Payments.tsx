import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, post, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocketEvents } from '../../lib/useSocket';
import { dateTime, money } from '../../lib/format';
import { ApprovalDialog, Badge, Button, Empty, Field, Input, Pagination, Select, Tabs, useAsync, useToast } from '../../components/ui';
import { CHANNEL, label, METHOD, PAYMENT_ROW_STATUS } from '../../components/ops/labels';

interface Payment {
  id: number;
  amount: number;
  method: string;
  gateway: string;
  status: string;
  channel: string | null;
  paidAt: string | null;
  createdAt: string;
  parkingNo: string;
  plateText: string | null;
  sessionId: number;
  needsRefund: boolean;
  refundedAmount: number;
  failureReason: string | null;
}

const LIMIT = 50;
const dayStart = (d: string) => (d ? new Date(Date.parse(`${d}T00:00:00+07:00`)).toISOString() : undefined);
const dayEnd = (d: string) => (d ? new Date(Date.parse(`${d}T23:59:59.999+07:00`)).toISOString() : undefined);

export default function Payments() {
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'all' | 'duplicates'>('all');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [resolve, setResolve] = useState<Payment | null>(null);
  useEffect(() => setOffset(0), [tab, status, method, from, to]);

  const query = qs({ status: tab === 'all' ? status : '', method, from: dayStart(from), to: dayEnd(to), needsRefund: tab === 'duplicates' ? 1 : '', limit: LIMIT, offset });
  const list = useAsync(() => get<{ total: number; items: Payment[] }>(`/api/payments${query}`), [query]);
  const dupCount = useAsync(() => get<{ total: number }>('/api/payments?needsRefund=1&limit=1').then((r) => r.total), []);
  useSocketEvents({
    'alert:new': (a: { type?: string }) => {
      if (a?.type === 'DUPLICATE_PAYMENT') (dupCount.reload(), list.reload());
    },
  });

  const items = list.data?.items ?? [];
  const pageSum = items.filter((p) => p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED' || p.status === 'REFUNDED').reduce((a, p) => a + p.amount - p.refundedAmount, 0);

  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">การชำระเงิน</h1>
        {list.data && <span className="small muted">{list.data.total.toLocaleString()} รายการ</span>}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'all', label: 'ทั้งหมด' },
          {
            id: 'duplicates',
            label: (
              <span>
                ชำระซ้ำ ต้องคืนเงิน {dupCount.data ? <Badge tone="danger">{dupCount.data}</Badge> : null}
              </span>
            ),
          },
        ]}
      />
      <div className="card filters">
        {tab === 'all' && (
          <Field label="สถานะ">
            <Select value={status} placeholder="ทั้งหมด" options={Object.entries(PAYMENT_ROW_STATUS).map(([value, l]) => ({ value, label: l }))} onChange={(e) => setStatus(e.target.value)} />
          </Field>
        )}
        <Field label="วิธีชำระ">
          <Select value={method} placeholder="ทั้งหมด" options={['CASH', 'PROMPTPAY', 'CARD', 'EWALLET'].map((m) => ({ value: m, label: label(METHOD, m) }))} onChange={(e) => setMethod(e.target.value)} />
        </Field>
        <Field label="ตั้งแต่วันที่">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="ถึง">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <span className="spacer" />
        <span className="small muted">ยอดสุทธิในหน้านี้ {money(pageSum)}</span>
      </div>
      {tab === 'duplicates' && <div className="small muted">รายการที่ลูกค้าชำระซ้ำ (เช่น สแกน QR สองครั้ง) — เปิดรายการจอดเพื่อคืนเงินพร้อมผู้อนุมัติ แล้วกด "ดำเนินการแล้ว"</div>}
      {list.error && <div className="card" style={{ color: 'var(--color-danger)' }}>{list.error}</div>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>เวลา</th>
              <th>รายการจอด</th>
              <th>วิธี / ช่องทาง</th>
              <th className="right">จำนวน</th>
              <th>สถานะ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => nav(`/admin/sessions/${p.sessionId}`)}>
                <td className="small">{p.id}</td>
                <td className="small nowrap">
                  {dateTime(p.paidAt ?? p.createdAt)}
                  {!p.paidAt && <div className="muted">สร้างรายการ</div>}
                </td>
                <td>
                  <span className="mono small">{p.parkingNo}</span>
                  <div className="small">{p.plateText ?? '-'}</div>
                </td>
                <td className="small">
                  {label(METHOD, p.method)}
                  <div className="muted">
                    {label(CHANNEL, p.channel)} · {p.gateway}
                  </div>
                </td>
                <td className="right num">
                  {money(p.amount)}
                  {p.refundedAmount > 0 && <div className="small" style={{ color: 'var(--color-danger)' }}>คืน {money(p.refundedAmount)}</div>}
                </td>
                <td>
                  <Badge>{p.status}</Badge>
                  <div className="small muted">{label(PAYMENT_ROW_STATUS, p.status)}</div>
                  {p.needsRefund && <Badge tone="danger">ชำระซ้ำ</Badge>}
                  {p.failureReason && <div className="small" style={{ color: 'var(--color-danger)' }}>{p.failureReason}</div>}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    <Link to={`/admin/sessions/${p.sessionId}`} className="btn btn-sm">
                      เปิดรายการ
                    </Link>
                    {p.needsRefund && can('payment.refund_approve') && (
                      <Button size="sm" variant="primary" onClick={() => setResolve(p)}>
                        ดำเนินการแล้ว
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && !items.length && <Empty>{tab === 'duplicates' ? 'ไม่มีรายการชำระซ้ำ' : 'ไม่พบรายการ'}</Empty>}
      </div>
      {list.data && <Pagination total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}

      <ApprovalDialog
        open={!!resolve}
        title={`ปิดรายการชำระซ้ำ #${resolve?.id ?? ''}`}
        description="ยืนยันว่าได้คืนเงินลูกค้าแล้ว (หรือไม่ต้องคืน) — บันทึกใน Audit Log"
        onClose={() => setResolve(null)}
        onSubmit={async (v) => {
          await post(`/api/payments/${resolve!.id}/mark-refunded`, v);
          toast('บันทึกแล้ว', 'success');
          list.reload();
          dupCount.reload();
        }}
      />
    </>
  );
}

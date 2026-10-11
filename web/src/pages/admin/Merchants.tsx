import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, qs } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { Badge, Empty, Input, Pagination, Tabs, useAsync } from '../../components/ui';
import { MERCHANT_CATEGORIES, MERCHANT_STATUS_LABEL } from '../../components/pos/types';

type Tab = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'ALL';
const LIMIT = 50;

interface Row {
  id: number;
  code: string | null;
  name: string;
  status: string;
  category: string | null;
  unit_no: string | null;
  floor: string | null;
  phone: string;
  email: string;
  owner_first_name: string;
  owner_last_name: string;
  logo_url: string | null;
  pos_enabled: number;
  validation_enabled: number;
  branch_count: number;
  sales_30d: number;
  reference: string;
  created_at: string;
}

const catLabel = (c: string | null) => MERCHANT_CATEGORIES.find((x) => x.value === c)?.label ?? c ?? '-';

export default function Merchants() {
  const [tab, setTab] = useState<Tab>('PENDING');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const nav = useNavigate();
  const { data, error, loading } = useAsync(
    () => get<{ items: Row[]; total: number; counts: Record<string, number> }>(`/api/merchants${qs({ status: tab === 'ALL' ? '' : tab, q, limit: LIMIT, offset })}`),
    [tab, q, offset],
  );
  const c = data?.counts ?? {};
  const label = (t: Tab, text: string) => `${text}${t === 'ALL' ? '' : c[t] ? ` (${c[t]})` : ''}`;
  return (
    <>
      <div className="page-header">
        <h1>ร้านค้า (Merchants)</h1>
        <div className="actions">
          <Link to="/merchant/register" className="btn" target="_blank">
            ฟอร์มสมัครร้านค้า ↗
          </Link>
        </div>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={(t) => {
          setTab(t);
          setOffset(0);
        }}
        tabs={[
          { id: 'PENDING', label: label('PENDING', 'รออนุมัติ') },
          { id: 'ACTIVE', label: label('ACTIVE', 'ใช้งาน') },
          { id: 'SUSPENDED', label: label('SUSPENDED', 'ระงับ') },
          { id: 'CLOSED', label: label('CLOSED', 'ปิดร้าน') },
          { id: 'ALL', label: 'ทั้งหมด' },
        ]}
      />
      <div className="filters">
        <Input
          placeholder="ค้นหา ชื่อร้าน / Merchant ID / โทร / อีเมล / ห้อง"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          style={{ minWidth: 320 }}
        />
        {tab === 'ALL' && c.APPROVED ? <span className="small muted">อนุมัติแล้วรอเปิดใช้งาน: {c.APPROVED}</span> : null}
      </div>
      {error && <div className="card" style={{ color: 'var(--color-danger)' }}>{error}</div>}
      <div className="card" style={{ padding: 0 }}>
        {loading && !data ? (
          <Empty>กำลังโหลด…</Empty>
        ) : !data?.items.length ? (
          <Empty>ไม่มีร้านค้าในสถานะนี้</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ร้านค้า</th>
                  <th>Merchant ID</th>
                  <th>ประเภท</th>
                  <th>ห้อง / ชั้น</th>
                  <th>เจ้าของ</th>
                  <th>สถานะ</th>
                  <th>POS / สิทธิ์จอด</th>
                  <th className="right">ยอดขาย 30 วัน</th>
                  <th>สมัครเมื่อ</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((m) => (
                  <tr key={m.id} onClick={() => nav(`/admin/merchants/${m.id}`)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        {m.logo_url ? <img src={m.logo_url} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} /> : <span style={{ width: 32 }}>🏪</span>}
                        <div>
                          <div style={{ fontWeight: 600 }}>{m.name}</div>
                          <div className="small muted">{m.reference}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{m.code ?? '-'}</td>
                    <td>{catLabel(m.category)}</td>
                    <td>
                      {m.unit_no ?? '-'}
                      {m.floor ? ` / ชั้น ${m.floor}` : ''}
                    </td>
                    <td>
                      {m.owner_first_name} {m.owner_last_name}
                      <div className="small muted">{m.phone}</div>
                    </td>
                    <td>
                      <Badge>{m.status}</Badge>
                      <div className="small muted">{MERCHANT_STATUS_LABEL[m.status]}</div>
                    </td>
                    <td className="small">
                      {m.pos_enabled ? 'POS ✓' : 'POS ✕'} · {m.validation_enabled ? 'จอด ✓' : 'จอด ✕'}
                    </td>
                    <td className="right num">{money(m.sales_30d)}</td>
                    <td className="nowrap small">{dateTime(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data && <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
    </>
  );
}

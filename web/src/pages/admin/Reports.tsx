import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, minutesText, money, num } from '../../lib/format';
import { DesignProvider } from '../../design/DesignProvider';
import { Badge, Button, Card, Empty, errorText, Field, Input, Select, Tabs, useAsync, useToast } from '../../components/ui';
import { ColumnChart, LineChart } from '../../components/ops/charts';
import { downloadAuthed, localDate } from '../../components/ops/download';
import { DISCOUNT_TYPE, label, METHOD } from '../../components/ops/labels';

type Group = 'day' | 'month' | 'year';
type Tab = 'summary' | 'validations' | 'exemptions';

interface SummaryRow {
  period: string;
  entries: number;
  exits: number;
  revenue: number;
  revenueByMethod: Record<string, number>;
  refunds: number;
  netRevenue: number;
  avgDurationMinutes: number | null;
  validations: number;
  validatedSpend: number;
  discountValue: number;
  waivers: number;
  manualDiscounts: number;
  lostTickets: number;
}
interface Summary {
  from: string;
  to: string;
  items: SummaryRow[];
  totals: Omit<SummaryRow, 'period'>;
}
interface Validations {
  items: Array<{ merchantId: number | null; code: string | null; name: string; receipts: number; validated: number; refundedAfter: number; revoked: number; external: number; spend: number; discountValue: number; sessions: number }>;
  totals: { receipts: number; spend: number; discountValue: number; sessions: number };
}
interface ExemptRow {
  id: number;
  at: string;
  type: string;
  sessionId: number;
  parkingNo: string;
  plateText: string | null;
  province: string | null;
  amount: number;
  freeMinutes: number;
  fullWaiver: boolean;
  value: number | null;
  reason: string | null;
  status: string;
  createdBy: string | null;
  approvedBy: string | null;
}
interface SessionExempt {
  sessionId: number;
  parkingNo: string;
  plateText: string | null;
  province: string | null;
  entryAt: string;
  status: string;
  passType: string | null;
  holder: string | null;
  reason: string;
}
interface Exemptions {
  totals: { waivers: number; manualDiscounts: number; manualDiscountValue: number; exemptSessions: number; passSessions: number };
  waivers: ExemptRow[];
  manualDiscounts: ExemptRow[];
  exemptSessions: SessionExempt[];
  passSessions: SessionExempt[];
}

const PRESETS: Array<{ id: string; label: string; range: () => [string, string]; group: Group }> = [
  { id: 'today', label: 'วันนี้', range: () => [localDate(), localDate()], group: 'day' },
  { id: '7d', label: '7 วัน', range: () => [localDate(-6), localDate()], group: 'day' },
  { id: '30d', label: '30 วัน', range: () => [localDate(-29), localDate()], group: 'day' },
  { id: 'month', label: 'เดือนนี้', range: () => [`${localDate().slice(0, 7)}-01`, localDate()], group: 'day' },
  { id: 'year', label: 'ปีนี้', range: () => [`${localDate().slice(0, 4)}-01-01`, localDate()], group: 'month' },
];
const METHODS = ['CASH', 'PROMPTPAY', 'CARD', 'EWALLET'];
const GROUP_LABEL: Record<Group, string> = { day: 'รายวัน', month: 'รายเดือน', year: 'รายปี' };
const TH = 'reports/main/table/header';
const TD = 'reports/main/table/cell';

const PRINT_CSS = `@media print {
  .admin-nav, .admin-topbar, .no-print, .toasts { display: none !important; }
  .admin-shell { display: block !important; }
  .admin-content { padding: 0 !important; }
  .card { box-shadow: none !important; break-inside: avoid; }
  .table-wrap { overflow: visible !important; border: 0 !important; }
  .table th { position: static !important; }
  @page { size: A4 landscape; margin: 12mm; }
}`;

function periodLabel(p: string, g: Group) {
  if (g === 'day') return `${p.slice(8, 10)}/${p.slice(5, 7)}`;
  if (g === 'month') return `${p.slice(5, 7)}/${p.slice(0, 4)}`;
  return p;
}
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

function Stat({ label: l, value }: { label: string; value: string }) {
  return (
    <div className="card kpi">
      <span className="kpi-label" data-el="reports/main/kpi/label">
        {l}
      </span>
      <span className="kpi-value num" data-el="reports/main/kpi/value" style={{ fontSize: 22 }}>
        {value}
      </span>
    </div>
  );
}

export default function Reports() {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('summary');
  const [preset, setPreset] = useState('30d');
  const [from, setFrom] = useState(localDate(-29));
  const [to, setTo] = useState(localDate());
  const [group, setGroup] = useState<Group>('day');
  const [siteId, setSiteId] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);

  const sites = useAsync(
    () =>
      get<{ gates: Array<{ siteId: number; siteName: string }> }>('/api/gates')
        .then((r) => [...new Map(r.gates.map((g) => [g.siteId, g.siteName])).entries()].map(([value, l]) => ({ value, label: l })))
        .catch(() => []),
    [],
  );
  const params = { from, to, group, siteId };
  const query = qs(params);
  const summary = useAsync(() => (tab === 'summary' ? get<Summary>(`/api/reports/summary${query}`) : Promise.resolve(null)), [tab, query]);
  const vals = useAsync(() => (tab === 'validations' ? get<Validations>(`/api/reports/validations${query}`) : Promise.resolve(null)), [tab, query]);
  const ex = useAsync(() => (tab === 'exemptions' ? get<Exemptions>(`/api/reports/exemptions${query}`) : Promise.resolve(null)), [tab, query]);
  const current = tab === 'summary' ? summary : tab === 'validations' ? vals : ex;

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    const [f, t] = p.range();
    setPreset(id);
    setFrom(f);
    setTo(t);
    setGroup(p.group);
  };

  const exportFile = async (type: string, format: 'csv' | 'xlsx') => {
    setExporting(`${type}.${format}`);
    try {
      await downloadAuthed('/api/reports/export', { ...params, type, format }, `${type}.${format}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setExporting(null);
    }
  };

  const exportTypes = [
    { id: 'summary', label: 'สรุป' },
    { id: 'sessions', label: 'รายการจอด' },
    { id: 'payments', label: 'การชำระเงิน' },
    { id: 'validations', label: 'ประทับตรา' },
    { id: 'exemptions', label: 'ยกเว้น/ส่วนลด' },
    ...(can('audit.view') ? [{ id: 'audit', label: 'Audit Log' }] : []),
  ];

  const s = summary.data;
  const methodsUsed = s ? METHODS.filter((m) => s.items.some((r) => r.revenueByMethod[m])) : [];
  const siteName = sites.data?.find((x) => String(x.value) === siteId)?.label ?? 'ทุกสาขา';

  return (
    <DesignProvider system="reports">
      <style>{PRINT_CSS}</style>
      <div className="col" style={{ gap: 16 }}>
        <div className="page-header">
          <div className="col" style={{ gap: 2 }}>
            <h1 data-el="reports/main/header/title" style={{ margin: 0 }}>
              {tab === 'summary' ? `รายงานสรุป${GROUP_LABEL[group]}` : tab === 'validations' ? 'รายงานการประทับตราตามร้านค้า' : 'รายงานการยกเว้นและส่วนลด'}
            </h1>
            <span className="small muted" data-el="reports/main/header/subtitle">
              {fmtDay(from)} – {fmtDay(to)} · {siteName} · ออกรายงานเมื่อ {dateTime(new Date().toISOString())}
            </span>
          </div>
          <div className="actions no-print">
            <Button onClick={() => window.print()}>PDF / พิมพ์</Button>
          </div>
        </div>

        <div className="card col no-print" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="pill-tabs">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className={preset === p.id ? 'active' : ''} onClick={() => applyPreset(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="filters">
            <Field label="ตั้งแต่วันที่">
              <Input type="date" value={from} max={to} onChange={(e) => (setFrom(e.target.value), setPreset(''))} />
            </Field>
            <Field label="ถึง">
              <Input type="date" value={to} min={from} onChange={(e) => (setTo(e.target.value), setPreset(''))} />
            </Field>
            <Field label="จัดกลุ่ม">
              <Select value={group} options={(Object.keys(GROUP_LABEL) as Group[]).map((g) => ({ value: g, label: GROUP_LABEL[g] }))} onChange={(e) => setGroup(e.target.value as Group)} />
            </Field>
            {(sites.data?.length ?? 0) > 1 && (
              <Field label="สาขา">
                <Select value={siteId} placeholder="ทุกสาขา" options={sites.data ?? []} onChange={(e) => setSiteId(e.target.value)} />
              </Field>
            )}
          </div>
          {can('reports.export') && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="small muted">ส่งออก:</span>
              {exportTypes.map((t) => (
                <span key={t.id} className="row" style={{ gap: 2 }}>
                  <span className="small">{t.label}</span>
                  <Button size="sm" loading={exporting === `${t.id}.csv`} onClick={() => exportFile(t.id, 'csv')}>
                    CSV
                  </Button>
                  <Button size="sm" loading={exporting === `${t.id}.xlsx`} onClick={() => exportFile(t.id, 'xlsx')}>
                    XLSX
                  </Button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="no-print">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'summary', label: 'สรุปรายได้ & การใช้งาน' },
              { id: 'validations', label: 'ประทับตราตามร้านค้า' },
              { id: 'exemptions', label: 'ยกเว้น / ส่วนลด' },
            ]}
          />
        </div>

        {current.error && <div className="card" style={{ color: 'var(--color-danger)' }}>{current.error}</div>}
        {current.loading && !current.data && <div className="page-loading">กำลังโหลด…</div>}

        {tab === 'summary' && s && (
          <>
            <div className="grid grid-4">
              <Stat label="รายได้สุทธิ" value={money(s.totals.netRevenue)} />
              <Stat label="รถเข้า / ออก" value={`${num(s.totals.entries)} / ${num(s.totals.exits)}`} />
              <Stat label="เวลาจอดเฉลี่ย" value={s.totals.avgDurationMinutes != null ? minutesText(s.totals.avgDurationMinutes) : '-'} />
              <Stat label="มูลค่าส่วนลดรวม" value={money(s.totals.discountValue)} />
            </div>
            <div className="grid grid-2">
              <Card title="รายได้สุทธิ">
                <LineChart
                  ariaLabel="รายได้สุทธิตามช่วงเวลา"
                  name="รายได้สุทธิ"
                  data={s.items.map((r) => ({ label: periodLabel(r.period, group), tooltipLabel: r.period, value: r.netRevenue }))}
                  format={money}
                  labelEvery={Math.max(1, Math.ceil(s.items.length / 8))}
                />
              </Card>
              <Card title="รถเข้า–ออก">
                <ColumnChart
                  ariaLabel="จำนวนรถเข้าและออกตามช่วงเวลา"
                  series={[
                    { name: 'รถเข้า', color: '#1d4ed8' },
                    { name: 'รถออก', color: '#f59e0b' },
                  ]}
                  data={s.items.map((r) => ({ label: periodLabel(r.period, group), tooltipLabel: r.period, values: [r.entries, r.exits] }))}
                  format={(n) => `${num(n)} คัน`}
                  labelEvery={Math.max(1, Math.ceil(s.items.length / 8))}
                />
              </Card>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {['ช่วงเวลา', 'รถเข้า', 'รถออก', 'รายได้', ...methodsUsed.map((m) => label(METHOD, m)), 'คืนเงิน', 'สุทธิ', 'จอดเฉลี่ย', 'ประทับตรา', 'ยอดซื้อ', 'มูลค่าส่วนลด', 'ยกเว้น', 'ส่วนลด จนท.', 'บัตรหาย'].map((h, i) => (
                      <th key={h + i} data-el={TH} className={i ? 'right' : undefined}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...s.items, { ...s.totals, period: 'รวม' } as SummaryRow].map((r) => (
                    <tr key={r.period} style={r.period === 'รวม' ? { fontWeight: 700 } : undefined}>
                      <td data-el={TD}>{r.period === 'รวม' ? 'รวม' : group === 'day' ? fmtDay(r.period) : r.period}</td>
                      <td data-el={TD} className="right num">{num(r.entries)}</td>
                      <td data-el={TD} className="right num">{num(r.exits)}</td>
                      <td data-el={TD} className="right num">{money(r.revenue)}</td>
                      {methodsUsed.map((m) => (
                        <td key={m} data-el={TD} className="right num">
                          {money(r.revenueByMethod[m] ?? 0)}
                        </td>
                      ))}
                      <td data-el={TD} className="right num">{money(r.refunds)}</td>
                      <td data-el={TD} className="right num"><b>{money(r.netRevenue)}</b></td>
                      <td data-el={TD} className="right num">{r.avgDurationMinutes != null ? `${num(r.avgDurationMinutes)} นาที` : '-'}</td>
                      <td data-el={TD} className="right num">{num(r.validations)}</td>
                      <td data-el={TD} className="right num">{money(r.validatedSpend)}</td>
                      <td data-el={TD} className="right num">{money(r.discountValue)}</td>
                      <td data-el={TD} className="right num">{num(r.waivers)}</td>
                      <td data-el={TD} className="right num">{num(r.manualDiscounts)}</td>
                      <td data-el={TD} className="right num">{num(r.lostTickets)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="small muted">
              รายได้ = ยอดชำระที่สำเร็จตามเวลาชำระ หักเงินคืนตามวันที่คืนเงิน · มูลค่าส่วนลด = มูลค่าที่ระบบคำนวณ ณ เวลาที่ให้ส่วนลด (ไม่เกินค่าจอดสะสมขณะนั้น) · ช่วงเวลาตามเวลาประเทศไทย
            </div>
          </>
        )}

        {tab === 'validations' && vals.data && (
          <>
            <div className="grid grid-4">
              <Stat label="ใบเสร็จที่ใช้" value={num(vals.data.totals.receipts)} />
              <Stat label="ยอดซื้อรวม" value={money(vals.data.totals.spend)} />
              <Stat label="มูลค่าส่วนลด" value={money(vals.data.totals.discountValue)} />
              <Stat label="รายการจอดที่ได้สิทธิ์" value={num(vals.data.totals.sessions)} />
            </div>
            {vals.data.items.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      {['ร้านค้า', 'ใบเสร็จ', 'ใช้สิทธิ์', 'คืนเงินหลังใช้', 'ยกเลิก', 'ยอดซื้อ', 'มูลค่าส่วนลด', 'รายการจอด'].map((h, i) => (
                        <th key={h} data-el={TH} className={i ? 'right' : undefined}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vals.data.items.map((m) => (
                      <tr key={String(m.merchantId)}>
                        <td data-el={TD}>
                          {m.name} {m.code && <span className="small muted mono">{m.code}</span>}
                          {m.external > 0 && <div className="small muted">กรอกยอดเอง {m.external} ใบ</div>}
                        </td>
                        <td data-el={TD} className="right num">{num(m.receipts)}</td>
                        <td data-el={TD} className="right num">{num(m.validated)}</td>
                        <td data-el={TD} className="right num">{m.refundedAfter ? <Badge tone="danger">{m.refundedAfter}</Badge> : 0}</td>
                        <td data-el={TD} className="right num">{num(m.revoked)}</td>
                        <td data-el={TD} className="right num">{money(m.spend)}</td>
                        <td data-el={TD} className="right num">{money(m.discountValue)}</td>
                        <td data-el={TD} className="right num">{num(m.sessions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>ไม่มีการประทับตราในช่วงนี้</Empty>
            )}
            <div className="small muted">มูลค่าส่วนลดของแต่ละรายการถูกแบ่งให้ร้านค้าตามสัดส่วนยอดซื้อของใบเสร็จที่ใช้ร่วมกัน</div>
          </>
        )}

        {tab === 'exemptions' && ex.data && (
          <>
            <div className="grid grid-4">
              <Stat label="ยกเว้นค่าจอด" value={num(ex.data.totals.waivers)} />
              <Stat label="ส่วนลดโดยเจ้าหน้าที่" value={`${num(ex.data.totals.manualDiscounts)} · ${money(ex.data.totals.manualDiscountValue)}`} />
              <Stat label="รถยกเว้นค่าจอด (รายชื่อ)" value={num(ex.data.totals.exemptSessions)} />
              <Stat label="ผู้ถือบัตรจอด" value={num(ex.data.totals.passSessions)} />
            </div>
            <Card title="ยกเว้นค่าจอด / ส่วนลดโดยเจ้าหน้าที่">
              {[...ex.data.waivers, ...ex.data.manualDiscounts].length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        {['เวลา', 'ประเภท', 'รายการจอด', 'ส่วนลด', 'มูลค่า', 'เหตุผล', 'ผู้ทำ', 'ผู้อนุมัติ', 'สถานะ'].map((h) => (
                          <th key={h} data-el={TH}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...ex.data.waivers, ...ex.data.manualDiscounts]
                        .sort((a, b) => b.at.localeCompare(a.at))
                        .map((d) => (
                          <tr key={d.id}>
                            <td data-el={TD} className="small nowrap">{dateTime(d.at)}</td>
                            <td data-el={TD}>{label(DISCOUNT_TYPE, d.type)}</td>
                            <td data-el={TD}>
                              <Link to={`/admin/sessions/${d.sessionId}`} className="mono small">{d.parkingNo}</Link>
                              <div className="small">
                                {d.plateText ?? '-'} {d.province ?? ''}
                              </div>
                            </td>
                            <td data-el={TD} className="small">{d.fullWaiver ? 'ฟรีทั้งหมด' : [d.amount ? money(d.amount) : null, d.freeMinutes ? `+${minutesText(d.freeMinutes)}` : null].filter(Boolean).join(' · ')}</td>
                            <td data-el={TD} className="num">{d.value != null ? money(d.value) : '-'}</td>
                            <td data-el={TD} className="small">{d.reason ?? '-'}</td>
                            <td data-el={TD} className="small">{d.createdBy ?? '-'}</td>
                            <td data-el={TD} className="small">{d.approvedBy ?? '-'}</td>
                            <td data-el={TD}>
                              <Badge>{d.status}</Badge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>ไม่มีรายการ</Empty>
              )}
            </Card>
            <Card title="รถยกเว้นค่าจอด / ผู้ถือบัตรจอด">
              {[...ex.data.exemptSessions, ...ex.data.passSessions].length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        {['เวลาเข้า', 'รายการจอด', 'ทะเบียน', 'ประเภท', 'ผู้ถือบัตร', 'สถานะ'].map((h) => (
                          <th key={h} data-el={TH}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...ex.data.exemptSessions, ...ex.data.passSessions]
                        .sort((a, b) => b.entryAt.localeCompare(a.entryAt))
                        .map((r) => (
                          <tr key={r.sessionId}>
                            <td data-el={TD} className="small nowrap">{dateTime(r.entryAt)}</td>
                            <td data-el={TD}>
                              <Link to={`/admin/sessions/${r.sessionId}`} className="mono small">{r.parkingNo}</Link>
                            </td>
                            <td data-el={TD}>
                              {r.plateText ?? '-'} <span className="small muted">{r.province ?? ''}</span>
                            </td>
                            <td data-el={TD} className="small">{r.reason}</td>
                            <td data-el={TD} className="small">{r.holder ?? '-'}</td>
                            <td data-el={TD}>
                              <Badge>{r.status}</Badge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>ไม่มีรายการ</Empty>
              )}
            </Card>
          </>
        )}
      </div>
    </DesignProvider>
  );
}

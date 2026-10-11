import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocketEvents } from '../../lib/useSocket';
import { dateTime, minutesText, money, num, time } from '../../lib/format';
import { DesignProvider } from '../../design/DesignProvider';
import { Badge, Button, Card, Empty, Kpi, useAsync } from '../../components/ui';
import { ColumnChart, LineChart, OccupancyBar } from '../../components/ops/charts';
import { debounce } from '../../components/ops/download';
import { ALERT_TYPE, alertLink, DEVICE_TYPE, label, METHOD, SEVERITY } from '../../components/ops/labels';

interface SiteKpis {
  occupied: number;
  entries: number;
  exits: number;
  revenue: { gross: number; refunds: number; net: number; byMethod: Record<string, number> };
  outstanding: { count: number; amount: number };
  avgDurationMinutes: number | null;
  validations: { count: number; spend: number; discountValue: number };
  waivers: number;
  manualDiscounts: number;
  exemptSessions: number;
  pendingReviews: number;
}

interface DashboardData {
  generatedAt: string;
  today: { day: string; from: string; to: string };
  capacity: number;
  totals: SiteKpis;
  sites: Array<{ id: number; code: string; name: string; capacity: number; unzoned: number; zones: Array<{ id: number; name: string; capacity: number; used: number }>; kpis: SiteKpis }>;
  alerts: { bySeverity: Record<string, number>; open: Array<{ id: number; type: string; severity: string; message: string; createdAt: string; siteName: string | null; refType: string | null; refId: string | null }> };
  devices: { byStatus: Record<string, number>; problems: Array<{ id: number; type: string; name: string; status: string; last_seen_at: string | null; last_error: string | null; gate_name: string | null }> };
  hourly: Array<{ hour: number; entries: number; exits: number }>;
  revenue30d: Array<{ day: string; gross: number; refunds: number; net: number }>;
}

const EL = { value: 'dashboard/main/kpi/value', label: 'dashboard/main/kpi/label' };
const SECTION = 'dashboard/main/section/title';
const ENTRY_COLOR = '#1d4ed8';
const EXIT_COLOR = '#f59e0b';

export default function Dashboard() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useAsync(() => get<DashboardData>('/api/reports/dashboard'), []);
  const refresh = useMemo(() => debounce(() => reload(), 1500), [reload]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  // Outstanding amounts drift with the clock even without events.
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    timer.current = setInterval(() => reload(), 60_000);
    return () => clearInterval(timer.current);
  }, [reload]);
  const { connected } = useSocketEvents({
    'session:update': refresh,
    occupancy: refresh,
    'alert:new': refresh,
    'alert:resolved': refresh,
    'detection:new': refresh,
  });

  if (!data) return loading ? <div className="page-loading">กำลังโหลด…</div> : <Empty>{error}</Empty>;
  const t = data.totals;
  const occPct = data.capacity ? Math.round((t.occupied / data.capacity) * 100) : null;

  return (
    <DesignProvider system="dashboard">
      <div className="col" style={{ gap: 16 }}>
        <div className="page-header">
          <h1 data-el="admin/layout/header/title">Dashboard</h1>
          <span className="small muted">
            <span className={`dot ${connected ? 'dot-online' : 'dot-offline'}`} /> {connected ? 'Real-time' : 'ออฟไลน์'} · อัปเดต {time(data.generatedAt, true)}
          </span>
          <div className="actions">
            <Button size="sm" onClick={reload} loading={loading}>
              รีเฟรช
            </Button>
          </div>
        </div>

        <div className="grid grid-4">
          <Kpi el={EL} label="รถในลานขณะนี้" value={num(t.occupied)} hint={data.capacity ? `จาก ${num(data.capacity)} ช่อง${occPct != null ? ` · ${occPct}%` : ''}` : undefined} />
          <Kpi el={EL} label="รถเข้า / ออก วันนี้" value={`${num(t.entries)} / ${num(t.exits)}`} hint={t.avgDurationMinutes != null ? `จอดเฉลี่ย ${minutesText(t.avgDurationMinutes)}` : 'ยังไม่มีรถออกวันนี้'} />
          <Kpi
            el={EL}
            label="รายได้สุทธิวันนี้"
            value={money(t.revenue.net)}
            hint={
              Object.entries(t.revenue.byMethod)
                .map(([m, v]) => `${label(METHOD, m)} ${money(v)}`)
                .join(' · ') + (t.revenue.refunds ? ` · คืนเงิน ${money(t.revenue.refunds)}` : '') || 'ยังไม่มีรายการชำระ'
            }
          />
          <Kpi el={EL} label="ค้างชำระ (รถในลาน)" value={money(t.outstanding.amount)} hint={`${num(t.outstanding.count)} คัน`} />
          <Kpi el={EL} label="ประทับตราวันนี้" value={num(t.validations.count)} hint={`ยอดซื้อ ${money(t.validations.spend)} · มูลค่าส่วนลด ${money(t.validations.discountValue)}`} />
          <Kpi el={EL} label="ยกเว้น / ส่วนลดเจ้าหน้าที่" value={`${num(t.waivers)} / ${num(t.manualDiscounts)}`} hint={`รถยกเว้นค่าจอดเข้าวันนี้ ${num(t.exemptSessions)} คัน`} />
          <Kpi
            el={EL}
            label="แจ้งเตือนที่ยังเปิด"
            value={num(Object.values(data.alerts.bySeverity).reduce((a, b) => a + b, 0))}
            hint={['CRITICAL', 'WARNING', 'INFO'].map((s) => `${SEVERITY[s]} ${data.alerts.bySeverity[s] ?? 0}`).join(' · ')}
          />
          <Kpi
            el={EL}
            label="รอตรวจสอบป้ายทะเบียน"
            value={num(t.pendingReviews)}
            hint={can('lpr.review') && t.pendingReviews > 0 ? <Link to="/admin/review">ไปที่คิวตรวจสอบ →</Link> : 'ไม่มีรายการค้าง'}
          />
        </div>

        <div className="grid grid-2">
          <Card title={<span data-el={SECTION}>อัตราการใช้พื้นที่</span>}>
            <div className="col" style={{ gap: 14 }}>
              {data.sites.map((s) => (
                <div key={s.id} className="col" style={{ gap: 8 }}>
                  <OccupancyBar label={<b>{s.name}</b>} used={s.kpis.occupied} capacity={s.capacity} el="dashboard/main/occupancy/label" />
                  <div className="col" style={{ gap: 6, paddingLeft: 12 }}>
                    {s.zones.map((z) => (
                      <OccupancyBar key={z.id} label={z.name} used={z.used} capacity={z.capacity} el="dashboard/main/occupancy/label" />
                    ))}
                    {s.unzoned > 0 && <div className="small muted">ไม่ระบุโซน {num(s.unzoned)} คัน</div>}
                  </div>
                  {data.sites.length > 1 && (
                    <div className="small muted">
                      เข้า {num(s.kpis.entries)} · ออก {num(s.kpis.exits)} · รายได้ {money(s.kpis.revenue.net)} · ค้างชำระ {money(s.kpis.outstanding.amount)}
                    </div>
                  )}
                </div>
              ))}
              {!data.sites.length && <Empty>ไม่มีสาขาที่มีสิทธิ์ดู</Empty>}
            </div>
          </Card>

          <Card title={<span data-el={SECTION}>รถเข้า–ออก รายชั่วโมง (วันนี้)</span>}>
            <ColumnChart
              ariaLabel="จำนวนรถเข้าและออกรายชั่วโมงวันนี้"
              series={[
                { name: 'รถเข้า', color: ENTRY_COLOR },
                { name: 'รถออก', color: EXIT_COLOR },
              ]}
              data={data.hourly.map((h) => ({ label: String(h.hour).padStart(2, '0'), tooltipLabel: `${String(h.hour).padStart(2, '0')}:00–${String(h.hour).padStart(2, '0')}:59 น.`, values: [h.entries, h.exits] }))}
              labelEvery={3}
              format={(n) => `${num(n)} คัน`}
            />
          </Card>
        </div>

        <Card title={<span data-el={SECTION}>รายได้สุทธิ 30 วันล่าสุด</span>} actions={<span className="small muted">รวม {money(data.revenue30d.reduce((a, r) => a + r.net, 0))}</span>}>
          <LineChart
            ariaLabel="รายได้สุทธิรายวัน 30 วันล่าสุด"
            name="รายได้สุทธิ"
            data={data.revenue30d.map((r) => ({ label: `${r.day.slice(8, 10)}/${r.day.slice(5, 7)}`, tooltipLabel: `${r.day.slice(8, 10)}/${r.day.slice(5, 7)}/${r.day.slice(0, 4)}${r.refunds ? ` (คืนเงิน ${money(r.refunds)})` : ''}`, value: r.net }))}
            format={money}
            labelEvery={5}
          />
        </Card>

        <div className="grid grid-2">
          <Card
            title={<span data-el={SECTION}>การแจ้งเตือนล่าสุด</span>}
            actions={
              <Link to="/admin/alerts" className="small">
                ดูทั้งหมด →
              </Link>
            }
          >
            {data.alerts.open.length ? (
              <div className="col" style={{ gap: 8 }}>
                {data.alerts.open.map((a) => {
                  const to = alertLink(a);
                  return (
                    <div key={a.id} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                      <Badge>{a.severity}</Badge>
                      <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                        <span data-el="dashboard/main/alert/message">{to ? <Link to={to}>{a.message}</Link> : a.message}</span>
                        <span className="small muted">
                          {label(ALERT_TYPE, a.type)} · {dateTime(a.createdAt)}
                          {a.siteName ? ` · ${a.siteName}` : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty>ไม่มีการแจ้งเตือนที่เปิดอยู่</Empty>
            )}
          </Card>

          <Card
            title={<span data-el={SECTION}>สถานะอุปกรณ์</span>}
            actions={
              can('gate.control', 'dashboard.view') ? (
                <Link to="/admin/gates" className="small">
                  ทางเข้า–ออก (Live) →
                </Link>
              ) : null
            }
          >
            <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
              {(['ONLINE', 'OFFLINE', 'ERROR', 'UNKNOWN'] as const).map((s) => (
                <div key={s} className="col" style={{ gap: 2 }}>
                  <span className="kpi-value num" style={{ fontSize: 22, fontWeight: 700 }} data-el={EL.value}>
                    {num(data.devices.byStatus[s] ?? 0)}
                  </span>
                  <Badge>{s}</Badge>
                </div>
              ))}
            </div>
            {data.devices.problems.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>อุปกรณ์</th>
                      <th>สถานะ</th>
                      <th>เห็นล่าสุด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.devices.problems.map((d) => (
                      <tr key={d.id}>
                        <td>
                          {d.name}
                          <div className="small muted">
                            {label(DEVICE_TYPE, d.type)}
                            {d.gate_name ? ` · ${d.gate_name}` : ''}
                            {d.last_error ? ` · ${d.last_error}` : ''}
                          </div>
                        </td>
                        <td>
                          <Badge>{d.status}</Badge>
                        </td>
                        <td className="small">{dateTime(d.last_seen_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="small muted">ไม่มีอุปกรณ์ที่ออฟไลน์หรือผิดพลาด</div>
            )}
          </Card>
        </div>
      </div>
    </DesignProvider>
  );
}

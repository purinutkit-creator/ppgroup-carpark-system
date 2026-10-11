import { useEffect, useMemo, useState } from 'react';
import type { RateConfig } from '@pp/shared/pricing';
import { del, get, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, dateTime, money, minutesText, toLocalInput, fromLocalInput } from '../../lib/format';
import { Badge, Button, Card, ConfirmDialog, Empty, Field, Input, Modal, NumberInput, Select, SettingsFooter, Tabs, useAsync, useToast, errorText } from '../../components/ui';
import { RateEditor, RatePreview } from '../../components/config/RateEditor';
import { useLookups, same } from '../../components/config/common';
import { useApplyPermissions } from '../../components/config/settingsModule';

interface Plan {
  id: number;
  name: string;
  vehicle_type: string;
  site_id: number | null;
  zone_id: number | null;
  site_name: string | null;
  zone_name: string | null;
  priority: number;
  active: number;
  currentVersion: { id: number; effective_from: string; note: string | null; config: RateConfig } | null;
  upcoming: Array<{ id: number; effective_from: string; note: string | null }>;
  versionCount: number;
}

interface Version {
  id: number;
  effective_from: string;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  config: RateConfig;
  state: 'CURRENT' | 'SCHEDULED' | 'PAST';
  sessions: number;
}

const inOneHour = () => toLocalInput(new Date(Date.now() + 3600_000).toISOString());

function summary(c: RateConfig | undefined) {
  if (!c) return 'ยังไม่มีอัตรา';
  const parts = [`ฟรี ${minutesText(c.freeMinutes)}`, `${money(c.hourlyRate)}/ชม.`];
  if (c.dailyMax) parts.push(`สูงสุด ${money(c.dailyMax)}/วัน`);
  if (c.dailyFlatRate) parts.push(`เหมา ${money(c.dailyFlatRate)}/วัน`);
  return parts.join(' · ');
}

export default function Rates() {
  const [tab, setTab] = useState<'plans' | 'holidays'>('plans');
  return (
    <>
      <div className="page-header">
        <h1>อัตราค่าจอด</h1>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'plans', label: 'แผนอัตราค่าจอด' },
          { id: 'holidays', label: 'วันหยุด' },
        ]}
      />
      {tab === 'plans' ? <PlansTab /> : <HolidaysTab />}
    </>
  );
}

function PlansTab() {
  const toast = useToast();
  const { user } = useAuth();
  const perms = useApplyPermissions();
  const lk = useLookups();
  const plans = useAsync(() => get<{ items: Plan[] }>('/api/admin/rate-plans').then((r) => r.items), []);
  const [selId, setSelId] = useState<number | null>(null);
  const [planForm, setPlanForm] = useState<Partial<Plan> | null>(null);
  const sel = plans.data?.find((p) => p.id === selId) ?? plans.data?.[0] ?? null;
  const base = useMemo(() => sel?.currentVersion?.config ?? null, [sel]);
  const [cfg, setCfg] = useState<RateConfig | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(inOneHour);
  const [note, setNote] = useState('');
  const versions = useAsync(() => (sel ? get<{ items: Version[] }>(`/api/admin/rate-plans/${sel.id}/versions`).then((r) => r.items) : Promise.resolve([] as Version[])), [sel?.id]);

  useEffect(() => {
    setCfg(base ? structuredClone(base) : null);
    setEffectiveFrom(inOneHour());
    setNote('');
  }, [base]);

  const backdated = (fromLocalInput(effectiveFrom) ?? '') < new Date().toISOString();
  const dirty = !!cfg && !!base && !same(cfg, base);
  const reload = () => {
    plans.reload();
    versions.reload();
  };

  const saveVersion = async () => {
    if (!sel || !cfg) return;
    await post(`/api/admin/rate-plans/${sel.id}/versions`, { config: cfg, effectiveFrom: fromLocalInput(effectiveFrom), note: note || undefined });
    reload();
  };

  const targets = (plans.data ?? []).filter((p) => p.active).map((p) => ({ id: String(p.id), label: `${p.name} (${lk.vehicleName(p.vehicle_type)}) · ${p.site_name ?? 'ทุกสาขา'} / ${p.zone_name ?? 'ทุกโซน'}` }));

  return (
    <div className="col">
      <Card
        title="แผนอัตรา (ตามประเภทรถ / สาขา / โซน)"
        actions={
          <Button size="sm" variant="primary" onClick={() => setPlanForm({ name: '', vehicle_type: 'CAR', priority: 0, site_id: lk.sites[0]?.id ?? null, zone_id: null })}>
            + แผนอัตราใหม่
          </Button>
        }
      >
        {plans.error && <div className="error">{plans.error}</div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>แผน</th>
                <th>ประเภทรถ</th>
                <th>สาขา / โซน</th>
                <th>ลำดับ</th>
                <th>อัตราปัจจุบัน</th>
                <th>มีผลตั้งแต่</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(plans.data ?? []).map((p) => (
                <tr key={p.id} className="clickable" onClick={() => setSelId(p.id)} style={sel?.id === p.id ? { background: 'color-mix(in srgb, var(--color-primary) 8%, transparent)' } : undefined}>
                  <td>
                    <b>{p.name}</b> {!p.active && <Badge tone="danger">ปิดใช้งาน</Badge>}
                    {p.upcoming.length > 0 && <Badge tone="warning">รอมีผล {p.upcoming.length}</Badge>}
                  </td>
                  <td>{lk.vehicleName(p.vehicle_type)}</td>
                  <td>
                    {p.site_name ?? 'ทุกสาขา'} / {p.zone_name ?? 'ทุกโซน'}
                  </td>
                  <td>{p.priority}</td>
                  <td className="small">{summary(p.currentVersion?.config)}</td>
                  <td className="small nowrap">{p.currentVersion ? dateTime(p.currentVersion.effective_from) : '-'}</td>
                  <td className="right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlanForm(p);
                      }}
                    >
                      แก้ไขแผน
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!plans.loading && !plans.data?.length && <Empty>ยังไม่มีแผนอัตรา</Empty>}
        </div>
      </Card>

      {sel && cfg && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
            <Card title={`แก้ไขอัตรา: ${sel.name}`}>
              <div className="col">
                <RateEditor value={cfg} onChange={setCfg} />
                <div className="grid grid-2">
                  <Field label="มีผลตั้งแต่" hint="อัตราใหม่ใช้กับรถที่เข้าหลังเวลานี้เท่านั้น รถที่จอดอยู่ใช้อัตราเดิม" error={backdated ? (user?.role === 'OWNER' ? 'ย้อนหลัง: จะกระทบรถที่เข้ามาแล้ว' : 'ไม่สามารถตั้งย้อนหลังได้ (เฉพาะ OWNER)') : undefined}>
                    <Input type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                  </Field>
                  <Field label="หมายเหตุเวอร์ชัน">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ปรับราคาประจำปี" />
                  </Field>
                </div>
              </div>
            </Card>
            <div style={{ position: 'sticky', top: 72 }}>
              <RatePreview config={cfg} siteId={sel.site_id} />
            </div>
          </div>
          <SettingsFooter
            dirty={dirty}
            onCancel={() => base && setCfg(structuredClone(base))}
            onSave={saveVersion}
            targets={targets}
            canApply={perms.canApply}
            canApplyAll={perms.canApplyAll}
            applyAllLabel="Save & Apply to All Parking Zones"
            subject={sel.name}
            onApply={async (ids, all) => {
              const r = await post<{ created: unknown[] }>('/api/admin/rate-plans/apply', {
                config: cfg,
                effectiveFrom: fromLocalInput(effectiveFrom),
                note: note || undefined,
                ...(all ? { all: true } : { planIds: ids.map(Number) }),
              });
              toast(`สร้างเวอร์ชันใหม่ ${r.created.length} แผน`, 'success');
              reload();
            }}
          />
          <Card title={`ประวัติอัตรา: ${sel.name}`}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>มีผลตั้งแต่</th>
                    <th>สถานะ</th>
                    <th>อัตรา</th>
                    <th>หมายเหตุ</th>
                    <th>สร้างโดย</th>
                    <th>รถที่ใช้</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(versions.data ?? []).map((v) => (
                    <tr key={v.id}>
                      <td className="nowrap">{dateTime(v.effective_from)}</td>
                      <td>
                        <Badge tone={v.state === 'CURRENT' ? 'success' : v.state === 'SCHEDULED' ? 'warning' : ''}>{v.state === 'CURRENT' ? 'ใช้งานอยู่' : v.state === 'SCHEDULED' ? 'รอมีผล' : 'อดีต'}</Badge>
                      </td>
                      <td className="small">{summary(v.config)}</td>
                      <td className="small">{v.note ?? ''}</td>
                      <td className="small">
                        {v.created_by_name ?? 'system'} · {dateTime(v.created_at)}
                      </td>
                      <td>{v.sessions.toLocaleString()}</td>
                      <td className="right">
                        <Button size="sm" variant="ghost" onClick={() => setCfg(structuredClone(v.config))}>
                          ใช้เป็นต้นแบบ
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="small muted mt">ประวัติอัตราแก้ไข/ลบไม่ได้ ทุกครั้งที่บันทึกจะเพิ่มเวอร์ชันใหม่ (เพื่อคุ้มครองรถที่เข้ามาแล้ว)</div>
          </Card>
        </>
      )}

      {sel && !cfg && (
        <Card title={`แผน ${sel.name} ยังไม่มีอัตรา`}>
          <Button variant="primary" onClick={() => setCfg({ freeMinutes: 120, hourlyRate: 20, billingUnitMinutes: 60, rounding: 'CEIL', toleranceMinutes: 0, lostTicketFee: 200, graceAfterPaymentMinutes: 15, dayCycle: 'ROLLING_24H' })}>
            เริ่มกำหนดอัตรา
          </Button>
        </Card>
      )}

      <PlanModal
        plan={planForm}
        onClose={() => setPlanForm(null)}
        onSaved={(id) => {
          setPlanForm(null);
          if (id) setSelId(id);
          reload();
          lk.reload();
        }}
      />
    </div>
  );
}

function PlanModal({ plan, onClose, onSaved }: { plan: Partial<Plan> | null; onClose: () => void; onSaved: (id?: number) => void }) {
  const lk = useLookups();
  const toast = useToast();
  const [f, setF] = useState<Partial<Plan>>({});
  const [confirmOff, setConfirmOff] = useState(false);
  useEffect(() => setF(plan ?? {}), [plan]);
  const save = async () => {
    try {
      const body = { name: f.name, vehicleType: f.vehicle_type, siteId: f.site_id ?? null, zoneId: f.zone_id ?? null, priority: f.priority ?? 0 };
      if (f.id) {
        await put(`/api/admin/rate-plans/${f.id}`, { ...body, active: !!f.active });
        onSaved(f.id);
      } else {
        const r = await post<{ id: number }>('/api/admin/rate-plans', {
          ...body,
          config: { freeMinutes: 120, hourlyRate: 20, billingUnitMinutes: 60, rounding: 'CEIL' },
          effectiveFrom: new Date().toISOString(),
          note: 'initial',
        });
        onSaved(r.id);
      }
      toast('บันทึกแผนแล้ว', 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <Modal
      open={!!plan}
      title={f.id ? `แก้ไขแผน: ${plan?.name}` : 'แผนอัตราใหม่'}
      onClose={onClose}
      footer={
        <>
          {f.id && !!f.active && (
            <Button variant="danger" onClick={() => setConfirmOff(true)}>
              ปิดใช้งานแผน
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" onClick={save}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="col">
        <Field label="ชื่อแผน">
          <Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="เช่น รถยนต์" />
        </Field>
        <div className="grid grid-2">
          <Field label="ประเภทรถ">
            <Select value={f.vehicle_type ?? 'CAR'} options={lk.vehicleTypes.map((v) => ({ value: v.code, label: `${v.name} (${v.code})` }))} onChange={(e) => setF({ ...f, vehicle_type: e.target.value })} />
          </Field>
          <Field label="ลำดับความสำคัญ" hint="แผนที่เจาะจงกว่า (โซน > สาขา > ทั้งหมด) ชนะก่อน แล้วจึงดูลำดับ">
            <NumberInput value={f.priority ?? 0} onChange={(v) => setF({ ...f, priority: v ?? 0 })} />
          </Field>
          <Field label="สาขา">
            <Select value={f.site_id ?? ''} placeholder="ทุกสาขา" options={lk.sites.map((s) => ({ value: s.id, label: s.name }))} onChange={(e) => setF({ ...f, site_id: e.target.value ? Number(e.target.value) : null, zone_id: null })} />
          </Field>
          <Field label="โซน">
            <Select
              value={f.zone_id ?? ''}
              placeholder="ทุกโซน"
              options={lk.zones.filter((z) => !f.site_id || z.site_id === f.site_id).map((z) => ({ value: z.id, label: z.name }))}
              onChange={(e) => setF({ ...f, zone_id: e.target.value ? Number(e.target.value) : null })}
            />
          </Field>
        </div>
        {f.id && !f.active && <Button onClick={() => setF({ ...f, active: 1 })}>เปิดใช้งานแผนอีกครั้ง</Button>}
        {!f.id && <div className="small muted">แผนใหม่เริ่มด้วยอัตราตั้งต้น (ฟรี 2 ชม. 20 บาท/ชม.) แล้วปรับได้ทันทีด้านล่าง</div>}
      </div>
      <ConfirmDialog
        open={confirmOff}
        danger
        title="ปิดใช้งานแผนอัตรานี้?"
        message="รถที่เข้ามาใหม่จะใช้แผนอื่นที่ตรงเงื่อนไข รถที่จอดอยู่ยังคิดตามเวอร์ชันเดิม"
        onClose={() => setConfirmOff(false)}
        onConfirm={async () => {
          await del(`/api/admin/rate-plans/${f.id}`);
          onSaved();
        }}
      />
    </Modal>
  );
}

function HolidaysTab() {
  const toast = useToast();
  const lk = useLookups();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const list = useAsync(() => get<{ items: Array<{ id: number; date: string; name: string; site_id: number | null; site_name: string | null }> }>(`/api/admin/holidays?year=${year}`).then((r) => r.items), [year]);
  const [f, setF] = useState({ date: '', name: '', siteId: '' });
  const add = async () => {
    try {
      await post('/api/admin/holidays', { date: f.date, name: f.name, siteId: f.siteId ? Number(f.siteId) : null });
      setF({ date: '', name: '', siteId: '' });
      list.reload();
      toast('เพิ่มวันหยุดแล้ว', 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <Card title="วันหยุดนักขัตฤกษ์" actions={<Select value={year} options={[-1, 0, 1].map((d) => String(new Date().getFullYear() + d))} onChange={(e) => setYear(e.target.value)} />}>
      <div className="filters mb">
        <Field label="วันที่">
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="ชื่อวันหยุด">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="สาขา">
          <Select value={f.siteId} placeholder="ทุกสาขา" options={lk.sites.map((s) => ({ value: s.id, label: s.name }))} onChange={(e) => setF({ ...f, siteId: e.target.value })} />
        </Field>
        <Button variant="primary" disabled={!f.date || !f.name} onClick={add}>
          + เพิ่ม
        </Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>วันที่</th>
              <th>ชื่อ</th>
              <th>สาขา</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((hd) => (
              <tr key={hd.id}>
                <td>{date(`${hd.date}T05:00:00Z`)}</td>
                <td>{hd.name}</td>
                <td>{hd.site_name ?? 'ทุกสาขา'}</td>
                <td className="right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await del(`/api/admin/holidays/${hd.id}`);
                        list.reload();
                      } catch (e) {
                        toast(errorText(e), 'error');
                      }
                    }}
                  >
                    ลบ
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.loading && !list.data?.length && <Empty>ไม่มีวันหยุดในปีนี้</Empty>}
      </div>
    </Card>
  );
}

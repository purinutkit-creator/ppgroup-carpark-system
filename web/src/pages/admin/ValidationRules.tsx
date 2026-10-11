import { useEffect, useState } from 'react';
import type { Reward, ValidationRule, ValidationSettings } from '@pp/shared/validation';
import { del, get, post, put } from '../../lib/api';
import { money, minutesText } from '../../lib/format';
import { Badge, Button, Card, Check, ConfirmDialog, Empty, Field, Input, Modal, NumberInput, Select, SettingsFooter, Tabs, useAsync, useToast, errorText } from '../../components/ui';
import { DAYS_TH, MultiCheck, Section, useLookups } from '../../components/config/common';
import { useApplyPermissions, useSettingsModule, VersionHistory } from '../../components/config/settingsModule';

type RuleConfig = Omit<ValidationRule, 'id' | 'name' | 'scope' | 'priority' | 'combinable' | 'active'>;
interface RuleRow {
  id: number;
  name: string;
  scope: ValidationRule['scope'];
  config: RuleConfig;
  priority: number;
  combinable: boolean;
  active: boolean;
  created_by_name: string | null;
}
interface Merchant {
  id: number;
  code: string | null;
  name: string;
  status: string;
}
interface TestResult {
  totalSpend: number;
  applied: Array<{ ruleName: string; reward: Reward; value: number; merchantId: number | null }>;
  options: Array<{ ruleName: string; reward: Reward; value: number }>;
  freeMinutes: number;
  amount: number;
  full: boolean;
  sample: { parkedMinutes: number; planName: string; freeMinutes: number; fee: number; feeAfter: number };
}

function rewardText(r: Reward) {
  if (r.type === 'FULL') return 'จอดฟรีทั้งหมด';
  if (r.type === 'MINUTES') return `จอดฟรีเพิ่ม ${minutesText(r.value)}`;
  return `ลด ${money(r.value)}`;
}

function ruleSummary(c: RuleConfig) {
  if (c.kind === 'TIER') return (c.tiers ?? []).map((t) => `≥${money(t.minSpend)} → ${rewardText(t.reward)}`).join(', ');
  if (c.kind === 'STEP' && c.step) return `ทุก ${money(c.step.every)} → ${rewardText(c.step.reward)}${c.step.max ? ` (สูงสุด ${c.step.max})` : ''}`;
  if (c.anyPurchase) return `ซื้อขั้นต่ำ ${money(c.anyPurchase.minSpend ?? 0)} → ${rewardText(c.anyPurchase.reward)}`;
  return '';
}

function scheduleText(c: RuleConfig) {
  const p: string[] = [];
  if (c.daysOfWeek?.length) p.push(c.daysOfWeek.map((d) => DAYS_TH[d]).join(' '));
  if (c.startTime && c.endTime) p.push(`${c.startTime}–${c.endTime}`);
  if (c.startDate || c.endDate) p.push(`${c.startDate ?? '…'} ถึง ${c.endDate ?? '…'}`);
  return p.join(' · ') || 'ทุกวัน ทุกเวลา';
}

const SCOPE_LABEL: Record<string, string> = { GLOBAL: 'ทั้งศูนย์', MERCHANT: 'เฉพาะร้าน', CAMPAIGN: 'แคมเปญ' };

export default function ValidationRules() {
  const [tab, setTab] = useState<'rules' | 'calc' | 'settings'>('rules');
  return (
    <>
      <div className="page-header">
        <h1>กฎแสตมป์ / Parking Validation</h1>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'rules', label: 'กฎการให้สิทธิ์' },
          { id: 'calc', label: 'ทดลองคำนวณ' },
          { id: 'settings', label: 'ตั้งค่าการตรวจใบเสร็จ' },
        ]}
      />
      {tab === 'rules' && <RulesTab />}
      {tab === 'calc' && <Calculator />}
      {tab === 'settings' && <SettingsTab />}
    </>
  );
}

function useMerchants() {
  return useAsync(() => get<{ items: Merchant[] }>('/api/admin/merchants-lite').then((r) => r.items), []);
}

function RulesTab() {
  const toast = useToast();
  const rules = useAsync(() => get<{ items: RuleRow[] }>('/api/admin/validation-rules').then((r) => r.items), []);
  const merchants = useMerchants();
  const [edit, setEdit] = useState<Partial<RuleRow> | null>(null);
  const [off, setOff] = useState<RuleRow | null>(null);
  const mName = (id: number) => merchants.data?.find((m) => m.id === id)?.name ?? `#${id}`;
  return (
    <Card
      title="กฎการให้สิทธิ์จอดฟรี / ส่วนลด"
      actions={
        <Button variant="primary" size="sm" onClick={() => setEdit({ name: '', scope: 'GLOBAL', priority: 0, combinable: true, active: true, config: { kind: 'TIER', tiers: [{ minSpend: 300, reward: { type: 'MINUTES', value: 60 } }] } })}>
          + เพิ่มกฎ
        </Button>
      }
    >
      {rules.error && <div className="error">{rules.error}</div>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ชื่อกฎ</th>
              <th>ขอบเขต</th>
              <th>เงื่อนไข → สิทธิ์</th>
              <th>ช่วงเวลา</th>
              <th>ลำดับ</th>
              <th>ใช้ร่วม</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(rules.data ?? []).map((r) => (
              <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
                <td>
                  <b>{r.name}</b> {!r.active && <Badge tone="danger">ปิด</Badge>}
                </td>
                <td>
                  <Badge tone="info">{SCOPE_LABEL[r.scope]}</Badge>
                  {r.config.merchantIds?.length ? <div className="small muted">{r.config.merchantIds.map(mName).join(', ')}</div> : null}
                </td>
                <td className="small">{ruleSummary(r.config)}</td>
                <td className="small">{scheduleText(r.config)}</td>
                <td>{r.priority}</td>
                <td>{r.combinable ? 'ได้' : 'ไม่ได้'}</td>
                <td className="right nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setEdit(structuredClone(r))}>
                    แก้ไข
                  </Button>
                  {r.active ? (
                    <Button size="sm" variant="ghost" onClick={() => setOff(r)}>
                      ปิดใช้งาน
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        put(`/api/admin/validation-rules/${r.id}`, { active: true })
                          .then(rules.reload)
                          .catch((e) => toast(errorText(e), 'error'))
                      }
                    >
                      เปิดใช้งาน
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rules.loading && !rules.data?.length && <Empty>ยังไม่มีกฎ</Empty>}
      </div>
      <RuleModal
        rule={edit}
        merchants={merchants.data ?? []}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          rules.reload();
        }}
      />
      <ConfirmDialog
        open={!!off}
        danger
        title={`ปิดใช้งานกฎ “${off?.name}”?`}
        message="ส่วนลดที่ให้ไปแล้วไม่เปลี่ยนแปลง กฎจะไม่ถูกใช้กับใบเสร็จใหม่"
        onClose={() => setOff(null)}
        onConfirm={async () => {
          await del(`/api/admin/validation-rules/${off!.id}`);
          rules.reload();
        }}
      />
    </Card>
  );
}

function RewardInput({ value, onChange, allowFull = true }: { value: Reward; onChange: (r: Reward) => void; allowFull?: boolean }) {
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <Select
        style={{ maxWidth: 170 }}
        value={value.type}
        options={[{ value: 'MINUTES', label: 'จอดฟรีเพิ่ม (นาที)' }, { value: 'AMOUNT', label: 'ลดค่าจอด (บาท)' }, ...(allowFull ? [{ value: 'FULL', label: 'จอดฟรีทั้งหมด' }] : [])]}
        onChange={(e) => {
          const t = e.target.value as Reward['type'];
          onChange(t === 'FULL' ? { type: 'FULL' } : { type: t, value: 'value' in value ? value.value : 60 });
        }}
      />
      {value.type !== 'FULL' && <NumberInput style={{ maxWidth: 110 }} min={0} value={value.value} onChange={(v) => onChange({ type: value.type, value: v ?? 0 })} />}
    </div>
  );
}

function RuleModal({ rule, merchants, onClose, onSaved }: { rule: Partial<RuleRow> | null; merchants: Merchant[]; onClose: () => void; onSaved: () => void }) {
  const lk = useLookups();
  const toast = useToast();
  const [r, setR] = useState<Partial<RuleRow>>({});
  const [testAmount, setTestAmount] = useState<number | null>(500);
  const [test, setTest] = useState<TestResult | null>(null);
  useEffect(() => {
    setR(rule ?? {});
    setTest(null);
  }, [rule]);
  const c = (r.config ?? { kind: 'TIER' }) as RuleConfig;
  const setC = (p: Partial<RuleConfig>) => setR({ ...r, config: { ...c, ...p } });
  const payload = () => ({ name: r.name, scope: r.scope, priority: r.priority ?? 0, combinable: r.combinable !== false, active: r.active !== false, ...c });
  const save = async () => {
    try {
      if (r.id) await put(`/api/admin/validation-rules/${r.id}`, payload());
      else await post('/api/admin/validation-rules', payload());
      toast('บันทึกกฎแล้ว', 'success');
      onSaved();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const runTest = async () => {
    try {
      setTest(await post<TestResult>('/api/admin/validation/test', { amount: testAmount ?? 0, merchantId: c.merchantIds?.[0], rule: payload() }));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <Modal
      open={!!rule}
      size="lg"
      title={r.id ? `แก้ไขกฎ: ${rule?.name}` : 'กฎใหม่'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" onClick={save}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="col">
        <div className="grid grid-3">
          <div style={{ gridColumn: 'span 2' }}>
            <Field label="ชื่อกฎ">
              <Input value={r.name ?? ''} onChange={(e) => setR({ ...r, name: e.target.value })} />
            </Field>
          </div>
          <Field label="ขอบเขต">
            <Select
              value={r.scope ?? 'GLOBAL'}
              options={Object.entries(SCOPE_LABEL).map(([value, label]) => ({ value, label }))}
              onChange={(e) => setR({ ...r, scope: e.target.value as ValidationRule['scope'] })}
            />
          </Field>
        </div>
        <Section title="ประเภทการให้สิทธิ์">
          <div className="col">
            <div className="pill-tabs">
              {(
                [
                  ['TIER', 'ขั้นบันไดตามยอดซื้อ'],
                  ['STEP', 'ทุก X บาท ได้สิทธิ์'],
                  ['ANY_PURCHASE', 'ซื้ออะไรก็ได้'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={c.kind === k ? 'active' : ''}
                  onClick={() =>
                    setC(
                      k === 'TIER'
                        ? { kind: k, tiers: c.tiers?.length ? c.tiers : [{ minSpend: 300, reward: { type: 'MINUTES', value: 60 } }] }
                        : k === 'STEP'
                          ? { kind: k, step: c.step ?? { every: 100, reward: { type: 'MINUTES', value: 30 }, max: null } }
                          : { kind: k, anyPurchase: c.anyPurchase ?? { minSpend: 0, reward: { type: 'MINUTES', value: 60 } } },
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            {c.kind === 'TIER' && (
              <table className="table">
                <thead>
                  <tr>
                    <th>ยอดซื้อขั้นต่ำ (บาท)</th>
                    <th>สิทธิ์ที่ได้</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(c.tiers ?? []).map((t, i) => (
                    <tr key={i}>
                      <td>
                        <NumberInput min={0} value={t.minSpend} onChange={(v) => setC({ tiers: c.tiers!.map((x, j) => (j === i ? { ...x, minSpend: v ?? 0 } : x)) })} />
                      </td>
                      <td>
                        <RewardInput value={t.reward} onChange={(rw) => setC({ tiers: c.tiers!.map((x, j) => (j === i ? { ...x, reward: rw } : x)) })} />
                      </td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => setC({ tiers: c.tiers!.filter((_, j) => j !== i) })}>
                          ลบ
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {c.kind === 'TIER' && (
              <div>
                <Button size="sm" onClick={() => setC({ tiers: [...(c.tiers ?? []), { minSpend: ((c.tiers ?? []).at(-1)?.minSpend ?? 0) + 500, reward: { type: 'MINUTES', value: 60 } }] })}>
                  + เพิ่มขั้น
                </Button>
              </div>
            )}
            {c.kind === 'STEP' && c.step && (
              <div className="row">
                <span>ทุกยอดซื้อ</span>
                <NumberInput style={{ maxWidth: 120 }} min={1} value={c.step.every} onChange={(v) => setC({ step: { ...c.step!, every: v ?? 0 } })} />
                <span>บาท ได้รับ</span>
                <RewardInput allowFull={false} value={c.step.reward} onChange={(rw) => setC({ step: { ...c.step!, reward: rw as { type: 'AMOUNT' | 'MINUTES'; value: number } } })} />
                <span>สูงสุด</span>
                <NumberInput style={{ maxWidth: 110 }} min={0} value={c.step.max ?? null} placeholder="ไม่จำกัด" onChange={(v) => setC({ step: { ...c.step!, max: v || null } })} />
              </div>
            )}
            {c.kind === 'ANY_PURCHASE' && c.anyPurchase && (
              <div className="row">
                <span>ยอดซื้อขั้นต่ำ</span>
                <NumberInput style={{ maxWidth: 120 }} min={0} value={c.anyPurchase.minSpend ?? 0} onChange={(v) => setC({ anyPurchase: { ...c.anyPurchase!, minSpend: v ?? 0 } })} />
                <span>บาท ได้รับ</span>
                <RewardInput value={c.anyPurchase.reward} onChange={(rw) => setC({ anyPurchase: { ...c.anyPurchase!, reward: rw } })} />
              </div>
            )}
          </div>
        </Section>
        <Section title="ช่วงเวลาที่ใช้ได้">
          <div className="col">
            <div className="row">
              {DAYS_TH.map((d, i) => (
                <Check
                  key={i}
                  label={d}
                  checked={!c.daysOfWeek?.length || c.daysOfWeek.includes(i)}
                  onChange={(v) => {
                    const cur = c.daysOfWeek?.length ? c.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
                    const next = v ? [...cur, i] : cur.filter((x) => x !== i);
                    setC({ daysOfWeek: next.length === 7 ? null : next.sort() });
                  }}
                />
              ))}
            </div>
            <div className="grid grid-4">
              <Field label="วันเริ่ม">
                <Input type="date" value={c.startDate ?? ''} onChange={(e) => setC({ startDate: e.target.value || null })} />
              </Field>
              <Field label="วันสิ้นสุด">
                <Input type="date" value={c.endDate ?? ''} onChange={(e) => setC({ endDate: e.target.value || null })} />
              </Field>
              <Field label="เวลาเริ่ม">
                <Input type="time" value={c.startTime ?? ''} onChange={(e) => setC({ startTime: e.target.value || null })} />
              </Field>
              <Field label="เวลาสิ้นสุด">
                <Input type="time" value={c.endTime ?? ''} onChange={(e) => setC({ endTime: e.target.value || null })} />
              </Field>
            </div>
          </div>
        </Section>
        <Section title="ร้านค้าที่ร่วมรายการ" hint="กฎระดับร้านค้าคิดจากยอดซื้อของร้านนั้น ๆ, กฎทั้งศูนย์/แคมเปญคิดจากยอดรวมทุกใบเสร็จ">
          <MultiCheck allLabel="ทุกร้าน" options={merchants.map((m) => ({ value: m.id, label: `${m.name}${m.code ? ` (${m.code})` : ''}` }))} value={c.merchantIds} onChange={(v) => setC({ merchantIds: v })} />
        </Section>
        {lk.sites.length > 1 && (
          <Section title="สาขา">
            <MultiCheck allLabel="ทุกสาขา" options={lk.sites.map((s) => ({ value: s.id, label: s.name }))} value={c.siteIds} onChange={(v) => setC({ siteIds: v })} />
          </Section>
        )}
        <div className="row">
          <Field label="ลำดับความสำคัญ" hint="ใช้ตัดสินเมื่อมูลค่าสิทธิ์เท่ากัน">
            <NumberInput value={r.priority ?? 0} onChange={(v) => setR({ ...r, priority: v ?? 0 })} />
          </Field>
          <Check label="ใช้ร่วมกับกฎอื่นได้ (Combinable)" checked={r.combinable !== false} onChange={(v) => setR({ ...r, combinable: v })} />
          <Check label="เปิดใช้งาน" checked={r.active !== false} onChange={(v) => setR({ ...r, active: v })} />
        </div>
        <Section title="ทดลองกฎนี้">
          <div className="row">
            <span>ยอดซื้อ</span>
            <NumberInput style={{ maxWidth: 140 }} min={0} value={testAmount} onChange={setTestAmount} />
            <Button size="sm" onClick={runTest}>
              ทดลองคำนวณ
            </Button>
            {test && <TestSummary result={test} compact />}
          </div>
        </Section>
      </div>
    </Modal>
  );
}

function TestSummary({ result, compact }: { result: TestResult; compact?: boolean }) {
  const reward = result.full ? 'จอดฟรีทั้งหมด' : [result.freeMinutes ? `จอดฟรีเพิ่ม ${minutesText(result.freeMinutes)}` : '', result.amount ? `ลด ${money(result.amount)}` : ''].filter(Boolean).join(' + ') || 'ไม่ได้รับสิทธิ์';
  if (compact) return <b>{reward}</b>;
  return (
    <div className="col">
      <div className="kpi">
        <span className="kpi-label">สิทธิ์จอดฟรีเพิ่มเติม</span>
        <span className="kpi-value">{reward}</span>
      </div>
      <div className="kv small">
        <span>ยอดซื้อรวม</span>
        <span>{money(result.totalSpend)}</span>
        {result.applied.map((a, i) => [
          <span key={`n${i}`}>{a.ruleName}</span>,
          <span key={`v${i}`}>
            {rewardText(a.reward)} <span className="muted">(มูลค่า {money(a.value)})</span>
          </span>,
        ])}
        <span>ตัวอย่าง: จอด {minutesText(result.sample.parkedMinutes)} ({result.sample.planName})</span>
        <span>
          {money(result.sample.fee)} → <b>{money(result.sample.feeAfter)}</b>
        </span>
      </div>
    </div>
  );
}

/** Stamp calculator: a quick "every X baht → Y minutes" check, or the live rule set. */
function Calculator() {
  const toast = useToast();
  const merchants = useMerchants();
  const [mode, setMode] = useState<'quick' | 'live'>('quick');
  const [amount, setAmount] = useState<number | null>(1000);
  const [every, setEvery] = useState<number | null>(500);
  const [free, setFree] = useState<number | null>(60);
  const [merchantId, setMerchantId] = useState('');
  const [parked, setParked] = useState<number | null>(180);
  const [res, setRes] = useState<TestResult | null>(null);
  const run = async () => {
    try {
      const body: Record<string, unknown> = { amount: amount ?? 0, parkedMinutes: parked ?? 180, merchantId: merchantId ? Number(merchantId) : undefined };
      if (mode === 'quick') body.rule = { name: 'เครื่องคิดเลขแสตมป์', kind: 'STEP', step: { every: every ?? 1, reward: { type: 'MINUTES', value: free ?? 0 } } };
      setRes(await post<TestResult>('/api/admin/validation/test', body));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  useEffect(() => {
    setRes(null);
  }, [mode]);
  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card title="ทดลองคำนวณสิทธิ์จอดฟรี">
        <div className="col">
          <div className="pill-tabs">
            <button type="button" className={mode === 'quick' ? 'active' : ''} onClick={() => setMode('quick')}>
              เครื่องคิดเลขแสตมป์
            </button>
            <button type="button" className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>
              ตามกฎที่ใช้งานอยู่
            </button>
          </div>
          <Field label="ยอดซื้อ (บาท)">
            <NumberInput min={0} value={amount} onChange={setAmount} />
          </Field>
          {mode === 'quick' ? (
            <div className="grid grid-2">
              <Field label="ทุกยอดซื้อ (บาท)">
                <NumberInput min={1} value={every} onChange={setEvery} />
              </Field>
              <Field label="ได้รับจอดฟรี (นาที)">
                <NumberInput min={0} value={free} onChange={setFree} />
              </Field>
            </div>
          ) : (
            <Field label="ร้านค้า">
              <Select value={merchantId} placeholder="— ไม่ระบุร้าน (ใช้กฎทั้งศูนย์) —" options={(merchants.data ?? []).map((m) => ({ value: m.id, label: m.name }))} onChange={(e) => setMerchantId(e.target.value)} />
            </Field>
          )}
          <Field label="ตัวอย่างระยะเวลาจอด (นาที)" hint="ใช้ประเมินมูลค่าสิทธิ์เทียบกับค่าจอดรถยนต์">
            <NumberInput min={0} value={parked} onChange={setParked} />
          </Field>
          <Button variant="primary" onClick={run}>
            คำนวณ
          </Button>
        </div>
      </Card>
      <Card title="ผลลัพธ์">{res ? <TestSummary result={res} /> : <Empty>กรอกข้อมูลแล้วกด “คำนวณ”</Empty>}</Card>
    </div>
  );
}

function SettingsTab() {
  const m = useSettingsModule<ValidationSettings>('validation');
  const perms = useApplyPermissions();
  const lk = useLookups();
  const v = m.value;
  if (m.error) return <div className="error">{m.error}</div>;
  if (!v) return <div className="page-loading">กำลังโหลด…</div>;
  const targets = lk.devicesOf('COUNTER', 'PAYMENT_KIOSK', 'EXIT_KIOSK', 'POS').map((d) => ({ id: `device:${d.id}`, label: `${d.name}` }));
  const numField = (k: keyof ValidationSettings, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <NumberInput min={0} value={v[k] as number} onChange={(x) => m.patch({ [k]: x ?? 0 } as Partial<ValidationSettings>)} />
    </Field>
  );
  return (
    <div className="col">
      <Card title="ตั้งค่าการตรวจใบเสร็จและการให้สิทธิ์">
        <div className="col">
          <div className="grid grid-4">
            {numField('maxFreeMinutesPerSession', 'จอดฟรีสูงสุดต่อครั้ง (นาที)', '0 = ไม่จำกัด')}
            {numField('maxDiscountAmountPerSession', 'ส่วนลดสูงสุดต่อครั้ง (บาท)', '0 = ไม่จำกัด')}
            {numField('maxValidationsPerDayPerPlate', 'จำนวนครั้งต่อวันต่อทะเบียน', '0 = ไม่จำกัด')}
            {numField('receiptMaxAgeHours', 'อายุใบเสร็จสูงสุด (ชั่วโมง)')}
          </div>
          <div className="grid grid-2">
            <Check label="ใช้หลายใบเสร็จรวมกันได้" checked={v.allowMultipleReceipts} onChange={(x) => m.patch({ allowMultipleReceipts: x })} />
            <Check label="ให้ลูกค้าสแกนใบเสร็จเองที่ Kiosk" checked={v.selfServiceKiosk} onChange={(x) => m.patch({ selfServiceKiosk: x })} />
            <Check label="ใช้ร่วมกับโปรโมชันอื่นได้" checked={v.combineWithPromotions} onChange={(x) => m.patch({ combineWithPromotions: x })} />
            <Check label="ใบเสร็จต้องมาจากสาขาเดียวกับลานจอด" checked={v.requireSameSite} onChange={(x) => m.patch({ requireSameSite: x })} />
            <Check label="ให้ Counter กรอกยอดใบเสร็จภายนอกเองได้" checked={v.allowManualAmountEntry} onChange={(x) => m.patch({ allowManualAmountEntry: x })} />
          </div>
          <Field label="เมื่อใบเสร็จถูกคืนเงินหลังใช้สิทธิ์แล้ว">
            <Select
              value={v.refundPolicy}
              options={[
                { value: 'REVOKE_IF_ACTIVE', label: 'ยกเลิกสิทธิ์ถ้ารถยังไม่ออก' },
                { value: 'RECALCULATE', label: 'คำนวณสิทธิ์ใหม่จากยอดคงเหลือ' },
                { value: 'MANAGER_REVIEW', label: 'แจ้งผู้จัดการตรวจสอบ' },
                { value: 'AUDIT_ONLY', label: 'บันทึก Audit อย่างเดียว' },
              ]}
              onChange={(e) => m.patch({ refundPolicy: e.target.value as ValidationSettings['refundPolicy'] })}
            />
          </Field>
        </div>
      </Card>
      <SettingsFooter
        dirty={m.dirty}
        onCancel={m.reset}
        onSave={() => m.save().then(() => undefined)}
        targets={targets}
        canApply={perms.canApply}
        canApplyAll={perms.canApplyAll}
        onApply={(ids, all) => m.save(all ? 'ALL' : ids).then(() => undefined)}
      />
      <VersionHistory module="validation" version={m.version} targets={targets} onRolledBack={m.reload} />
    </div>
  );
}

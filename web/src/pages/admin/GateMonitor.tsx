import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SOURCE_TYPES } from '@pp/shared/plate';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocketEvents } from '../../lib/useSocket';
import { dateTime, money, time } from '../../lib/format';
import { useDesign } from '../../design/DesignProvider';
import { printDoc } from '../../print/print';
import { ticketDoc, type TicketData } from '../../print/templates';
import { ApprovalDialog, Badge, Button, Card, Check, Empty, errorText, Field, Input, Modal, NumberInput, PlateBadge, ProvinceSelect, Select, TextArea, useAsync, useToast } from '../../components/ui';
import { SecureImage } from '../../components/ops/SecureImage';
import { DECISION, DEVICE_TYPE, GATE_STATE, label, pct, REASON, SOURCE_TYPE, VEHICLE_TYPES } from '../../components/ops/labels';

interface DetectionView {
  id: number;
  imagePath: string | null;
  decision: string;
  reasons: string[];
  plate: { text: string | null; province: string | null; provinceCode: string | null; sourceType: string | null; plateConfidence: number | null; provinceConfidence: number | null };
}
interface SessionSum {
  id: number;
  parkingNo: string;
  plateText: string | null;
  province: string | null;
  entryAt: string;
}
interface GateState {
  kind: string;
  at: string;
  detection?: DetectionView | null;
  session?: SessionSum;
  quote?: { due: number; net: number };
  message?: string;
  reason?: string;
  ticket?: TicketData | null;
  overstay?: boolean;
}
interface Gate {
  id: number;
  name: string;
  siteId: number;
  siteName: string;
  direction: 'ENTRY' | 'EXIT';
  state: GateState;
  devices: Array<{ id: number; type: string; name: string; status: string; last_seen_at: string | null }>;
}

type Dialog = null | { kind: 'barrier' | 'simulate' | 'issue' | 'approve'; gate: Gate };

export default function GateMonitor() {
  const { can } = useAuth();
  const toast = useToast();
  const gates = useAsync(() => get<{ gates: Gate[] }>('/api/gates').then((r) => r.gates), []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [opened, setOpened] = useState<Record<number, string>>({});

  // Device heartbeats have no push event; poll them.
  useEffect(() => {
    const t = setInterval(() => gates.reload(), 30_000);
    return () => clearInterval(t);
  }, [gates.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const { connected } = useSocketEvents({
    'gate:state': (p: { gateId: number; state: GateState }) => gates.setData((gs) => gs?.map((g) => (g.id === p.gateId ? { ...g, state: p.state } : g)) ?? gs),
  });

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const bySite = new Map<string, Gate[]>();
  for (const g of gates.data ?? []) bySite.set(g.siteName, [...(bySite.get(g.siteName) ?? []), g]);

  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">ทางเข้า–ออก (Live)</h1>
        <span className="small muted">
          <span className={`dot ${connected ? 'dot-online' : 'dot-offline'}`} /> {connected ? 'เชื่อมต่อ Real-time' : 'ไม่ได้เชื่อมต่อ'}
        </span>
        <div className="actions">
          <Button size="sm" onClick={gates.reload} loading={gates.loading}>
            รีเฟรช
          </Button>
        </div>
      </div>
      {gates.error && <div className="card" style={{ color: 'var(--color-danger)' }}>{gates.error}</div>}
      {gates.data && !gates.data.length && <Empty>ยังไม่มีทางเข้า–ออก</Empty>}
      {[...bySite.entries()].map(([site, list]) => (
        <div key={site} className="col" style={{ gap: 12 }}>
          {bySite.size > 1 && <h3 style={{ margin: 0 }}>{site}</h3>}
          <div className="grid grid-2">
            {list.map((g) => (
              <GateCard
                key={g.id}
                g={g}
                openedAt={opened[g.id]}
                can={can}
                onBarrier={() => setDialog({ kind: 'barrier', gate: g })}
                onSimulate={() => setDialog({ kind: 'simulate', gate: g })}
                onIssue={() => setDialog({ kind: 'issue', gate: g })}
                onApprove={() => setDialog({ kind: 'approve', gate: g })}
                onReset={() => run(() => post(`/api/gates/${g.id}/reset`), `รีเซ็ต ${g.name}`)}
              />
            ))}
          </div>
        </div>
      ))}

      <ApprovalDialog
        open={dialog?.kind === 'barrier'}
        title={`เปิดไม้กั้นด้วยมือ — ${dialog?.gate.name ?? ''}`}
        description="การเปิดไม้กั้นด้วยมือจะถูกบันทึกและแจ้งเตือนผู้จัดการ"
        submitText="เปิดไม้กั้น"
        onClose={() => setDialog(null)}
        onSubmit={async (v) => {
          const g = dialog!.gate;
          await post(`/api/gates/${g.id}/barrier/open`, { ...v, sessionId: g.state.session?.id });
          setOpened((o) => ({ ...o, [g.id]: new Date().toISOString() }));
          toast(`ส่งคำสั่งเปิดไม้กั้น ${g.name}`, 'success');
        }}
      />
      {dialog?.kind === 'simulate' && <SimulateDialog gate={dialog.gate} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'issue' && <IssueDialog gate={dialog.gate} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'approve' && <ApproveExitDialog gate={dialog.gate} onClose={() => setDialog(null)} />}
    </>
  );
}

function GateCard({
  g,
  openedAt,
  can,
  onBarrier,
  onSimulate,
  onIssue,
  onApprove,
  onReset,
}: {
  g: Gate;
  openedAt?: string;
  can: (...p: string[]) => boolean;
  onBarrier: () => void;
  onSimulate: () => void;
  onIssue: () => void;
  onApprove: () => void;
  onReset: () => void;
}) {
  const st = g.state;
  const alertKinds = ['ENTRY_REVIEW', 'ENTRY_DENIED', 'EXIT_NOT_FOUND', 'EXIT_MISMATCH'];
  const tone = alertKinds.includes(st.kind) ? 'danger' : st.kind === 'IDLE' ? '' : st.kind === 'EXIT_PAYMENT' || st.kind === 'ENTRY_CONFIRM' ? 'warning' : 'success';
  return (
    <Card
      title={
        <span className="row" style={{ gap: 8 }}>
          {g.name} <Badge tone={g.direction === 'ENTRY' ? 'info' : ''}>{g.direction === 'ENTRY' ? 'ทางเข้า' : 'ทางออก'}</Badge>
        </span>
      }
      actions={<span className="small muted">{time(st.at, true)}</span>}
      style={alertKinds.includes(st.kind) ? { borderColor: 'var(--color-danger)' } : undefined}
    >
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Badge tone={tone as 'danger' | 'warning' | 'success' | ''}>{label(GATE_STATE, st.kind)}</Badge>
          {st.message && <span className="small">{st.message}</span>}
          {st.reason && <span className="small muted">{st.reason}</span>}
        </div>

        {(st.detection || st.session) && (
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <SecureImage path={st.detection?.imagePath} height={130} caption={st.detection ? `กล้อง: ${st.detection.plate.text ?? 'อ่านไม่ได้'} ${st.detection.plate.province ?? ''}` : 'ไม่มีภาพ'} />
            <div className="col" style={{ gap: 6 }}>
              {st.detection && (
                <div className="small">
                  {label(DECISION, st.detection.decision)} · {label(SOURCE_TYPE, st.detection.plate.sourceType)} · {pct(st.detection.plate.plateConfidence)} / {pct(st.detection.plate.provinceConfidence)}
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {st.detection.reasons.map((r) => (
                      <Badge key={r} tone="warning">
                        {label(REASON, r)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {st.session && (
                <div className="col" style={{ gap: 4 }}>
                  <PlateBadge plate={st.session.plateText} province={st.session.province} size={15} />
                  <Link to={`/admin/sessions/${st.session.id}`} className="small mono">
                    {st.session.parkingNo}
                  </Link>
                  <span className="small muted">เข้า {dateTime(st.session.entryAt)}</span>
                  {st.quote && (
                    <span className="small">
                      ค้างชำระ <b>{money(st.quote.due)}</b>
                      {st.overstay && <Badge tone="danger">เกินเวลาหลังชำระ</Badge>}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {g.devices.map((d) => (
            <span key={d.id} className="badge" title={`${d.name} · เห็นล่าสุด ${dateTime(d.last_seen_at)}`}>
              <span className={`dot ${d.status === 'ONLINE' ? 'dot-online' : d.status === 'UNKNOWN' ? '' : 'dot-offline'}`} /> {label(DEVICE_TYPE, d.type)}
            </span>
          ))}
          {openedAt && <span className="small muted">เปิดไม้กั้นด้วยมือ {time(openedAt, true)}</span>}
        </div>

        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {st.kind === 'EXIT_MISMATCH' && can('gate.control') && (
            <Button size="sm" variant="primary" onClick={onApprove}>
              ตรวจสอบ & อนุมัติให้ออก
            </Button>
          )}
          {g.direction === 'ENTRY' && can('sessions.create_manual', 'gate.control') && (
            <Button size="sm" variant={st.kind === 'ENTRY_REVIEW' ? 'primary' : 'default'} onClick={onIssue}>
              ออกบัตร / กรอกทะเบียน
            </Button>
          )}
          {can('gate.open_manual') && (
            <Button size="sm" variant="danger" onClick={onBarrier}>
              เปิดไม้กั้น
            </Button>
          )}
          {can('devices.manage', 'gate.control') && (
            <Button size="sm" onClick={onSimulate}>
              จำลองกล้องอ่านป้าย
            </Button>
          )}
          {can('gate.control') && st.kind !== 'IDLE' && (
            <Button size="sm" variant="ghost" onClick={onReset}>
              รีเซ็ต
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

interface SimCandidate {
  sourceType: string;
  mode: 'plate' | 'text';
  prefix: string;
  number: string;
  text: string;
  province: string;
  plateConfidence: number | null;
  provinceConfidence: number | null;
}
const blankCandidate = (sourceType = 'REAL_PLATE'): SimCandidate => ({ sourceType, mode: 'plate', prefix: '', number: '', text: '', province: '', plateConfidence: 95, provinceConfidence: 90 });

function SimulateDialog({ gate, onClose }: { gate: Gate; onClose: () => void }) {
  const toast = useToast();
  const [cands, setCands] = useState<SimCandidate[]>([blankCandidate()]);
  const [vehicleType, setVehicleType] = useState('CAR');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const upd = (i: number, patch: Partial<SimCandidate>) => setCands((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const submit = async () => {
    const candidates = cands.map((c) => ({
      sourceType: c.sourceType,
      ...(c.mode === 'plate' ? { plate: `${c.prefix.trim()}${c.number.trim()}`, province: c.province.trim() } : { text: c.text }),
      plateConfidence: c.plateConfidence ?? 0,
      provinceConfidence: c.provinceConfidence ?? 0,
    }));
    setBusy(true);
    try {
      const r = await post<{ state?: GateState; detection?: DetectionView }>(`/api/gates/${gate.id}/simulate`, { candidates, vehicleType });
      const st = r.state;
      setResult(st ? `${label(GATE_STATE, st.kind)}${st.message ? ` — ${st.message}` : ''}` : 'ส่งผลอ่านแล้ว');
      toast('ส่งผลอ่านจำลองแล้ว', 'success');
    } catch (e) {
      setResult(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="lg"
      title={`จำลองกล้องอ่านป้าย — ${gate.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>ปิด</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            ส่งผลอ่าน
          </Button>
        </>
      }
    >
      <div className="col">
        <div className="small muted">ใช้ทดสอบ/ฝึกอบรมโดยไม่ต้องมีกล้องจริง ผลอ่านจะผ่านขั้นตอนเดียวกับกล้องจริงทุกประการ (บันทึกใน Audit Log)</div>
        {cands.map((c, i) => (
          <fieldset key={i} className="group">
            <legend>ผลอ่าน #{i + 1}</legend>
            <div className="grid grid-3">
              <Field label="แหล่งที่มา">
                <Select value={c.sourceType} options={SOURCE_TYPES.filter((t) => t !== 'MANUAL_ENTRY').map((t) => ({ value: t, label: label(SOURCE_TYPE, t) }))} onChange={(e) => upd(i, { sourceType: e.target.value })} />
              </Field>
              <Field label="รูปแบบข้อมูล">
                <Select
                  value={c.mode}
                  options={[
                    { value: 'plate', label: 'หมวด/เลข + จังหวัด (LPR)' },
                    { value: 'text', label: 'ข้อความดิบ (OCR)' },
                  ]}
                  onChange={(e) => upd(i, { mode: e.target.value as 'plate' | 'text' })}
                />
              </Field>
              <Field label="ประเภทรถ">
                <Select value={vehicleType} options={VEHICLE_TYPES} onChange={(e) => setVehicleType(e.target.value)} disabled={i > 0} />
              </Field>
              {c.mode === 'plate' ? (
                <>
                  <Field label="หมวด">
                    <Input value={c.prefix} onChange={(e) => upd(i, { prefix: e.target.value })} placeholder="1กข" />
                  </Field>
                  <Field label="เลข">
                    <Input value={c.number} onChange={(e) => upd(i, { number: e.target.value })} placeholder="1234" />
                  </Field>
                  <Field label="จังหวัด (ข้อความที่อ่านได้)">
                    <Input value={c.province} onChange={(e) => upd(i, { province: e.target.value })} placeholder="กรุงเทพมหานคร / กรงเทพ" />
                  </Field>
                </>
              ) : (
                <Field label="ข้อความ OCR (หลายบรรทัดได้)" className="" >
                  <TextArea value={c.text} onChange={(e) => upd(i, { text: e.target.value })} placeholder={'กข 1234\nกรุงเทพมหานคร'} />
                </Field>
              )}
              <Field label="ความมั่นใจทะเบียน (%)">
                <NumberInput value={c.plateConfidence} onChange={(v) => upd(i, { plateConfidence: v })} min={0} max={100} />
              </Field>
              <Field label="ความมั่นใจจังหวัด (%)">
                <NumberInput value={c.provinceConfidence} onChange={(v) => upd(i, { provinceConfidence: v })} min={0} max={100} />
              </Field>
            </div>
            {cands.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => setCands((cs) => cs.filter((_, j) => j !== i))}>
                ลบผลอ่านนี้
              </Button>
            )}
          </fieldset>
        ))}
        {cands.length < 2 && (
          <Button size="sm" onClick={() => setCands((cs) => [...cs, blankCandidate('PAPER_SIGN')])}>
            + เพิ่มผลอ่านที่ 2 (เช่น ป้ายกระดาษบนกระจก)
          </Button>
        )}
        {result && <div className="card small">ผลลัพธ์: {result}</div>}
      </div>
    </Modal>
  );
}

function IssueDialog({ gate, onClose }: { gate: Gate; onClose: () => void }) {
  const toast = useToast();
  const design = useDesign()?.config ?? null;
  const det = gate.state.detection ?? null;
  const [prefix, setPrefix] = useState(det?.plate.text?.split(' ')[0] ?? '');
  const [number, setNumber] = useState(det?.plate.text?.split(' ')[1] ?? '');
  const [province, setProvince] = useState<string | null>(det?.plate.provinceCode && det.plate.provinceCode !== '?' ? det.plate.provinceCode : null);
  const [vehicleType, setVehicleType] = useState('CAR');
  const [unplated, setUnplated] = useState(false);
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState('');
  const [print, setPrint] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!unplated && (!prefix.trim() || !number.trim())) return setErr('กรุณากรอกหมวดและเลขทะเบียน หรือเลือก "ออกบัตรโดยไม่มีทะเบียน"');
    if (!reason.trim()) return setErr('กรุณาระบุเหตุผล');
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ session: { id: number; parkingNo: string }; ticket: TicketData | null; warnings: string[] }>(`/api/gates/${gate.id}/entry/issue`, {
        detectionId: det?.id,
        ...(unplated ? { unplated: true } : { prefix: prefix.trim(), number: number.trim(), province }),
        vehicleType,
        force,
        reason: reason.trim(),
      });
      toast(`ออกบัตร ${r.session.parkingNo}${r.warnings?.length ? ` (${r.warnings.join(', ')})` : ''}`, 'success');
      if (print && r.ticket) await printDoc(ticketDoc(r.ticket), design, null);
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`ออกบัตร / กรอกทะเบียน — ${gate.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            ออกบัตร
          </Button>
        </>
      }
    >
      <div className="col">
        {det && (
          <div className="small muted">
            ผลอ่านกล้อง #{det.id}: {det.plate.text ?? 'อ่านไม่ได้'} {det.plate.province ?? ''}
          </div>
        )}
        <Check label="ออกบัตรโดยไม่มีทะเบียน (อ่านป้ายไม่ได้/ไม่มีป้าย)" checked={unplated} onChange={setUnplated} />
        {!unplated && (
          <div className="grid grid-3">
            <Field label="หมวด">
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={5} />
            </Field>
            <Field label="เลข">
              <Input value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} maxLength={4} inputMode="numeric" />
            </Field>
            <Field label="จังหวัด">
              <ProvinceSelect value={province} onChange={setProvince} />
            </Field>
          </div>
        )}
        <Field label="ประเภทรถ">
          <Select value={vehicleType} options={VEHICLE_TYPES} onChange={(e) => setVehicleType(e.target.value)} />
        </Field>
        <Field label="เหตุผล (บันทึกใน Audit Log)">
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น กล้องอ่านไม่ได้ ตรวจสอบป้ายด้วยสายตา" />
        </Field>
        <Check label="ยกเว้นการตรวจสอบรถซ้ำ/ลานเต็ม (force)" checked={force} onChange={setForce} />
        <Check label="พิมพ์บัตรจากเครื่องนี้ (ถ้า Kiosk พิมพ์ไม่ได้)" checked={print} onChange={setPrint} />
        {err && <div style={{ color: 'var(--color-danger)' }}>{err}</div>}
      </div>
    </Modal>
  );
}

function ApproveExitDialog({ gate, onClose }: { gate: Gate; onClose: () => void }) {
  const toast = useToast();
  const st = gate.state;
  const sessionId = st.session?.id;
  const detail = useAsync(
    () => (sessionId ? get<{ detections: Array<{ direction: string; imagePath: string | null; capturedAt: string }> }>(`/api/sessions/${sessionId}`) : Promise.resolve(null)),
    [sessionId],
  );
  const entryImg = detail.data?.detections.find((d) => d.direction === 'ENTRY');
  return (
    <ApprovalDialog
      open
      title={`ทะเบียนไม่ตรง — ${gate.name}`}
      description="เปรียบเทียบภาพขาเข้าและขาออก หากเป็นรถคันเดียวกันให้อนุมัติ ระบบจะตรวจสอบค่าจอดและเปิดไม้กั้นตามปกติ"
      submitText="อนุมัติให้ออก"
      onClose={onClose}
      onSubmit={async (v) => {
        await post(`/api/gates/${gate.id}/exit/approve`, { sessionId, reason: v.reason });
        toast('อนุมัติแล้ว', 'success');
      }}
    >
      <div className="grid grid-2">
        <div className="col" style={{ gap: 6 }}>
          <b>ขาเข้า</b>
          <SecureImage path={entryImg?.imagePath} height={200} caption={entryImg ? dateTime(entryImg.capturedAt) : undefined} />
          {st.session && <PlateBadge plate={st.session.plateText} province={st.session.province} />}
        </div>
        <div className="col" style={{ gap: 6 }}>
          <b>ขาออก</b>
          <SecureImage path={st.detection?.imagePath} height={200} caption={dateTime(st.at)} />
          <PlateBadge plate={st.detection?.plate.text} province={st.detection?.plate.province} />
        </div>
      </div>
    </ApprovalDialog>
  );
}

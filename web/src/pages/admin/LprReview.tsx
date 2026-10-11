import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { provinceByCode } from '@pp/shared/provinces';
import { get, post } from '../../lib/api';
import { useSocketEvents } from '../../lib/useSocket';
import { dateTime } from '../../lib/format';
import { Badge, Button, Card, Empty, errorText, Field, Input, ProvinceSelect, Tabs, useAsync, useToast } from '../../components/ui';
import { SecureImage } from '../../components/ops/SecureImage';
import { CandidateTable, type Candidate } from '../../components/ops/CandidateTable';
import { DECISION, label, pct, REASON, REVIEW_STATUS, SOURCE_TYPE } from '../../components/ops/labels';

interface Detection {
  id: number;
  siteId: number | null;
  gateId: number | null;
  direction: string;
  capturedAt: string;
  imagePath: string | null;
  candidates: Candidate[];
  selectedIndex: number | null;
  decision: string;
  reasons: string[];
  conflict: boolean;
  plate: { prefix: string | null; number: string | null; provinceCode: string | null; province: string | null; text: string | null; sourceType: string | null; plateConfidence: number | null; provinceConfidence: number | null };
  reviewStatus: string;
  original: { decision: string; reasons: string[]; selected: Candidate | null } | null;
  corrected: { before: PlateSnap; after: PlateSnap } | null;
  correctedBy: number | null;
  correctedAt: string | null;
  sessionId: number | null;
}
interface PlateSnap {
  prefix: string | null;
  number: string | null;
  province: string | null;
  sourceType: string | null;
}

type Status = 'PENDING' | 'RESOLVED' | 'DISMISSED';

const snapText = (p: PlateSnap | null | undefined) => (p?.prefix ? `${p.prefix} ${p.number} ${provinceByCode(p.province)?.th ?? '(ไม่ทราบจังหวัด)'}` : 'อ่านไม่ได้');

export default function LprReview() {
  const [tab, setTab] = useState<Status>('PENDING');
  const list = useAsync(() => get<{ items: Detection[] }>(`/api/sessions/review?status=${tab}`).then((r) => r.items), [tab]);
  const gates = useAsync(() => get<{ gates: Array<{ id: number; name: string }> }>('/api/gates').then((r) => r.gates), []);
  const gateName = (id: number | null) => gates.data?.find((g) => g.id === id)?.name ?? `ประตู #${id ?? '-'}`;

  useSocketEvents({
    'detection:new': (d: Detection) => {
      if (tab === 'PENDING' && d.reviewStatus === 'PENDING') list.setData((xs) => (xs?.some((x) => x.id === d.id) ? xs : [d, ...(xs ?? [])]));
    },
    'alert:resolved': (p: { dedupeKey?: string }) => {
      const m = /^LPR_REVIEW:(\d+)$/.exec(p?.dedupeKey ?? '');
      if (m && tab === 'PENDING') list.setData((xs) => xs?.filter((x) => x.id !== Number(m[1])) ?? xs);
    },
  });

  const remove = (id: number) => list.setData((xs) => xs?.filter((x) => x.id !== id) ?? xs);

  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">ตรวจสอบป้ายทะเบียน</h1>
        {tab === 'PENDING' && list.data && <Badge tone={list.data.length ? 'warning' : 'success'}>{list.data.length} รายการรอตรวจสอบ</Badge>}
        <div className="actions">
          <Button size="sm" onClick={list.reload} loading={list.loading}>
            รีเฟรช
          </Button>
        </div>
      </div>
      <Tabs<Status>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'PENDING', label: 'รอตรวจสอบ' },
          { id: 'RESOLVED', label: 'แก้ไขแล้ว' },
          { id: 'DISMISSED', label: 'ปิดรายการ' },
        ]}
      />
      {list.error && <div className="card" style={{ color: 'var(--color-danger)' }}>{list.error}</div>}
      {list.data && !list.data.length && <Empty>{tab === 'PENDING' ? 'ไม่มีรายการรอตรวจสอบ 🎉' : 'ไม่มีรายการ'}</Empty>}
      {(list.data ?? []).map((d) => (tab === 'PENDING' ? <ReviewItem key={d.id} d={d} gate={gateName(d.gateId)} onDone={() => remove(d.id)} /> : <ResolvedItem key={d.id} d={d} gate={gateName(d.gateId)} />))}
    </>
  );
}

function Header({ d, gate }: { d: Detection; gate: string }) {
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <b>#{d.id}</b>
      <span>{gate}</span>
      <Badge tone={d.direction === 'ENTRY' ? 'info' : ''}>{d.direction === 'ENTRY' ? 'ขาเข้า' : 'ขาออก'}</Badge>
      <span className="small muted">{dateTime(d.capturedAt)}</span>
      <Badge>{d.original?.decision ?? d.decision}</Badge>
      <span className="small">{label(DECISION, d.original?.decision ?? d.decision)}</span>
      {(d.original?.reasons ?? d.reasons).map((r) => (
        <Badge key={r} tone="warning">
          {label(REASON, r)}
        </Badge>
      ))}
      {d.conflict && <Badge tone="danger">มีหลายทะเบียน</Badge>}
      {d.sessionId && (
        <Link to={`/admin/sessions/${d.sessionId}`} className="small">
          รายการจอด #{d.sessionId} →
        </Link>
      )}
    </div>
  );
}

function ReviewItem({ d, gate, onDone }: { d: Detection; gate: string; onDone: () => void }) {
  const toast = useToast();
  const sel = d.selectedIndex != null ? d.candidates[d.selectedIndex] : null;
  const [prefix, setPrefix] = useState(d.plate.prefix ?? '');
  const [number, setNumber] = useState(d.plate.number ?? '');
  const [province, setProvince] = useState<string | null>(d.plate.provinceCode && d.plate.provinceCode !== '?' ? d.plate.provinceCode : null);
  const [override, setOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggestions = useMemo(() => {
    const seen = new Map<string, { code: string; th: string; similarity: number }>();
    for (const c of d.candidates) for (const s of c.provinceSuggestions ?? []) if (!seen.has(s.code) || seen.get(s.code)!.similarity < s.similarity) seen.set(s.code, s);
    return [...seen.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  }, [d.candidates]);
  useEffect(() => setOverride(null), [d.id]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'success');
      onDone();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const pick = (c: Candidate) =>
    run(() => post(`/api/sessions/detections/${d.id}/correct`, { candidateIndex: c.index, province: override ?? undefined, reason: 'LPR review: เลือกผลอ่าน' }), `ยืนยัน ${c.prefix} ${c.number}`);
  const manual = () => {
    if (!prefix.trim() || !number.trim()) return toast('กรุณากรอกหมวดและเลขทะเบียน', 'error');
    return run(
      () => post(`/api/sessions/detections/${d.id}/correct`, { prefix: prefix.trim(), number: number.trim(), province, sourceType: 'MANUAL_ENTRY', reason: 'LPR review: กรอกด้วยมือ' }),
      `บันทึก ${prefix} ${number}`,
    );
  };

  return (
    <Card>
      <Header d={d} gate={gate} />
      <div className="grid mt" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <SecureImage path={d.imagePath} caption="ภาพเต็มจากกล้อง" height={300} />
        <div className="col" style={{ gap: 10 }}>
          <div className="small muted">ผลที่ระบบเลือก</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {d.plate.text ?? 'อ่านไม่ได้'} <span style={{ fontSize: 16, fontWeight: 500 }}>{d.plate.province ?? '(ไม่ทราบจังหวัด)'}</span>
          </div>
          <div className="small">
            {label(SOURCE_TYPE, d.plate.sourceType)} · ทะเบียน {pct(d.plate.plateConfidence)} · จังหวัด {pct(d.plate.provinceConfidence)}
          </div>
          {sel?.provinceRaw && (
            <div className="small">
              ข้อความจังหวัดที่อ่านได้: <span className="mono">{sel.provinceRaw}</span>
            </div>
          )}
          <Field label="จังหวัดที่จะใช้เมื่อเลือกผลอ่าน (ถ้าต้องการแก้)">
            <ProvinceSelect value={override} onChange={setOverride} />
          </Field>
          {suggestions.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="small muted">จังหวัดที่ใกล้เคียง:</span>
              {suggestions.map((s) => (
                <Button key={s.code} size="sm" variant={override === s.code ? 'primary' : 'default'} onClick={() => (setOverride(s.code), setProvince(s.code))}>
                  {s.th} {Math.round(s.similarity * 100)}%
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt">
        <CandidateTable candidates={d.candidates} selectedIndex={d.selectedIndex} onPick={busy ? undefined : pick} pickLabel="ใช้ผลนี้" />
      </div>
      <fieldset className="group mt">
        <legend>กรอกทะเบียนด้วยมือ</legend>
        <div className="filters">
          <Field label="หมวด">
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={5} style={{ width: 110 }} />
          </Field>
          <Field label="เลขทะเบียน">
            <Input value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} maxLength={4} inputMode="numeric" style={{ width: 110 }} />
          </Field>
          <Field label="จังหวัด">
            <ProvinceSelect value={province} onChange={setProvince} />
          </Field>
          <Button variant="primary" loading={busy} onClick={manual}>
            บันทึก
          </Button>
          <span className="spacer" />
          <Button variant="ghost" loading={busy} onClick={() => run(() => post(`/api/sessions/detections/${d.id}/dismiss`, { reason: 'ไม่ใช่รถ/ภาพซ้ำ' }), 'ปิดรายการแล้ว')}>
            ปิดรายการ (ไม่ใช่รถ/ซ้ำ)
          </Button>
        </div>
      </fieldset>
    </Card>
  );
}

function ResolvedItem({ d, gate }: { d: Detection; gate: string }) {
  const [open, setOpen] = useState(false);
  const orig = d.corrected?.before ?? (d.original?.selected ? { prefix: d.original.selected.prefix, number: d.original.selected.number, province: d.original.selected.provinceCode, sourceType: d.original.selected.sourceType } : null);
  return (
    <Card>
      <Header d={d} gate={gate} />
      <div className="grid grid-3 mt" style={{ alignItems: 'center' }}>
        <SecureImage path={d.imagePath} height={140} caption="ภาพจากกล้อง" />
        <div className="col" style={{ gap: 4 }}>
          <span className="small muted">ผลเดิม (ระบบ)</span>
          <span className="mono" style={{ fontSize: 17 }}>
            {snapText(orig)}
          </span>
          <span className="small muted">{label(SOURCE_TYPE, orig?.sourceType)}</span>
        </div>
        <div className="col" style={{ gap: 4 }}>
          <span className="small muted">{d.reviewStatus === 'RESOLVED' ? 'ผลหลังแก้ไข' : 'สถานะ'}</span>
          {d.corrected ? (
            <>
              <b className="mono" style={{ fontSize: 17, color: 'var(--color-success)' }}>
                {snapText(d.corrected.after)}
              </b>
              <span className="small muted">{label(SOURCE_TYPE, d.corrected.after.sourceType)}</span>
            </>
          ) : (
            <Badge>{label(REVIEW_STATUS, d.reviewStatus)}</Badge>
          )}
          <span className="small muted">{dateTime(d.correctedAt)}</span>
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
        {open ? 'ซ่อนผลอ่านทั้งหมด' : `ดูผลอ่านทั้งหมด (${d.candidates.length})`}
      </Button>
      {open && <CandidateTable candidates={d.candidates} selectedIndex={d.selectedIndex} />}
    </Card>
  );
}

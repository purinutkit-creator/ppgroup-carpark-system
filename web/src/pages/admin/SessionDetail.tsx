import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, newIdempotencyKey, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSocketEvents } from '../../lib/useSocket';
import { dateTime, durationText, minutesText, money, time } from '../../lib/format';
import { useDesign } from '../../design/DesignProvider';
import { printDoc, type PrintBlock, type PrintDoc } from '../../print/print';
import { ticketDoc, type TicketData } from '../../print/templates';
import {
  ApprovalDialog,
  Badge,
  Button,
  Card,
  Check,
  Empty,
  errorText,
  Field,
  Input,
  Modal,
  NumberInput,
  PlateBadge,
  ProvinceSelect,
  Select,
  TextArea,
  useAsync,
  useToast,
  type ApprovalInput,
} from '../../components/ui';
import { SecureImage } from '../../components/ops/SecureImage';
import { CandidateTable, type Candidate } from '../../components/ops/CandidateTable';
import { JsonDiff } from '../../components/ops/JsonDiff';
import {
  CHANNEL,
  DECISION,
  DISCOUNT_TYPE,
  FLAG,
  label,
  METHOD,
  PAYMENT_ROW_STATUS,
  PAYMENT_STATUS,
  pct,
  REASON,
  REVIEW_STATUS,
  SESSION_STATUS,
  SOURCE_TYPE,
  VEHICLE_TYPES,
} from '../../components/ops/labels';

interface Quote {
  sessionId: number;
  parkingNo: string;
  status: string;
  paymentStatus: string;
  plate: { prefix: string | null; number: string | null; text: string | null; provinceCode: string | null; province: string | null; source: string | null };
  vehicleType: string;
  entryAt: string;
  exitAt: string | null;
  now: string;
  chargedUntil: string;
  durationSeconds: number;
  rate: { planName: string; freeMinutes: number; hourlyRate: number; billingUnitMinutes: number; graceAfterPaymentMinutes: number };
  gross: number;
  feeLines: Array<{ label: string; amount: number }>;
  extraFreeMinutes: number;
  discountFromFreeTime: number;
  discountAmount: number;
  memberDiscount: number;
  discountTotal: number;
  net: number;
  paid: number;
  due: number;
  exempt: boolean;
  fullWaiver: boolean;
  lastPaidAt: string | null;
  exitDeadlineAt: string | null;
  withinGrace: boolean;
  nextChangeAt: string | null;
  canExit: boolean;
}

interface Detection {
  id: number;
  direction: string;
  capturedAt: string;
  imagePath: string | null;
  candidates: Candidate[];
  selectedIndex: number | null;
  decision: string;
  reasons: string[];
  conflict: boolean;
  plate: { text: string | null; province: string | null; sourceType: string | null; plateConfidence: number | null; provinceConfidence: number | null };
  reviewStatus: string;
  corrected: { before: Record<string, unknown>; after: Record<string, unknown> } | null;
  correctedAt: string | null;
}

interface Detail {
  session: {
    id: number;
    parkingNo: string;
    siteId: number;
    plateText: string | null;
    province: string | null;
    provinceCode: string | null;
    plateSource: string | null;
    vehicleType: string;
    entryAt: string;
    exitAt: string | null;
    status: string;
    paymentStatus: string;
    ticketless: boolean;
    unreadPlate: boolean;
    lostTicket: boolean;
    exempt: boolean;
    memberId: number | null;
    passId: number | null;
    flags: string[];
    entryGateId: number | null;
    exitGateId: number | null;
  };
  quote: Quote;
  detections: Detection[];
  discounts: Array<{
    id: number;
    type: string;
    amount: number;
    free_minutes: number;
    full_waiver: number;
    total_spend: number | null;
    source: string | null;
    reason: string | null;
    status: string;
    created_at: string;
    created_by_name: string | null;
    approved_by_name: string | null;
    revoked_at: string | null;
    revoked_reason: string | null;
    rules: Array<{ ruleName?: string; value?: number }>;
  }>;
  validations: Array<{ id: number; receipt_ref: string; merchant_name: string | null; amount: number; status: string; counter: string | null; scanned_by_name: string | null; created_at: string; external: number }>;
  payments: Array<{
    id: number;
    amount: number;
    method: string;
    gateway: string;
    status: string;
    channel: string | null;
    paidAt: string | null;
    createdAt: string;
    cashReceived: number | null;
    changeGiven: number | null;
    needsRefund: boolean;
    refundedAmount: number;
    failureReason: string | null;
  }>;
  taxDocuments: Array<{ id: number; doc_no: string; doc_type: string; payment_id: number; amount: number; vat: number; buyer_name: string | null; created_at: string }>;
  audit: Array<{ id: number; at: string; username: string; action: string; reason: string | null; approved_by_name: string | null; before_json: string | null; after_json: string | null; device_id: number | null; receipt_no: string | null }>;
  gates: Array<{ id: number; name: string; direction: string }>;
}

type Dialog =
  | null
  | 'plate'
  | 'discount'
  | 'waive'
  | 'lost'
  | 'reprint'
  | 'cash'
  | 'cancel'
  | 'close'
  | { kind: 'revoke'; id: number }
  | { kind: 'refund'; paymentId: number; max: number }
  | { kind: 'tax'; paymentId: number };

const TAX_TITLE: Record<string, string> = { RECEIPT: 'ใบเสร็จรับเงิน', TAX_INVOICE_ABB: 'ใบกำกับภาษีอย่างย่อ', TAX_INVOICE_FULL: 'ใบกำกับภาษีเต็มรูป' };

const parse = (s: string | null) => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

function Line({ k, v, strong, tone }: { k: ReactNode; v: ReactNode; strong?: boolean; tone?: 'danger' | 'success' }) {
  return (
    <div className="row" style={{ fontWeight: strong ? 700 : undefined, fontSize: strong ? 17 : undefined, color: tone ? `var(--color-${tone})` : undefined }}>
      <span>{k}</span>
      <span className="spacer" />
      <span className="num">{v}</span>
    </div>
  );
}

export default function SessionDetail() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const toast = useToast();
  const design = useDesign()?.config ?? null;
  const { data, error, loading, reload, setData } = useAsync(() => get<Detail>(`/api/sessions/${id}`), [id]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [openAudit, setOpenAudit] = useState<number | null>(null);

  useSocketEvents({
    'session:update': (p: { id?: number }) => {
      if (p?.id === id) reload();
    },
  });
  // The fee keeps running while the vehicle is inside.
  useEffect(() => {
    if (data?.session.status !== 'ACTIVE') return;
    const t = setInterval(() => {
      get<{ quote: Quote }>(`/api/sessions/${id}`)
        .then((r) => setData((d) => (d ? { ...d, quote: r.quote } : d)))
        .catch(() => undefined);
    }, 30_000);
    return () => clearInterval(t);
  }, [id, data?.session.status, setData]);

  if (!data) return loading ? <div className="page-loading">กำลังโหลด…</div> : <Empty>{error}</Empty>;
  const { session: s, quote: qt } = data;
  const active = s.status === 'ACTIVE';
  const entryDet = data.detections.find((d) => d.direction === 'ENTRY');
  const exitDet = [...data.detections].reverse().find((d) => d.direction === 'EXIT');
  const gateName = (gid: number | null) => data.gates.find((g) => g.id === gid)?.name ?? '-';

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    await fn();
    toast(ok, 'success');
    await reload();
  };

  const printTicket = async (ticket: TicketData) => {
    try {
      await printDoc(ticketDoc(ticket), design, null);
    } catch (e) {
      toast(`พิมพ์ไม่สำเร็จ: ${errorText(e)}`, 'error');
    }
  };

  return (
    <>
      <div className="page-header">
        <Link to="/admin/sessions" className="btn btn-ghost btn-sm">
          ← กลับ
        </Link>
        <PlateBadge plate={s.plateText} province={s.province} size={22} />
        <div className="col" style={{ gap: 4 }}>
          <span className="mono">{s.parkingNo}</span>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            <Badge tone={active ? 'info' : s.status === 'CANCELLED' ? 'danger' : ''}>{label(SESSION_STATUS, s.status)}</Badge>
            <Badge tone={s.paymentStatus === 'UNPAID' ? 'warning' : 'success'}>{label(PAYMENT_STATUS, s.paymentStatus)}</Badge>
            {s.ticketless && <Badge tone="info">ไม่ใช้บัตร</Badge>}
            {s.unreadPlate && <Badge tone="warning">อ่านป้ายไม่ได้</Badge>}
            {s.lostTicket && <Badge tone="danger">บัตรหาย</Badge>}
            {s.exempt && <Badge tone="success">ยกเว้นค่าจอด</Badge>}
            {s.passId && <Badge tone="success">บัตรจอด #{s.passId}</Badge>}
            {s.memberId && <Badge tone="info">สมาชิก #{s.memberId}</Badge>}
            {s.flags.map((f) => (
              <Badge key={f} tone="warning">
                {label(FLAG, f)}
              </Badge>
            ))}
          </div>
        </div>
        <div className="actions">
          {can('sessions.edit') && <Button onClick={() => setDialog('plate')}>แก้ทะเบียน/จังหวัด</Button>}
          {active && can('payment.cash') && qt.due > 0 && (
            <Button variant="success" onClick={() => setDialog('cash')}>
              รับเงินสด
            </Button>
          )}
          {active && can('discount.manual') && <Button onClick={() => setDialog('discount')}>ให้ส่วนลด</Button>}
          {active && can('waive.create') && <Button onClick={() => setDialog('waive')}>ยกเว้นค่าจอด</Button>}
          {active && can('sessions.lost_ticket') && <Button onClick={() => setDialog('lost')}>บัตรหาย</Button>}
          {active && can('sessions.edit', 'sessions.lost_ticket') && <Button onClick={() => setDialog('reprint')}>พิมพ์บัตรใหม่</Button>}
          {active && can('gate.open_manual') && (
            <Button variant="danger" onClick={() => setDialog('close')}>
              บังคับปิดรายการ
            </Button>
          )}
          {active && can('sessions.cancel') && (
            <Button variant="danger" onClick={() => setDialog('cancel')}>
              ยกเลิกรายการ
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-2">
        <Card title="ค่าจอด (คำนวณจากเซิร์ฟเวอร์)" actions={<span className="small muted">ณ {time(qt.now, true)}</span>}>
          <div className="col" style={{ gap: 6 }}>
            <Line k="ระยะเวลาจอด" v={durationText(qt.durationSeconds)} />
            <Line k={`อัตรา: ${qt.rate.planName}`} v={`ฟรี ${minutesText(qt.rate.freeMinutes)} · ${money(qt.rate.hourlyRate)}/ชม.`} />
            {qt.feeLines.map((l, i) => (
              <Line key={i} k={<span className="small muted">· {l.label}</span>} v={<span className="small">{money(l.amount)}</span>} />
            ))}
            <div className="divider" />
            <Line k="ค่าจอดก่อนส่วนลด" v={money(qt.gross)} />
            {qt.extraFreeMinutes > 0 && <Line k={`เวลาฟรีเพิ่ม ${minutesText(qt.extraFreeMinutes)}`} v={`-${money(qt.discountFromFreeTime)}`} />}
            {qt.memberDiscount > 0 && <Line k="ส่วนลดสมาชิก" v={`-${money(qt.memberDiscount)}`} />}
            {qt.discountAmount > 0 && <Line k="ส่วนลด (บาท)" v={`-${money(qt.discountAmount)}`} />}
            {(qt.exempt || qt.fullWaiver) && <Line k={qt.exempt ? 'ยกเว้นค่าจอด (รายชื่อ/บัตรจอด)' : 'ยกเว้นค่าจอดทั้งหมด'} v={`-${money(qt.gross - qt.net - qt.discountFromFreeTime - qt.memberDiscount - qt.discountAmount)}`} />}
            <Line k="ค่าจอดสุทธิ" v={money(qt.net)} />
            <Line k="ชำระแล้ว" v={money(qt.paid)} />
            <Line k="ค้างชำระ" v={money(qt.due)} strong tone={qt.due > 0 ? 'danger' : 'success'} />
            {qt.exitDeadlineAt && (
              <Line
                k="ต้องออกก่อน"
                v={
                  <span>
                    {dateTime(qt.exitDeadlineAt)} {qt.withinGrace ? <Badge tone="success">อยู่ในเวลา</Badge> : <Badge tone="danger">เกินเวลา</Badge>}
                  </span>
                }
              />
            )}
            {active && qt.nextChangeAt && <div className="small muted">ค่าจอดจะเปลี่ยนครั้งถัดไปเวลา {time(qt.nextChangeAt)} น.</div>}
          </div>
        </Card>

        <Card title="ข้อมูลรายการ">
          <div className="kv">
            <span>เวลาเข้า</span>
            <span>
              {dateTime(s.entryAt)} · {gateName(s.entryGateId)}
            </span>
            <span>เวลาออก</span>
            <span>{s.exitAt ? `${dateTime(s.exitAt)} · ${gateName(s.exitGateId)}` : '-'}</span>
            <span>ประเภทรถ</span>
            <span>{VEHICLE_TYPES.find((v) => v.value === s.vehicleType)?.label ?? s.vehicleType}</span>
            <span>ที่มาของทะเบียน</span>
            <span>{label(SOURCE_TYPE, s.plateSource)}</span>
          </div>
          <div className="grid grid-2 mt">
            <SecureImage path={entryDet?.imagePath} caption={entryDet ? `ภาพขาเข้า · ${dateTime(entryDet.capturedAt)}` : 'ภาพขาเข้า'} height={170} />
            <SecureImage path={exitDet?.imagePath} caption={exitDet ? `ภาพขาออก · ${dateTime(exitDet.capturedAt)}` : 'ภาพขาออก'} height={170} />
          </div>
        </Card>
      </div>

      <Card title="ผลการอ่านป้ายทะเบียน (LPR / OCR)">
        {data.detections.length ? (
          <div className="col" style={{ gap: 18 }}>
            {data.detections.map((d) => (
              <div key={d.id} className="col" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <b>{d.direction === 'ENTRY' ? 'ขาเข้า' : 'ขาออก'}</b>
                  <span className="small muted">
                    #{d.id} · {dateTime(d.capturedAt)}
                  </span>
                  <Badge>{d.decision}</Badge>
                  <span className="small">{label(DECISION, d.decision)}</span>
                  {d.reasons.map((r) => (
                    <Badge key={r} tone="warning">
                      {label(REASON, r)}
                    </Badge>
                  ))}
                  {d.reviewStatus !== 'NONE' && <Badge>{label(REVIEW_STATUS, d.reviewStatus)}</Badge>}
                  <span className="spacer" />
                  <span className="small">
                    ผลสุดท้าย: <b>{d.plate.text ?? '-'}</b> {d.plate.province ?? ''} · {label(SOURCE_TYPE, d.plate.sourceType)} · {pct(d.plate.plateConfidence)} / {pct(d.plate.provinceConfidence)}
                  </span>
                </div>
                {d.corrected && (
                  <div className="small">
                    แก้ไขโดยเจ้าหน้าที่ {dateTime(d.correctedAt)}: <span className="mono">{String(d.corrected.before.prefix ?? '')} {String(d.corrected.before.number ?? '')} ({String(d.corrected.before.province ?? '?')})</span> →{' '}
                    <b className="mono">
                      {String(d.corrected.after.prefix ?? '')} {String(d.corrected.after.number ?? '')} ({String(d.corrected.after.province ?? '?')})
                    </b>
                  </div>
                )}
                <CandidateTable candidates={d.candidates} selectedIndex={d.selectedIndex} />
              </div>
            ))}
          </div>
        ) : (
          <Empty>ไม่มีข้อมูลจากกล้อง (ออกบัตร/บันทึกด้วยมือ)</Empty>
        )}
      </Card>

      <div className="grid grid-2">
        <Card title="ส่วนลด / ยกเว้น">
          {data.discounts.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ประเภท</th>
                    <th>มูลค่า</th>
                    <th>ผู้ทำ / ผู้อนุมัติ</th>
                    <th>สถานะ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.discounts.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {label(DISCOUNT_TYPE, d.type)}
                        <div className="small muted">
                          {dateTime(d.created_at)}
                          {d.reason ? ` · ${d.reason}` : ''}
                        </div>
                        {d.rules.length > 0 && <div className="small muted">{d.rules.map((r) => r.ruleName).filter(Boolean).join(', ')}</div>}
                      </td>
                      <td className="small">
                        {d.full_waiver ? 'ฟรีทั้งหมด' : [d.amount ? money(d.amount) : null, d.free_minutes ? `+${minutesText(d.free_minutes)}` : null].filter(Boolean).join(' · ')}
                        {d.total_spend != null && <div className="muted">ยอดซื้อ {money(d.total_spend)}</div>}
                      </td>
                      <td className="small">
                        {d.created_by_name ?? d.source ?? '-'}
                        {d.approved_by_name && <div className="muted">อนุมัติ: {d.approved_by_name}</div>}
                      </td>
                      <td>
                        <Badge>{d.status}</Badge>
                        {d.revoked_reason && <div className="small muted">{d.revoked_reason}</div>}
                      </td>
                      <td>
                        {d.status !== 'REVOKED' && can('discount.approve', 'validation.override') && (
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'revoke', id: d.id })}>
                            ยกเลิก
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>ไม่มีส่วนลด</Empty>
          )}
          {data.validations.length > 0 && (
            <>
              <div className="card-title mt">ใบเสร็จที่ใช้ประทับตรา</div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>ใบเสร็จ</th>
                      <th>ร้าน</th>
                      <th className="right">ยอด</th>
                      <th>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.validations.map((v) => (
                      <tr key={v.id}>
                        <td className="mono small">
                          {v.receipt_ref}
                          <div className="muted">
                            {dateTime(v.created_at)} {v.counter ? `· ${v.counter}` : ''} {v.scanned_by_name ? `· ${v.scanned_by_name}` : ''}
                          </div>
                        </td>
                        <td className="small">{v.merchant_name ?? (v.external ? 'ภายนอก' : '-')}</td>
                        <td className="right num">{money(v.amount)}</td>
                        <td>
                          <Badge>{v.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        <Card title="การชำระเงิน">
          {data.payments.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>รายการ</th>
                    <th className="right">จำนวน</th>
                    <th>สถานะ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => {
                    const paid = p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED';
                    const docs = data.taxDocuments.filter((t) => t.payment_id === p.id);
                    return (
                      <tr key={p.id}>
                        <td className="small">
                          #{p.id} {label(METHOD, p.method)} · {label(CHANNEL, p.channel)}
                          <div className="muted">{dateTime(p.paidAt ?? p.createdAt)}</div>
                          {p.cashReceived != null && (
                            <div className="muted">
                              รับ {money(p.cashReceived)} ทอน {money(p.changeGiven)}
                            </div>
                          )}
                          {p.failureReason && <div style={{ color: 'var(--color-danger)' }}>{p.failureReason}</div>}
                          {docs.map((t) => (
                            <div key={t.id} className="muted">
                              {TAX_TITLE[t.doc_type]} {t.doc_no}
                            </div>
                          ))}
                        </td>
                        <td className="right num">
                          {money(p.amount)}
                          {p.refundedAmount > 0 && <div className="small" style={{ color: 'var(--color-danger)' }}>คืน {money(p.refundedAmount)}</div>}
                        </td>
                        <td>
                          <Badge>{p.status}</Badge>
                          <div className="small muted">{label(PAYMENT_ROW_STATUS, p.status)}</div>
                          {p.needsRefund && <Badge tone="danger">ชำระซ้ำ ต้องคืนเงิน</Badge>}
                        </td>
                        <td>
                          <div className="col" style={{ gap: 4 }}>
                            {paid && can('payment.refund') && p.amount - p.refundedAmount > 0 && (
                              <Button size="sm" onClick={() => setDialog({ kind: 'refund', paymentId: p.id, max: Math.round((p.amount - p.refundedAmount) * 100) / 100 })}>
                                คืนเงิน
                              </Button>
                            )}
                            {paid && can('tax.issue') && (
                              <Button size="sm" onClick={() => setDialog({ kind: 'tax', paymentId: p.id })}>
                                ใบเสร็จ/ใบกำกับ
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>ยังไม่มีการชำระเงิน</Empty>
          )}
        </Card>
      </div>

      {can('audit.view') && (
        <Card title="ประวัติการเปลี่ยนแปลง (Audit Trail)">
          {data.audit.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>เวลา</th>
                    <th>ผู้ใช้</th>
                    <th>การกระทำ</th>
                    <th>เหตุผล</th>
                    <th>ผู้อนุมัติ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((a) => (
                    <Fragment key={a.id}>
                      <tr className="clickable" onClick={() => setOpenAudit(openAudit === a.id ? null : a.id)}>
                        <td className="small nowrap">{dateTime(a.at)}</td>
                        <td className="small">{a.username}</td>
                        <td className="mono small">
                          {openAudit === a.id ? '▾' : '▸'} {a.action}
                        </td>
                        <td className="small">{a.reason ?? '-'}</td>
                        <td className="small">{a.approved_by_name ?? '-'}</td>
                      </tr>
                      {openAudit === a.id && (
                        <tr>
                          <td colSpan={5}>
                            <JsonDiff before={parse(a.before_json)} after={parse(a.after_json)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>ไม่มีประวัติ</Empty>
          )}
        </Card>
      )}

      <PlateDialog
        open={dialog === 'plate'}
        session={s}
        onClose={() => setDialog(null)}
        onSubmit={(v) => act(() => post(`/api/sessions/${id}/plate`, v), 'แก้ไขทะเบียนแล้ว')}
      />

      <DiscountDialog open={dialog === 'discount'} onClose={() => setDialog(null)} onSubmit={(v) => act(() => post(`/api/sessions/${id}/discounts`, { type: 'MANUAL_DISCOUNT', ...v }), 'บันทึกส่วนลดแล้ว')} />

      <ApprovalDialog
        open={dialog === 'waive'}
        title="ยกเว้นค่าจอดทั้งหมด"
        description={`ค่าจอดปัจจุบัน ${money(qt.net)} จะเป็น 0 ต้องได้รับการอนุมัติ`}
        onClose={() => setDialog(null)}
        onSubmit={(v) => act(() => post(`/api/sessions/${id}/discounts`, { type: 'WAIVER', ...v }), 'ยกเว้นค่าจอดแล้ว')}
      />

      <LostTicketDialog
        open={dialog === 'lost'}
        onClose={() => setDialog(null)}
        onSubmit={async (v) => {
          const r = await post<{ ticket: TicketData }>(`/api/sessions/${id}/lost-ticket`, v);
          toast('ออกบัตรใหม่แล้ว บัตรเดิมใช้ไม่ได้', 'success');
          await printTicket(r.ticket);
          await reload();
        }}
      />

      <ReasonDialog
        open={dialog === 'reprint'}
        title="พิมพ์บัตรจอดใหม่"
        description="บัตรใบเดิมจะใช้ไม่ได้ทันที (QR ใหม่)"
        required={false}
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => {
          const r = await post<{ ticket: TicketData }>(`/api/sessions/${id}/reprint`, { reason });
          await printTicket(r.ticket);
          await reload();
        }}
      />

      <CashDialog open={dialog === 'cash'} due={qt.due} onClose={() => setDialog(null)} onSubmit={(received, key) => act(() => post(`/api/sessions/${id}/pay-cash`, { received, idempotencyKey: key }), 'รับชำระเงินสดแล้ว')} />

      <ApprovalDialog
        open={dialog === 'cancel'}
        title="ยกเลิกรายการจอด"
        description="ใช้กรณีบันทึกผิด/รถไม่ได้เข้าจริง ต้องได้รับการอนุมัติ"
        onClose={() => setDialog(null)}
        onSubmit={(v) => act(() => post(`/api/sessions/${id}/cancel`, v), 'ยกเลิกรายการแล้ว')}
      />

      <ApprovalDialog
        open={dialog === 'close'}
        title="บังคับปิดรายการ (รถออกแล้ว)"
        description={qt.due > 0 ? `ยังค้างชำระ ${money(qt.due)} — การปิดรายการจะบันทึกใน Audit Log` : 'บันทึกว่ารถออกจากลานแล้ว'}
        onClose={() => setDialog(null)}
        onSubmit={(v) => act(() => post(`/api/sessions/${id}/close`, v), 'ปิดรายการแล้ว')}
      />

      <RevokeDialog
        open={typeof dialog === 'object' && dialog?.kind === 'revoke'}
        onClose={() => setDialog(null)}
        onSubmit={(v) => act(() => post(`/api/sessions/${id}/discounts/${(dialog as { id: number }).id}/revoke`, v), 'ยกเลิกส่วนลดแล้ว')}
      />

      <RefundDialog
        open={typeof dialog === 'object' && dialog?.kind === 'refund'}
        max={typeof dialog === 'object' && dialog?.kind === 'refund' ? dialog.max : 0}
        onClose={() => setDialog(null)}
        onSubmit={(v) => act(() => post(`/api/sessions/${id}/payments/${(dialog as { paymentId: number }).paymentId}/refund`, v), 'คืนเงินแล้ว')}
      />

      <TaxDialog
        open={typeof dialog === 'object' && dialog?.kind === 'tax'}
        onClose={() => setDialog(null)}
        onSubmit={async (v) => {
          const pid = (dialog as { paymentId: number }).paymentId;
          const r = await post<{ document: TaxDocument; company?: Company; reprint?: boolean }>(`/api/sessions/${id}/payments/${pid}/tax-document`, v);
          const pay = data.payments.find((p) => p.id === pid)!;
          await printDoc(taxDoc(r.document, r.company ?? null, { parkingNo: s.parkingNo, plate: s.plateText, province: s.province, entryAt: s.entryAt, method: label(METHOD, pay.method), reprint: !!r.reprint }), design, null);
          toast(r.reprint ? `พิมพ์สำเนา ${r.document.doc_no}` : `ออกเอกสาร ${r.document.doc_no}`, 'success');
          await reload();
        }}
      />
    </>
  );
}

// ------------------------------------------------------------- dialogs ----

function FormModal({ open, title, onClose, onSubmit, children, submitText = 'บันทึก' }: { open: boolean; title: ReactNode; onClose: () => void; onSubmit: () => Promise<void>; children: ReactNode; submitText?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) setErr(null);
  }, [open]);
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onSubmit();
                onClose();
              } catch (e) {
                setErr(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {submitText}
          </Button>
        </>
      }
    >
      <div className="col">
        {children}
        {err && <div style={{ color: 'var(--color-danger)' }}>{err}</div>}
      </div>
    </Modal>
  );
}

function PlateDialog({ open, session, onClose, onSubmit }: { open: boolean; session: Detail['session']; onClose: () => void; onSubmit: (v: Record<string, unknown>) => Promise<void> }) {
  const [prefix, setPrefix] = useState('');
  const [number, setNumber] = useState('');
  const [province, setProvince] = useState<string | null>(null);
  const [vehicleType, setVehicleType] = useState('CAR');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (!open) return;
    const [p, n] = (session.plateText ?? '').split(' ');
    setPrefix(p ?? '');
    setNumber(n ?? '');
    setProvince(session.provinceCode && session.provinceCode !== '?' ? session.provinceCode : null);
    setVehicleType(session.vehicleType);
    setReason('');
  }, [open, session]);
  return (
    <FormModal
      open={open}
      title="แก้ไขทะเบียน / จังหวัด"
      onClose={onClose}
      onSubmit={async () => {
        if (!prefix.trim() || !number.trim()) throw new Error('กรุณากรอกหมวดและเลขทะเบียน');
        if (!reason.trim()) throw new Error('กรุณาระบุเหตุผล');
        await onSubmit({ prefix: prefix.trim(), number: number.trim(), province, vehicleType, reason: reason.trim() });
      }}
    >
      <div className="grid grid-2">
        <Field label="หมวดอักษร (เช่น 1กข)">
          <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={5} />
        </Field>
        <Field label="เลขทะเบียน">
          <Input value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={4} />
        </Field>
        <Field label="จังหวัด">
          <ProvinceSelect value={province} onChange={setProvince} />
        </Field>
        <Field label="ประเภทรถ">
          <Select value={vehicleType} options={VEHICLE_TYPES} onChange={(e) => setVehicleType(e.target.value)} />
        </Field>
      </div>
      <Field label="เหตุผล (บันทึกใน Audit Log)">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="small muted">หมายเหตุ: ประเภทรถไม่เปลี่ยนอัตราค่าจอดที่ใช้ตอนเข้า</div>
    </FormModal>
  );
}

function DiscountDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (v: ApprovalInput & { amount?: number; freeMinutes?: number }) => Promise<void> }) {
  const [mode, setMode] = useState<'amount' | 'minutes'>('amount');
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (open) setValue(null);
  }, [open]);
  return (
    <ApprovalDialog
      open={open}
      title="ให้ส่วนลดโดยเจ้าหน้าที่"
      description="ส่วนลดต้องได้รับการอนุมัติจากผู้มีสิทธิ์"
      onClose={onClose}
      onSubmit={async (v) => {
        if (!value || value <= 0) throw new Error('กรุณาระบุจำนวนส่วนลด');
        await onSubmit({ ...v, ...(mode === 'amount' ? { amount: value } : { freeMinutes: Math.round(value) }) });
      }}
    >
      <div className="grid grid-2">
        <Field label="ชนิดส่วนลด">
          <Select
            value={mode}
            options={[
              { value: 'amount', label: 'จำนวนเงิน (บาท)' },
              { value: 'minutes', label: 'เวลาจอดฟรีเพิ่ม (นาที)' },
            ]}
            onChange={(e) => setMode(e.target.value as 'amount' | 'minutes')}
          />
        </Field>
        <Field label={mode === 'amount' ? 'บาท' : 'นาที'}>
          <NumberInput value={value} onChange={setValue} min={0} step={mode === 'amount' ? 1 : 15} />
        </Field>
      </div>
    </ApprovalDialog>
  );
}

function LostTicketDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (v: { reason: string; chargeFee: boolean }) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [charge, setCharge] = useState(true);
  useEffect(() => {
    if (open) (setReason(''), setCharge(true));
  }, [open]);
  return (
    <FormModal
      open={open}
      title="บัตรจอดหาย — ออกบัตรใหม่"
      submitText="ออกบัตรและพิมพ์"
      onClose={onClose}
      onSubmit={async () => {
        if (!reason.trim()) throw new Error('กรุณาระบุเหตุผล');
        await onSubmit({ reason: reason.trim(), chargeFee: charge });
      }}
    >
      <Check label="เรียกเก็บค่าปรับบัตรหายตามอัตรา" checked={charge} onChange={setCharge} />
      <Field label="เหตุผล / หลักฐานที่ตรวจสอบ">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ตรวจสอบเล่มทะเบียนรถ/บัตรประชาชนแล้ว" />
      </Field>
      <div className="small muted">บัตรใบเดิมจะใช้ไม่ได้ทันที</div>
    </FormModal>
  );
}

function ReasonDialog({ open, title, description, required = true, onClose, onSubmit }: { open: boolean; title: string; description?: string; required?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <FormModal
      open={open}
      title={title}
      submitText="ยืนยัน"
      onClose={onClose}
      onSubmit={async () => {
        if (required && !reason.trim()) throw new Error('กรุณาระบุเหตุผล');
        await onSubmit(reason.trim());
      }}
    >
      {description && <div className="muted">{description}</div>}
      <Field label="เหตุผล">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormModal>
  );
}

function CashDialog({ open, due, onClose, onSubmit }: { open: boolean; due: number; onClose: () => void; onSubmit: (received: number, key: string) => Promise<void> }) {
  const [received, setReceived] = useState<number | null>(null);
  const [key, setKey] = useState('');
  useEffect(() => {
    if (open) (setReceived(due), setKey(newIdempotencyKey()));
  }, [open, due]);
  const change = (received ?? 0) - due;
  return (
    <FormModal
      open={open}
      title="รับชำระเงินสด"
      submitText="ยืนยันรับเงิน"
      onClose={onClose}
      onSubmit={async () => {
        if ((received ?? 0) < due) throw new Error('จำนวนเงินที่รับน้อยกว่ายอดชำระ');
        await onSubmit(received!, key);
      }}
    >
      <Line k="ยอดที่ต้องชำระ" v={money(due)} strong />
      <Field label="รับเงินมา (บาท)">
        <NumberInput value={received} onChange={setReceived} min={0} className="input-lg" autoFocus />
      </Field>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {[20, 50, 100, 500, 1000].filter((n) => n >= due).map((n) => (
          <Button key={n} size="sm" onClick={() => setReceived(n)}>
            {money(n)}
          </Button>
        ))}
      </div>
      <Line k="เงินทอน" v={money(Math.max(0, change))} strong tone={change >= 0 ? 'success' : 'danger'} />
    </FormModal>
  );
}

function RevokeDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (v: ApprovalInput & { releaseReceipts: boolean }) => Promise<void> }) {
  const [release, setRelease] = useState(false);
  useEffect(() => {
    if (open) setRelease(false);
  }, [open]);
  return (
    <ApprovalDialog open={open} title="ยกเลิกส่วนลด" description="ค่าจอดจะถูกคำนวณใหม่ทันที" onClose={onClose} onSubmit={(v) => onSubmit({ ...v, releaseReceipts: release })}>
      <Check label="คืนสิทธิ์ใบเสร็จ (ใบเสร็จกลับมาใช้ประทับตราได้อีก)" checked={release} onChange={setRelease} />
    </ApprovalDialog>
  );
}

function RefundDialog({ open, max, onClose, onSubmit }: { open: boolean; max: number; onClose: () => void; onSubmit: (v: ApprovalInput & { amount: number }) => Promise<void> }) {
  const [amount, setAmount] = useState<number | null>(max);
  useEffect(() => {
    if (open) setAmount(max);
  }, [open, max]);
  return (
    <ApprovalDialog
      open={open}
      requireApprover
      title="คืนเงิน"
      description="ต้องได้รับการอนุมัติจากผู้มีสิทธิ์อีกคนหนึ่ง (ไม่สามารถอนุมัติตนเองได้)"
      submitText="คืนเงิน"
      onClose={onClose}
      onSubmit={async (v) => {
        if (!amount || amount <= 0 || amount > max) throw new Error(`จำนวนเงินต้องอยู่ระหว่าง 0.01 – ${max}`);
        await onSubmit({ ...v, amount });
      }}
    >
      <Field label={`จำนวนเงินที่คืน (สูงสุด ${money(max)})`}>
        <NumberInput value={amount} onChange={setAmount} min={0.01} max={max} step={0.01} />
      </Field>
    </ApprovalDialog>
  );
}

function TaxDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (v: Record<string, unknown>) => Promise<void> }) {
  const [docType, setDocType] = useState('TAX_INVOICE_ABB');
  const [buyer, setBuyer] = useState({ buyerName: '', buyerTaxId: '', buyerAddress: '', buyerBranch: '' });
  useEffect(() => {
    if (open) (setDocType('TAX_INVOICE_ABB'), setBuyer({ buyerName: '', buyerTaxId: '', buyerAddress: '', buyerBranch: '' }));
  }, [open]);
  const full = docType === 'TAX_INVOICE_FULL';
  return (
    <FormModal
      open={open}
      title="ออกใบเสร็จ / ใบกำกับภาษี"
      submitText="ออกและพิมพ์"
      onClose={onClose}
      onSubmit={async () => {
        if (full && (!buyer.buyerName.trim() || !buyer.buyerTaxId.trim())) throw new Error('ใบกำกับภาษีเต็มรูปต้องมีชื่อและเลขประจำตัวผู้เสียภาษีของผู้ซื้อ');
        await onSubmit({ docType, ...(full ? buyer : {}) });
      }}
    >
      <Field label="ประเภทเอกสาร" hint="ถ้าเคยออกเอกสารประเภทเดียวกันแล้ว ระบบจะพิมพ์สำเนาเลขที่เดิม">
        <Select value={docType} options={Object.entries(TAX_TITLE).map(([value, l]) => ({ value, label: l }))} onChange={(e) => setDocType(e.target.value)} />
      </Field>
      {full && (
        <div className="grid grid-2">
          <Field label="ชื่อผู้ซื้อ / บริษัท">
            <Input value={buyer.buyerName} onChange={(e) => setBuyer({ ...buyer, buyerName: e.target.value })} />
          </Field>
          <Field label="เลขประจำตัวผู้เสียภาษี">
            <Input value={buyer.buyerTaxId} onChange={(e) => setBuyer({ ...buyer, buyerTaxId: e.target.value.replace(/\D/g, '').slice(0, 13) })} inputMode="numeric" />
          </Field>
          <Field label="สาขา">
            <Input value={buyer.buyerBranch} onChange={(e) => setBuyer({ ...buyer, buyerBranch: e.target.value })} placeholder="สำนักงานใหญ่" />
          </Field>
          <Field label="ที่อยู่" className="">
            <TextArea value={buyer.buyerAddress} onChange={(e) => setBuyer({ ...buyer, buyerAddress: e.target.value })} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------- tax print ----

interface TaxDocument {
  doc_no: string;
  doc_type: string;
  amount: number;
  vat: number;
  buyer_name: string | null;
  buyer_tax_id: string | null;
  buyer_address: string | null;
  buyer_branch: string | null;
  created_at: string;
}
interface Company {
  paperWidth?: '58' | '80';
  companyName?: string;
  companyTaxId?: string;
  companyAddress?: string;
  companyBranch?: string;
  footer?: string;
  vatRate?: number;
}

function taxDoc(d: TaxDocument, c: Company | null, s: { parkingNo: string; plate: string | null; province: string | null; entryAt: string; method: string; reprint: boolean }): PrintDoc {
  const b: PrintBlock[] = [];
  if (c?.companyName) b.push({ type: 'text', text: c.companyName, el: 'receipt/parking/header/title' });
  if (c?.companyTaxId) b.push({ type: 'text', text: `เลขประจำตัวผู้เสียภาษี ${c.companyTaxId}${c.companyBranch ? ` (${c.companyBranch})` : ''}`, align: 'center', size: 13 });
  if (c?.companyAddress) b.push({ type: 'text', text: c.companyAddress, align: 'center', size: 13 });
  b.push({ type: 'text', text: TAX_TITLE[d.doc_type] ?? d.doc_type, align: 'center', weight: 700, size: 18 });
  if (s.reprint) b.push({ type: 'text', text: 'สำเนา', align: 'center', size: 14 });
  b.push({ type: 'line' });
  b.push({ type: 'row', left: 'เลขที่', right: d.doc_no, size: 14 });
  b.push({ type: 'row', left: 'วันที่', right: dateTime(d.created_at), size: 14 });
  if (d.buyer_name) {
    b.push({ type: 'text', text: `ผู้ซื้อ: ${d.buyer_name}`, size: 14 });
    if (d.buyer_tax_id) b.push({ type: 'text', text: `เลขประจำตัวผู้เสียภาษี ${d.buyer_tax_id}${d.buyer_branch ? ` (${d.buyer_branch})` : ''}`, size: 13 });
    if (d.buyer_address) b.push({ type: 'text', text: d.buyer_address, size: 13 });
  }
  b.push({ type: 'line', dashed: true });
  b.push({ type: 'row', left: 'Parking ID', right: s.parkingNo, size: 14 });
  b.push({ type: 'row', left: 'ทะเบียน', right: `${s.plate ?? '-'} ${s.province ?? ''}`.trim(), size: 14 });
  b.push({ type: 'row', left: 'เวลาเข้า', right: dateTime(s.entryAt), size: 14 });
  b.push({ type: 'line', dashed: true });
  b.push({ type: 'row', left: 'ค่าบริการที่จอดรถ', right: money(d.amount - d.vat), size: 15 });
  b.push({ type: 'row', left: `ภาษีมูลค่าเพิ่ม${c?.vatRate ? ` ${c.vatRate}%` : ''}`, right: money(d.vat), size: 15 });
  b.push({ type: 'row', left: 'รวมทั้งสิ้น', right: money(d.amount), el: 'receipt/parking/totals/total' });
  b.push({ type: 'row', left: 'ชำระโดย', right: s.method, size: 14 });
  b.push({ type: 'line' });
  if (c?.footer) b.push({ type: 'text', text: c.footer, align: 'center', size: 14 });
  return { paperWidth: c?.paperWidth ?? '80', blocks: b, cut: true };
}

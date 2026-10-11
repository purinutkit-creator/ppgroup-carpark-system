/** Shift open / cash in-out / close (expected vs counted) for the POS. */
import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, Modal, NumberInput, Select, errorText, useToast } from '../../components/ui';
import { dateTime, money } from '../../lib/format';
import { PAYMENT_LABEL, posGet, posPost } from '../../components/pos/types';

export interface ShiftReport {
  shift: { id: number; opened_at: string; closed_at: string | null; status: string; user_name: string; branch_code: string };
  openingCash: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  cashRefunds: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  sales: { count: number; gross: number; refunds: number; net: number; voids: number };
  methods: Record<string, number>;
  movements: Array<{ id: number; type: string; amount: number; reason: string | null; created_at: string; user_name: string | null }>;
}

export function OpenShift({ name, onOpened }: { name: string; onOpened: () => void }) {
  const [cash, setCash] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="pos-overlay">
      <Card title={<span data-el="merchant-pos/sell/modal/title">เปิดกะการขาย</span>}>
        <div className="col">
          <div className="muted">พนักงาน: {name}</div>
          <Field label="เงินสดตั้งต้นในลิ้นชัก (บาท)">
            <NumberInput className="input-lg num" value={cash} min={0} onChange={setCash} autoFocus />
          </Field>
          {err && <div style={{ color: 'var(--color-danger)' }}>{err}</div>}
          <Button
            variant="primary"
            size="xl"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await posPost('/api/pos/shifts/open', { openingCash: cash ?? 0 });
                onOpened();
              } catch (e) {
                setErr(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            เปิดกะ
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function ReportView({ r }: { r: ShiftReport }) {
  const v = (x: number | null) => (x == null ? '-' : money(x));
  return (
    <div className="col">
      <div className="grid grid-3">
        <div className="card kpi">
          <span className="kpi-label">ยอดขายสุทธิ</span>
          <span className="kpi-value" data-el="merchant-pos/shift/summary/value">
            {money(r.sales.net)}
          </span>
          <span className="small muted">
            {r.sales.count} บิล · Void {r.sales.voids}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">เงินสดที่ควรมี</span>
          <span className="kpi-value" data-el="merchant-pos/shift/summary/value">
            {money(r.expectedCash)}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">นับได้ / ส่วนต่าง</span>
          <span className="kpi-value" data-el="merchant-pos/shift/summary/value" style={{ color: r.difference && Math.abs(r.difference) > 0.009 ? 'var(--color-danger)' : undefined }}>
            {v(r.countedCash)}
          </span>
          <span className="small muted">ส่วนต่าง {v(r.difference)}</span>
        </div>
      </div>
      <div className="kv">
        <span>เปิดกะ</span>
        <span>
          {dateTime(r.shift.opened_at)} · {r.shift.user_name} · {r.shift.branch_code}
        </span>
        {r.shift.closed_at && (
          <>
            <span>ปิดกะ</span>
            <span>{dateTime(r.shift.closed_at)}</span>
          </>
        )}
        <span>เงินตั้งต้น</span>
        <span className="num">{money(r.openingCash)}</span>
        <span>รับเงินสดจากการขาย</span>
        <span className="num">{money(r.cashSales)}</span>
        <span>นำเงินเข้า / นำออก</span>
        <span className="num">
          +{money(r.cashIn)} / −{money(r.cashOut)}
        </span>
        <span>คืนเงินสด</span>
        <span className="num">−{money(r.cashRefunds)}</span>
        <span>แยกตามช่องทาง</span>
        <span>
          {Object.entries(r.methods)
            .map(([k, x]) => `${PAYMENT_LABEL[k] ?? k} ${money(x)}`)
            .join(' · ') || '-'}
        </span>
      </div>
      {r.movements.filter((m) => m.type !== 'SALE').length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>ประเภท</th>
                <th className="right">จำนวน</th>
                <th>เหตุผล</th>
              </tr>
            </thead>
            <tbody>
              {r.movements
                .filter((m) => m.type !== 'SALE')
                .map((m) => (
                  <tr key={m.id}>
                    <td className="small">{dateTime(m.created_at)}</td>
                    <td>{m.type}</td>
                    <td className="right num">{money(m.amount)}</td>
                    <td className="small">{m.reason ?? '-'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ShiftModal({ open, onClose, onClosed }: { open: boolean; onClose: () => void; onClosed: () => void }) {
  const toast = useToast();
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [final, setFinal] = useState<ShiftReport | null>(null);
  const [type, setType] = useState<'IN' | 'OUT'>('OUT');
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const load = () => posGet<{ report: ShiftReport | null }>('/api/pos/shifts/current').then((r) => setReport(r.report)).catch((e) => toast(errorText(e), 'error'));
  useEffect(() => {
    if (open) {
      setFinal(null);
      setCounted(null);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <Modal open size="xl" title={<span data-el="merchant-pos/sell/modal/title">{final ? 'สรุปปิดกะ' : 'กะการขาย'}</span>} onClose={final ? onClosed : onClose}>
      {final ? (
        <div className="col">
          <ReportView r={final} />
          <Button variant="primary" size="lg" onClick={onClosed}>
            เสร็จสิ้น
          </Button>
        </div>
      ) : !report ? (
        <div className="muted">กำลังโหลด…</div>
      ) : (
        <div className="col" style={{ gap: 16 }}>
          <ReportView r={report} />
          <Card title="นำเงินเข้า / นำเงินออก">
            <div className="row">
              <Select value={type} onChange={(e) => setType(e.target.value as 'IN' | 'OUT')} options={[{ value: 'OUT', label: 'นำเงินออก' }, { value: 'IN', label: 'นำเงินเข้า' }]} />
              <NumberInput value={amount} min={0} placeholder="จำนวนเงิน" onChange={setAmount} style={{ width: 140 }} />
              <Input value={reason} placeholder="เหตุผล" onChange={(e) => setReason(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
              <Button
                disabled={!amount || !reason.trim()}
                onClick={async () => {
                  try {
                    const r = await posPost<{ report: ShiftReport }>('/api/pos/shifts/cash', { type, amount, reason });
                    setReport(r.report);
                    setAmount(null);
                    setReason('');
                    toast('บันทึกแล้ว', 'success');
                  } catch (e) {
                    toast(errorText(e), 'error');
                  }
                }}
              >
                บันทึก
              </Button>
            </div>
          </Card>
          <Card title="ปิดกะ">
            <div className="row">
              <Field label="เงินสดที่นับได้จริง (บาท)">
                <NumberInput className="input-lg num" value={counted} min={0} onChange={setCounted} style={{ width: 200 }} />
              </Field>
              <Field label="หมายเหตุ">
                <Input value={note} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 220 }} />
              </Field>
              {counted != null && (
                <span className="small">
                  ส่วนต่างโดยประมาณ <strong>{money(counted - report.expectedCash)}</strong>
                </span>
              )}
              <span className="spacer" />
              <Button
                variant="danger"
                size="lg"
                disabled={counted == null}
                onClick={async () => {
                  try {
                    const r = await posPost<{ report: ShiftReport }>('/api/pos/shifts/close', { countedCash: counted, note });
                    setFinal(r.report);
                  } catch (e) {
                    toast(errorText(e), 'error');
                  }
                }}
              >
                ปิดกะ
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Modal>
  );
}

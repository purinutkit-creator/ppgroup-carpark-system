/** Counter side tools: cash payment, lost-ticket reissue, stamp calculator. */
import { useState } from 'react';
import { newIdempotencyKey, post } from '../../../lib/api';
import { money } from '../../../lib/format';
import { Button, Card, Check, Field, Input, Modal, NumberInput, errorText, useToast } from '../../ui';
import { useDesign } from '../../../design/DesignProvider';
import { printDoc } from '../../../print/print';
import { ticketDoc, type TicketData } from '../../../print/templates';
import { printParkingReceipt } from '../receiptPrint';
import { rewardText } from '../receiptReasons';
import type { Payment, Quote } from '../types';
import type { RewardResult } from '@pp/shared/validation';

export function CashDialog({ open, quote, onClose, onDone }: { open: boolean; quote: Quote; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const design = useDesign();
  const [received, setReceived] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Payment | null>(null);
  const [key] = useState(newIdempotencyKey);
  const change = received != null ? Math.round((received - quote.due) * 100) / 100 : null;

  const submit = async () => {
    if (received == null || received < quote.due) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ payment: Payment; quote: Quote }>(`/api/sessions/${quote.sessionId}/pay-cash`, { received, idempotencyKey: key });
      setResult(r.payment);
      toast('รับชำระเงินสดแล้ว', 'success');
      onDone();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="รับชำระเงินสด"
      onClose={onClose}
      footer={
        result ? (
          <>
            <Button onClick={() => printParkingReceipt(quote.sessionId, design?.config ?? null, null).catch((e) => toast(errorText(e), 'error'))}>🖨 พิมพ์ใบเสร็จ</Button>
            <Button variant="primary" onClick={onClose}>
              ปิด
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>ยกเลิก</Button>
            <Button variant="primary" loading={busy} disabled={received == null || received < quote.due} onClick={submit}>
              ยืนยันรับเงิน (Enter)
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="col center">
          <div className="big-icon ok">✓</div>
          <div>ยอดชำระ {money(result.amount)}</div>
          <div className="ctr-fee" style={{ fontSize: 32, fontWeight: 700 }}>
            เงินทอน {money(result.changeGiven)}
          </div>
        </div>
      ) : (
        <form
          className="col"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="kv">
            <span>ยอดที่ต้องชำระ</span>
            <b className="num">{money(quote.due)}</b>
          </div>
          <Field label="รับเงินมา (บาท)">
            <NumberInput value={received} onChange={setReceived} min={0} step="any" autoFocus className="input-lg" />
          </Field>
          <div className="row">
            {[quote.due, 100, 500, 1000].filter((v, i, a) => v >= quote.due && a.indexOf(v) === i).map((v) => (
              <Button key={v} size="sm" onClick={() => setReceived(v)}>
                {money(v)}
              </Button>
            ))}
          </div>
          {change != null && (
            <div className={change < 0 ? 'notice notice-danger' : 'notice notice-ok'}>{change < 0 ? `ขาดอีก ${money(-change)}` : `เงินทอน ${money(change)}`}</div>
          )}
          {err && <div className="notice notice-danger">{err}</div>}
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}

export function LostTicketDialog({ open, quote, onClose, onDone }: { open: boolean; quote: Quote; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const design = useDesign();
  const [reason, setReason] = useState('');
  const [charge, setCharge] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ ticket: TicketData; quote: Quote }>(`/api/sessions/${quote.sessionId}/lost-ticket`, { reason, chargeFee: charge });
      await printDoc(ticketDoc(r.ticket), design?.config ?? null, null, { job: 'ticket-reissue', ref: quote.parkingNo });
      toast('ออกบัตรใหม่แล้ว บัตรเดิมใช้ไม่ได้', 'success');
      onDone();
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="บัตรหาย — ออกบัตรใหม่"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={submit}>
            ออกบัตรใหม่และพิมพ์
          </Button>
        </>
      }
    >
      <div className="col">
        <div className="muted small">QR บนบัตรเดิมจะถูกยกเลิกทันที (บันทึกใน Audit Log)</div>
        <Field label="เหตุผล *">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="เช่น ลูกค้าทำบัตรหาย" />
        </Field>
        <Check label="คิดค่าปรับบัตรหายตามอัตราที่ตั้งไว้" checked={charge} onChange={setCharge} />
        {err && <div className="notice notice-danger">{err}</div>}
      </div>
    </Modal>
  );
}

export function StampCalculator() {
  const [amount, setAmount] = useState<number | null>(null);
  const [result, setResult] = useState<RewardResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const calc = async () => {
    if (amount == null) return;
    setBusy(true);
    setErr(null);
    try {
      setResult(await post<RewardResult>('/api/validation/calculator', { amount }));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={<span data-el="info-counter/main/section/title">เครื่องคำนวณแสตมป์</span>}>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          calc();
        }}
      >
        <NumberInput value={amount} onChange={setAmount} placeholder="ยอดซื้อ (บาท)" min={0} step="any" style={{ maxWidth: 200 }} />
        <Button type="submit" loading={busy}>
          คำนวณ
        </Button>
      </form>
      {err && <div className="notice notice-danger mt">{err}</div>}
      {result && (
        <div className="mt">
          {result.applied.length ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {result.applied.map((a) => (
                <li key={a.ruleId}>
                  <b>{a.ruleName}</b>: {rewardText(a.reward)}
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted small">ยอดนี้ยังไม่ได้รับสิทธิ์ส่วนลดค่าจอด</div>
          )}
        </div>
      )}
    </Card>
  );
}

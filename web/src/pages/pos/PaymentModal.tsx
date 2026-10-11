/**
 * Split payments: cash (change calculator + quick notes), PromptPay QR from
 * the merchant's PromptPay ID, card / transfer / e-wallet with reference.
 * The server re-prices the cart and rejects underpayment.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Input, Modal, errorText } from '../../components/ui';
import { money } from '../../lib/format';
import { newIdempotencyKey } from '../../lib/api';
import { PAYMENT_LABEL, posPost, r2, type Payment, type ReceiptData, type Sale } from '../../components/pos/types';

type Method = 'CASH' | 'PROMPTPAY' | 'CARD' | 'TRANSFER' | 'EWALLET';
const METHODS: Method[] = ['CASH', 'PROMPTPAY', 'CARD', 'TRANSFER', 'EWALLET'];
const NOTES = [20, 50, 100, 500, 1000];

export interface SaleResult {
  sale: Sale;
  receipt: ReceiptData;
  change: number;
}

export default function PaymentModal({
  open,
  due,
  payload,
  onClose,
  onDone,
  onDisplay,
}: {
  open: boolean;
  due: number;
  payload: () => { items: unknown[]; billDiscount?: unknown; memberPhone?: string };
  onClose: () => void;
  onDone: (r: SaleResult) => void;
  onDisplay?: (state: { stage: 'PAYING'; due: number; paid: number; promptPay?: string | null }) => void;
}) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [method, setMethod] = useState<Method>('CASH');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [qr, setQr] = useState<{ payload: string; dataUrl: string; amount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [idem, setIdem] = useState(newIdempotencyKey);

  useEffect(() => {
    if (!open) return;
    setPayments([]);
    setMethod('CASH');
    setAmount('');
    setRef('');
    setQr(null);
    setErr(null);
    setIdem(newIdempotencyKey());
  }, [open]);

  const paid = r2(payments.reduce((s, p) => s + p.amount, 0));
  const remaining = Math.max(0, r2(due - paid));
  const cashPaid = r2(payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amount, 0));
  const change = Math.max(0, r2(paid - due));
  const nonCashOver = r2(paid - cashPaid) > due + 0.001;
  const quick = useMemo(() => {
    const set = new Set<number>([remaining]);
    for (const n of NOTES) if (n >= remaining) set.add(n);
    set.add(Math.ceil(remaining / 100) * 100);
    set.add(Math.ceil(remaining / 1000) * 1000);
    return [...set].filter((x) => x > 0).sort((a, b) => a - b).slice(0, 6);
  }, [remaining]);

  useEffect(() => {
    if (open) onDisplay?.({ stage: 'PAYING', due, paid, promptPay: qr?.payload ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, due, paid, qr?.payload]);

  const add = (m: Method, value: number, reference?: string) => {
    const v = r2(value);
    if (!(v > 0)) return;
    if (m !== 'CASH' && v > remaining + 0.001) {
      setErr('ชำระด้วยช่องทางอื่นนอกจากเงินสดต้องไม่เกินยอดคงเหลือ');
      return;
    }
    setErr(null);
    setPayments((p) => [...p, { method: m, amount: v, ref: reference || null }]);
    setAmount('');
    setRef('');
    setQr(null);
  };

  const loadQr = async () => {
    setErr(null);
    try {
      const v = r2(Number(amount) || remaining);
      setQr(await posPost('/api/pos/promptpay-qr', { amount: v }));
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const key = (k: string) => {
    if (k === 'C') return setAmount('');
    if (k === '⌫') return setAmount((a) => a.slice(0, -1));
    setAmount((a) => (k === '.' && a.includes('.') ? a : (a + k).replace(/^0(\d)/, '$1')));
  };

  const complete = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await posPost<SaleResult>('/api/pos/sales', { ...payload(), payments, idempotencyKey: idem });
      onDone(r);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const ready = paid + 0.001 >= due && !nonCashOver && due > 0;
  return (
    <Modal
      open
      size="xl"
      title={<span data-el="merchant-pos/sell/payment/title">ชำระเงิน</span>}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button variant="success" size="xl" disabled={!ready} loading={busy} onClick={complete} data-el="merchant-pos/sell/actions/button">
            ✓ ยืนยันการชำระ {change > 0 ? `· ทอน ${money(change)}` : ''}
          </Button>
        </>
      }
    >
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="col">
          <div className="pos-due">
            <div className="small muted">ยอดที่ต้องชำระ</div>
            <div data-el="merchant-pos/sell/payment/amount" className="num">
              {money(due)}
            </div>
          </div>
          <div className="pos-split">
            {payments.map((p, i) => (
              <div key={i} className="r">
                <span>
                  {PAYMENT_LABEL[p.method]} {p.ref ? <span className="small muted">({p.ref})</span> : null}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <strong className="num">{money(p.amount)}</strong>
                  <Button size="sm" variant="ghost" onClick={() => setPayments((x) => x.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                </span>
              </div>
            ))}
            <div className="r">
              <span>ชำระแล้ว</span>
              <strong className="num">{money(paid)}</strong>
            </div>
            <div className="r">
              <span>คงเหลือ</span>
              <strong className="num" style={{ color: remaining > 0 ? 'var(--color-danger)' : undefined }}>
                {money(remaining)}
              </strong>
            </div>
          </div>
          {change > 0 && (
            <div className="center" data-el="merchant-pos/sell/payment/change" style={{ color: 'var(--color-success)' }}>
              เงินทอน {money(change)}
            </div>
          )}
          {err && <div style={{ color: 'var(--color-danger)' }}>{err}</div>}
        </div>

        <div className="col">
          <div className="pos-methods">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                className={method === m ? 'active' : ''}
                onClick={() => {
                  setMethod(m);
                  setQr(null);
                  setErr(null);
                }}
              >
                {PAYMENT_LABEL[m]}
              </button>
            ))}
          </div>
          <Field label={method === 'CASH' ? 'รับเงินมา (บาท)' : 'จำนวนเงิน (บาท) — ว่างไว้ = ยอดคงเหลือ'}>
            <Input className="input-lg num" inputMode="decimal" value={amount} placeholder={money(remaining, '')} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
          </Field>
          {method === 'CASH' && (
            <>
              <div className="pos-notes">
                {quick.map((n) => (
                  <Button key={n} onClick={() => add('CASH', n)}>
                    {n === remaining ? `พอดี ${money(n, '')}` : money(n, '')}
                  </Button>
                ))}
              </div>
              <div className="pos-keypad">
                {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'].map((k) => (
                  <Button key={k} onClick={() => key(k)}>
                    {k}
                  </Button>
                ))}
              </div>
              <Button variant="primary" size="lg" disabled={!(Number(amount) > 0)} onClick={() => add('CASH', Number(amount))}>
                รับเงินสด {amount ? money(Number(amount)) : ''}
              </Button>
            </>
          )}
          {method === 'PROMPTPAY' && (
            <div className="col">
              {!qr ? (
                <Button variant="primary" size="lg" disabled={remaining <= 0} onClick={loadQr}>
                  สร้าง QR PromptPay {money(Number(amount) || remaining)}
                </Button>
              ) : (
                <div className="pos-qr">
                  <img src={qr.dataUrl} alt="PromptPay QR" />
                  <strong className="num">{money(qr.amount)}</strong>
                  <span className="small muted">ให้ลูกค้าสแกนชำระ แล้วตรวจสอบยอดเงินเข้าในแอปธนาคารก่อนกดยืนยัน</span>
                  <Field label="เลขอ้างอิงการโอน (ถ้ามี)">
                    <Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} />
                  </Field>
                  <Button variant="success" size="lg" onClick={() => add('PROMPTPAY', qr.amount, ref)}>
                    ✓ ได้รับเงิน PromptPay แล้ว
                  </Button>
                </div>
              )}
            </div>
          )}
          {(method === 'CARD' || method === 'TRANSFER' || method === 'EWALLET') && (
            <div className="col">
              <Field label={method === 'CARD' ? 'Approval Code / เลขอ้างอิง EDC' : 'เลขอ้างอิงรายการ'}>
                <Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} />
              </Field>
              <Button variant="primary" size="lg" disabled={remaining <= 0} onClick={() => add(method, Number(amount) || remaining, ref)}>
                บันทึก {PAYMENT_LABEL[method]} {money(Number(amount) || remaining)}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Customer web payment: choose a method → server creates the charge for the
 * current amount due (the client never sends an amount) → QR / card link →
 * wait for `payment:update` PAID (socket, with polling fallback).
 */
import { useEffect, useRef, useState } from 'react';
import { get, newIdempotencyKey, post } from '../../lib/api';
import { money } from '../../lib/format';
import { errorText } from '../ui';
import { Countdown } from '../kiosk/KioskUi';
import { MockPayButton } from '../kiosk/PayPanel';
import { useNow } from '../kiosk/hooks';
import { useKT } from '../kiosk/kioskI18n';
import type { Payment, PaymentMethods, Quote } from '../kiosk/types';

type Method = 'PROMPTPAY' | 'CARD' | 'EWALLET';

export function PayFlow({
  token,
  quote,
  methods,
  pushed,
  onPaid,
  onCancel,
}: {
  token: string;
  quote: Quote;
  methods: PaymentMethods;
  /** latest payment pushed over the socket */
  pushed: Payment | null;
  onPaid: (p: Payment) => void;
  onCancel: () => void;
}) {
  const { t } = useKT();
  const options: Array<{ id: Method; icon: string; label: string }> = [];
  if (methods.promptpay) options.push({ id: 'PROMPTPAY', icon: '▣', label: t('promptpay') });
  if (methods.card) options.push({ id: 'CARD', icon: '💳', label: t('card') });
  if (methods.ewallet) options.push({ id: 'EWALLET', icon: '📱', label: 'e-Wallet' });
  const [method, setMethod] = useState<Method | null>(options.length === 1 ? options[0].id : null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);
  const paidRef = useRef(false);

  const create = async (m: Method) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ payment: Payment; qrDataUrl: string | null }>(`/api/public/sessions/${token}/payments`, { method: m, idempotencyKey: newIdempotencyKey() });
      setPayment(r.payment);
      setQr(r.qrDataUrl);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (method && !payment) create(method);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);

  const settle = (p: Payment) => {
    setPayment(p);
    if (p.status === 'PAID' && !paidRef.current) {
      paidRef.current = true;
      onPaid(p);
    }
  };

  useEffect(() => {
    if (pushed && payment && pushed.id === payment.id) settle(pushed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushed]);

  // polling fallback in case the socket is blocked on the customer's network
  useEffect(() => {
    if (!payment || payment.status !== 'PENDING') return;
    const id = payment.id;
    const tm = setInterval(async () => {
      try {
        const r = await get<{ payment: Payment }>(`/api/public/sessions/${token}/payments/${id}`);
        if (r.payment.status !== 'PENDING') settle(r.payment);
      } catch {
        /* keep waiting */
      }
    }, 4000);
    return () => clearInterval(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?.id, payment?.status, token]);

  const expired = !!payment?.expiresAt && new Date(payment.expiresAt).getTime() <= now && payment.status === 'PENDING';

  return (
    <div className="cw-card">
      {!method && (
        <>
          <div className="cw-hist-title">{t('choosePayment')}</div>
          <div className="center">
            <div className="muted">{t('amountDue')}</div>
            <div className="cw-total-value" data-el="customer-web/payment/qr/amount">
              {money(quote.due)}
            </div>
          </div>
          <div className="cw-methods">
            {options.map((o) => (
              <button key={o.id} type="button" className="cw-method" onClick={() => setMethod(o.id)}>
                <span className="ico">{o.icon}</span>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
      {method && (
        <div className="cw-qr">
          {busy && <div className="muted">…</div>}
          {payment && (
            <>
              <div className="muted">{t('amountDue')}</div>
              <div data-el="customer-web/payment/qr/amount">{money(payment.amount)}</div>
              {payment.status === 'FAILED' || payment.status === 'CANCELLED' ? (
                <div className="notice notice-danger">{t('paymentFailed')}</div>
              ) : expired ? (
                <div className="notice notice-danger">{t('qrExpired')}</div>
              ) : payment.method === 'CARD' ? (
                payment.qrImageUrl ? (
                  <a className="cw-paybtn btn" href={payment.qrImageUrl} data-el="customer-web/session/actions/pay">
                    💳 {t('goToCard')}
                  </a>
                ) : (
                  <div className="muted">{t('waitingPayment')}</div>
                )
              ) : (
                <>
                  <div data-el="customer-web/payment/status/message">{t('scanToPay')}</div>
                  {(qr || payment.qrImageUrl) && <img src={qr ?? payment.qrImageUrl!} alt="PromptPay QR" />}
                  <div className="muted small">{t('saveQrHint')}</div>
                </>
              )}
              {payment.status === 'PENDING' && payment.expiresAt && !expired && (
                <div className="muted">
                  {t('qrExpiresIn')} <Countdown iso={payment.expiresAt} now={now} />
                </div>
              )}
              {payment.status === 'PENDING' && !expired && <div className="muted">{t('waitingPayment')}</div>}
              {(expired || payment.status === 'FAILED' || payment.status === 'CANCELLED') && (
                <button
                  type="button"
                  className="cw-paybtn"
                  data-el="customer-web/session/actions/pay"
                  onClick={() => {
                    setPayment(null);
                    create(method);
                  }}
                >
                  {t('newQr')}
                </button>
              )}
              {payment.status === 'PENDING' && <MockPayButton paymentId={payment.id} className="cw-mock" />}
            </>
          )}
        </div>
      )}
      {err && <div className="notice notice-danger">{err}</div>}
      <button type="button" className="btn btn-block" onClick={onCancel}>
        {t('back')}
      </button>
    </div>
  );
}

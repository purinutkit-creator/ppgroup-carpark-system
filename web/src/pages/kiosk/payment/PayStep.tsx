/**
 * Payment step: PromptPay QR / card at the EDC / cash acceptor.
 * The cash acceptor driver (local bridge on the kiosk PC) reports inserted
 * money either as a window event `pp:cash` ({ detail: { amount } }) or as a
 * `cash:inserted` socket event to this device; once the inserted total covers
 * the amount due the kiosk posts it to /api/kiosk/sessions/:id/cash.
 */
import { useEffect, useRef, useState } from 'react';
import { newIdempotencyKey, post } from '../../../lib/api';
import { money } from '../../../lib/format';
import { errorText } from '../../../components/ui';
import { PayPanel } from '../../../components/kiosk/PayPanel';
import { usePublicConfig } from '../../../components/kiosk/hooks';
import { useKioskPayment, type PayMethod } from '../../../components/kiosk/usePaymentWatch';
import { useKT } from '../../../components/kiosk/kioskI18n';
import type { Payment, PaymentMethods, Quote } from '../../../components/kiosk/types';

type Method = PayMethod | 'CASH';

export function PayStep({
  quote,
  methods,
  cashAcceptor,
  cashEvents,
  onPaid,
  onBack,
}: {
  quote: Quote;
  methods: PaymentMethods;
  cashAcceptor: boolean;
  /** inserted-cash notifications from the device socket */
  cashEvents: number[];
  onPaid: (p: Payment, q: Quote | null) => void;
  onBack: () => void;
}) {
  const { t } = useKT();
  const [method, setMethod] = useState<Method | null>(null);
  const pay = useKioskPayment(onPaid);
  const options: Array<{ id: Method; icon: string; label: string }> = [];
  if (methods.promptpay) options.push({ id: 'PROMPTPAY', icon: '▣', label: t('promptpay') });
  if (methods.card) options.push({ id: 'CARD', icon: '💳', label: t('card') });
  if (methods.ewallet) options.push({ id: 'EWALLET', icon: '📱', label: 'e-Wallet' });
  if (methods.cash && cashAcceptor) options.push({ id: 'CASH', icon: '💵', label: t('cash') });

  const choose = (m: Method) => {
    setMethod(m);
    if (m !== 'CASH') pay.start(quote.sessionId, m);
  };

  return (
    <div className="pk-steps">
      <div className="kiosk-card center">
        <div className="amount-box">
          <div className="amount-label">{t('total')}</div>
          <div className="amount-value" data-el="payment-kiosk/summary/amount/total">
            {money(quote.due)}
          </div>
        </div>
        {!method && (
          <>
            <div data-el="payment-kiosk/search/form/label">{t('choosePayment')}</div>
            <div className="pay-methods">
              {options.map((o) => (
                <button key={o.id} type="button" className="kbtn kbtn-secondary" data-el="payment-kiosk/summary/actions/pay" onClick={() => choose(o.id)}>
                  <span className="ico">{o.icon}</span>
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
        {method && method !== 'CASH' && (
          <>
            {pay.payment ? <PayPanel system="payment-kiosk" payment={pay.payment} qr={pay.qr} onRenew={() => pay.start(quote.sessionId, method)} /> : <div className="muted">{t('checking')}</div>}
            {pay.payment?.status === 'FAILED' && (
              <div className="notice notice-danger">
                {t('paymentFailed')}
                <button type="button" className="btn btn-sm" onClick={() => pay.start(quote.sessionId, method)}>
                  {t('tryAgain')}
                </button>
              </div>
            )}
          </>
        )}
        {method === 'CASH' && <CashPanel quote={quote} events={cashEvents} onPaid={onPaid} />}
        {pay.error && <div className="notice notice-danger">{pay.error}</div>}
      </div>
      <div className="pk-nav">
        <button
          type="button"
          className="kbtn kbtn-secondary"
          onClick={() => {
            if (method) {
              setMethod(null);
              pay.clear();
            } else onBack();
          }}
        >
          ← {t('back')}
        </button>
      </div>
    </div>
  );
}

function CashPanel({ quote, events, onPaid }: { quote: Quote; events: number[]; onPaid: (p: Payment, q: Quote | null) => void }) {
  const { t } = useKT();
  const cfg = usePublicConfig();
  const [inserted, setInserted] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  const seen = useRef(events.length);

  useEffect(() => {
    const on = (e: Event) => {
      const amt = Number((e as CustomEvent<{ amount: number }>).detail?.amount);
      if (amt > 0) setInserted((x) => x + amt);
    };
    window.addEventListener('pp:cash', on);
    return () => window.removeEventListener('pp:cash', on);
  }, []);
  useEffect(() => {
    const fresh = events.slice(seen.current);
    seen.current = events.length;
    const sum = fresh.reduce((a, b) => a + b, 0);
    if (sum > 0) setInserted((x) => x + sum);
  }, [events]);

  useEffect(() => {
    if (inserted < quote.due || busy || quote.due <= 0) return;
    setBusy(true);
    post<{ payment: Payment; quote: Quote }>(`/api/kiosk/sessions/${quote.sessionId}/cash`, { received: inserted, idempotencyKey: key.current }, { device: true })
      .then((r) => onPaid(r.payment, r.quote))
      .catch((e) => {
        setErr(errorText(e));
        setBusy(false);
      });
  }, [inserted, quote, busy, onPaid]);

  return (
    <div className="qr-panel">
      <div className="big-icon">💵</div>
      <div data-el="payment-kiosk/payment/status/message">{t('insertCash')}</div>
      <div className="info-panel" style={{ maxWidth: 520 }}>
        <div className="info-row">
          <span className="info-label">{t('cashInserted')}</span>
          <span className="info-value num">{money(inserted)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">{t('total')}</span>
          <span className="info-value num">{money(Math.max(0, quote.due - inserted))}</span>
        </div>
      </div>
      {busy && <div className="muted">{t('checking')}</div>}
      {err && <div className="notice notice-danger">{err}</div>}
      {cfg?.provider === 'mock' && (
        <div className="cash-denoms">
          {[20, 50, 100, 500, 1000].map((d) => (
            <button key={d} type="button" className="btn btn-sm" onClick={() => setInserted((x) => x + d)}>
              🧪 +{d}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

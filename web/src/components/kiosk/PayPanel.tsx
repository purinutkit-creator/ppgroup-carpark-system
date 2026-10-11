/** Pending payment display for kiosks: QR (PromptPay) or EDC card prompt, amount, expiry. */
import { useState } from 'react';
import { post } from '../../lib/api';
import { money } from '../../lib/format';
import { Countdown } from './KioskUi';
import { useNow, usePublicConfig } from './hooks';
import { useKT } from './kioskI18n';
import type { Payment } from './types';

/** Test helper shown only when the server runs the mock payment provider. */
export function MockPayButton({ paymentId, className }: { paymentId: number; className?: string }) {
  const cfg = usePublicConfig();
  const { t } = useKT();
  const [busy, setBusy] = useState(false);
  if (cfg?.provider !== 'mock') return null;
  return (
    <button
      type="button"
      className={`btn btn-sm ${className ?? ''}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await post(`/api/payments/mock/${paymentId}/complete`, {});
        } finally {
          setBusy(false);
        }
      }}
    >
      🧪 {t('mockPay')}
    </button>
  );
}

export function PayPanel({
  system,
  payment,
  qr,
  onExpired,
  onRenew,
}: {
  system: 'exit-kiosk' | 'payment-kiosk';
  payment: Payment;
  qr: string | null;
  onExpired?: () => void;
  onRenew?: () => void;
}) {
  const { t } = useKT();
  const now = useNow(1000);
  const expired = !!payment.expiresAt && new Date(payment.expiresAt).getTime() <= now;
  const amountEl = system === 'payment-kiosk' ? 'payment-kiosk/payment/qr/amount' : 'exit-kiosk/main/amount/total';
  const msgEl = system === 'payment-kiosk' ? 'payment-kiosk/payment/status/message' : 'exit-kiosk/main/status/message';
  return (
    <div className="qr-panel">
      <div data-el={amountEl} className="amount-value">
        {money(payment.amount)}
      </div>
      {payment.method === 'CARD' ? (
        <>
          <div className="big-icon">💳</div>
          <div data-el={msgEl}>{t('payCard')}</div>
        </>
      ) : expired ? (
        <>
          <div className="notice notice-danger">{t('qrExpired')}</div>
          {onRenew && (
            <button type="button" className="kbtn" onClick={onRenew}>
              {t('newQr')}
            </button>
          )}
        </>
      ) : (
        <>
          <div data-el={msgEl}>{t('scanToPay')}</div>
          {qr ? <img src={qr} alt="PromptPay QR" className="qr-img" /> : payment.qrImageUrl ? <img src={payment.qrImageUrl} alt="QR" className="qr-img" /> : null}
        </>
      )}
      {payment.expiresAt && !expired && (
        <div className="muted">
          {t('qrExpiresIn')} <Countdown iso={payment.expiresAt} now={now} onExpire={onExpired} />
        </div>
      )}
      <div className="muted">{t('waitingPayment')}</div>
      <MockPayButton paymentId={payment.id} />
    </div>
  );
}

/**
 * Self-service receipt validation at the payment kiosk:
 * scan → POST /api/validation/preview → (ok) POST /api/validation/apply.
 */
import { useCallback, useState } from 'react';
import { post } from '../../../lib/api';
import { money } from '../../../lib/format';
import { errorText } from '../../../components/ui';
import { useScanner } from '../../../components/kiosk/useScanner';
import { CameraScanner, cameraScanSupported } from '../../../components/kiosk/CameraScanner';
import { InfoRow } from '../../../components/kiosk/KioskUi';
import { useKT } from '../../../components/kiosk/kioskI18n';
import { RECEIPT_REASON, blockingText, rewardText } from '../../../components/kiosk/receiptReasons';
import type { Quote, ValidationPreview, VerifiedReceipt } from '../../../components/kiosk/types';

interface Success {
  spend: number;
  discount: number;
  before: number;
  after: number;
  rules: string[];
  receipts: string[];
}

export function ReceiptScan({ sessionId, allowMultiple, onDone, onApplied }: { sessionId: number; allowMultiple: boolean; onDone: () => void; onApplied: (q: Quote) => void }) {
  const { t, lang } = useKT();
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [rejected, setRejected] = useState<VerifiedReceipt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);

  const onScan = useCallback(
    async (code: string) => {
      if (busy) return;
      setBusy(true);
      setRejected(null);
      setMessage(null);
      try {
        const pv = await post<ValidationPreview>('/api/validation/preview', { sessionId, codes: [code] }, { device: true });
        const rc = pv.receipts[0];
        if (rc && !rc.ok) {
          setRejected(rc);
          return;
        }
        if (pv.blocking.length) {
          setMessage(pv.blocking.map(blockingText).join(' · '));
          return;
        }
        if (!pv.after || !pv.reward.applied.length) {
          setMessage(`${t('receiptRejected')} — ${RECEIPT_REASON.BELOW_MIN_SPEND[lang === 'th' ? 'th' : 'en']}`);
          return;
        }
        const r = await post<{ ok: boolean; quote: Quote }>('/api/validation/apply', { sessionId, codes: [code] }, { device: true });
        setSuccess({
          spend: pv.eligibleSpend,
          discount: pv.after.discount,
          before: pv.session.due,
          after: r.quote.due,
          rules: pv.reward.applied.map((a) => `${a.ruleName} (${rewardText(a.reward)})`),
          receipts: pv.receipts.map((x) => x.receipt?.receiptNo ?? ''),
        });
        setCamera(false);
        onApplied(r.quote);
      } catch (e) {
        setMessage(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, sessionId, onApplied, t, lang],
  );

  useScanner(onScan, { enabled: !success });

  if (success) {
    return (
      <div className="pk-steps">
        <div className="kiosk-card center">
          <div className="big-icon ok">✓</div>
          <div data-el="payment-kiosk/validation/result/title" className="k-msg-ok">
            {t('validationSuccess')}
          </div>
          <div className="info-panel">
            <InfoRow label={t('purchase')} value={money(success.spend)} labelEl="payment-kiosk/summary/lines/label" valueEl="payment-kiosk/summary/lines/value" />
            <InfoRow label={t('parkingDiscount')} value={`− ${money(success.discount)}`} labelEl="payment-kiosk/summary/lines/label" valueEl="payment-kiosk/summary/lines/value" />
            <InfoRow label={t('oldFee')} value={money(success.before)} labelEl="payment-kiosk/summary/lines/label" valueEl="payment-kiosk/summary/lines/value" />
          </div>
          <div className="amount-box">
            <div className="amount-label">{t('newFee')}</div>
            <div className="amount-value" data-el="payment-kiosk/summary/amount/total">
              {money(success.after)}
            </div>
          </div>
          <div className="muted">{success.rules.join(' · ')}</div>
        </div>
        <div className="pk-nav">
          {allowMultiple && success.after > 0 && (
            <button type="button" className="kbtn kbtn-secondary" onClick={() => setSuccess(null)}>
              🧾 {t('scanMore')}
            </button>
          )}
          <button type="button" className="kbtn" onClick={onDone}>
            {t('next')} →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pk-steps">
      <div className="kiosk-card center">
        <div data-el="payment-kiosk/search/form/label">{t('scanReceipt')}</div>
        <div className="scan-illustration">🧾</div>
        <div className="k-hint" data-el="payment-kiosk/search/form/hint">
          {t('scanReceiptHint')}
        </div>
        {camera && <CameraScanner onDetect={onScan} />}
        {cameraScanSupported() && (
          <button type="button" className="kbtn kbtn-secondary" onClick={() => setCamera(!camera)}>
            📷 {camera ? t('stopCamera') : t('useCamera')}
          </button>
        )}
        {busy && <div className="muted">{t('checking')}</div>}
        {rejected && (
          <div className="receipt-result bad" style={{ width: '100%' }}>
            <div className="rr-verdict">✕ {RECEIPT_REASON[rejected.code]?.en ?? rejected.code}</div>
            <div>{RECEIPT_REASON[rejected.code]?.[lang === 'th' ? 'th' : 'en'] ?? ''}</div>
            {rejected.receipt && (
              <div className="muted">
                {rejected.receipt.merchantName} · {rejected.receipt.receiptNo}
              </div>
            )}
          </div>
        )}
        {message && <div className="notice notice-danger">{message}</div>}
      </div>
      <div className="pk-nav">
        <button type="button" className="kbtn kbtn-secondary" onClick={onDone}>
          ← {t('back')}
        </button>
      </div>
    </div>
  );
}

/** Fee summary for the selected vehicle; live clock, quote refreshed at quote.nextChangeAt. */
import { dateTime, durationText, money, time } from '../../../lib/format';
import { InfoRow, PlateBox } from '../../../components/kiosk/KioskUi';
import { useServerClock } from '../../../components/kiosk/hooks';
import { useKT } from '../../../components/kiosk/kioskI18n';
import type { Quote } from '../../../components/kiosk/types';

const L = 'payment-kiosk/summary/lines/label';
const V = 'payment-kiosk/summary/lines/value';
const RECEIPT_TYPES = ['RECEIPT_VALIDATION', 'MANUAL_STAMP'];

/** Split the server's discount total into receipt/stamp discounts vs promotions & member benefits. */
export function discountBreakdown(q: Quote) {
  const active = q.discounts.filter((d) => d.status === 'ACTIVE');
  const onlyReceipts = active.every((d) => RECEIPT_TYPES.includes(d.type));
  const promotion = q.memberDiscount;
  const receipt = Math.max(0, Math.round((q.discountTotal - promotion) * 100) / 100);
  return { receipt, promotion, onlyReceipts };
}

export function Summary({
  quote,
  canValidate,
  onValidate,
  onPay,
  onBack,
}: {
  quote: Quote;
  canValidate: boolean;
  onValidate: () => void;
  onPay: () => void;
  onBack: () => void;
}) {
  const { t, lang } = useKT();
  const now = useServerClock(quote.now);
  const end = quote.exitAt ? new Date(quote.exitAt).getTime() : now;
  const seconds = Math.max(0, (end - new Date(quote.entryAt).getTime()) / 1000);
  const d = discountBreakdown(quote);

  return (
    <div className="pk-steps">
      <div className="kiosk-card">
        <div className="row" style={{ justifyContent: 'center' }}>
          <PlateBox plate={quote.plate.text} province={quote.plate.province} plateEl="payment-kiosk/summary/vehicle/plate" provinceEl="payment-kiosk/summary/vehicle/province" />
        </div>
        <div className="info-panel">
          <InfoRow label={t('plate')} value={quote.plate.text ?? '-'} labelEl={L} valueEl={V} />
          <InfoRow label={t('province')} value={quote.plate.province ?? '-'} labelEl={L} valueEl={V} />
          <InfoRow label={t('entryTime')} value={dateTime(quote.entryAt)} labelEl={L} valueEl={V} />
          <InfoRow label={t('currentTime')} value={dateTime(new Date(now).toISOString())} labelEl={L} valueEl={V} />
          <InfoRow label={t('duration')} value={durationText(seconds, lang)} labelEl={L} valueEl={V} />
          <InfoRow label={t('normalFee')} value={money(quote.gross)} labelEl={L} valueEl={V} />
          <InfoRow label={d.onlyReceipts ? t('receiptDiscount') : t('discount')} value={d.receipt ? `− ${money(d.receipt)}` : money(0)} labelEl={L} valueEl={V} />
          <InfoRow label={t('promotion')} value={d.promotion ? `− ${money(d.promotion)}` : money(0)} labelEl={L} valueEl={V} />
          {quote.paid > 0 && <InfoRow label={t('paidAlready')} value={`− ${money(quote.paid)}`} labelEl={L} valueEl={V} />}
        </div>
        <div className="amount-box">
          <div className="amount-label">{t('total')}</div>
          <div className="amount-value" data-el="payment-kiosk/summary/amount/total">
            {money(quote.due)}
          </div>
        </div>
        {quote.due <= 0 && (
          <div className="notice notice-ok">
            {t('nothingDue')} · {t('exitNow')}
            {quote.exitDeadlineAt && quote.withinGrace ? ` — ${t('exitBefore')} ${time(quote.exitDeadlineAt)} น.` : ''}
          </div>
        )}
        {quote.lastPaidAt && !quote.withinGrace && quote.due > 0 && <div className="notice notice-danger">{t('overstay')}</div>}
      </div>
      <div className="pk-nav">
        <button type="button" className="kbtn kbtn-secondary" onClick={onBack}>
          ← {t('back')}
        </button>
        {canValidate && quote.due > 0 && (
          <button type="button" className="kbtn kbtn-secondary" onClick={onValidate}>
            🧾 {t('scanReceipt')}
          </button>
        )}
        {quote.due > 0 && (
          <button type="button" className="kbtn kbtn-pulse" data-el="payment-kiosk/summary/actions/pay" onClick={onPay}>
            {t('pay')} →
          </button>
        )}
      </div>
    </div>
  );
}

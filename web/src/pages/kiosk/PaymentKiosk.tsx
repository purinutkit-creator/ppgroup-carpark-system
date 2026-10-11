/**
 * Payment kiosk (/kiosk/pay). Idle promo playlist → find the car (ticket QR
 * or plate + province) → fee summary → optional receipt validation → pay
 * (PromptPay / card / cash) → print receipt → "please exit before HH:MM".
 */
import { useCallback, useEffect, useState } from 'react';
import '../../kiosk.css';
import { get, post } from '../../lib/api';
import { dateTime, money, time } from '../../lib/format';
import { useSocketEvents } from '../../lib/useSocket';
import { useDesign } from '../../design/DesignProvider';
import { errorText } from '../../components/ui';
import type { PrinterTarget } from '../../print/print';
import { useAt, useBootstrap, useIdleTimeout, useInterval } from '../../components/kiosk/hooks';
import { useScanner } from '../../components/kiosk/useScanner';
import { CameraScanner, cameraScanSupported } from '../../components/kiosk/CameraScanner';
import { ThaiKeyboard, acceptPlateKey, formatPlateInput, parsePlateInput } from '../../components/kiosk/ThaiKeyboard';
import { ProvincePicker } from '../../components/kiosk/ProvincePicker';
import { KioskHeader, NoDevice, PlateBox } from '../../components/kiosk/KioskUi';
import { printParkingReceipt } from '../../components/kiosk/receiptPrint';
import { useKT } from '../../components/kiosk/kioskI18n';
import type { KioskContentItem, Payment, Quote } from '../../components/kiosk/types';
import { PromoIdle } from './payment/Idle';
import { Summary } from './payment/Summary';
import { ReceiptScan } from './payment/ReceiptScan';
import { PayStep } from './payment/PayStep';

type Step = 'idle' | 'start' | 'scan' | 'plate' | 'province' | 'pick' | 'summary' | 'receipt' | 'pay' | 'done';

interface FoundItem {
  id: number;
  parkingNo: string;
  plateText: string | null;
  province: string | null;
  entryAt: string;
}

export default function PaymentKiosk() {
  const { t } = useKT();
  const design = useDesign();
  const boot = useBootstrap();
  const b = boot.data;
  const settings = b?.device?.settings ?? {};
  const [step, setStep] = useState<Step>('idle');
  const [items, setItems] = useState<KioskContentItem[]>([]);
  const [plate, setPlate] = useState('');
  const [found, setFound] = useState<FoundItem[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [paid, setPaid] = useState<{ payment: Payment; quote: Quote | null } | null>(null);
  const [printMsg, setPrintMsg] = useState<string | null>(null);
  const [cashEvents, setCashEvents] = useState<number[]>([]);

  const loadContent = useCallback(async () => {
    try {
      const r = await get<{ items: KioskContentItem[] }>('/api/kiosk/content', { device: true });
      setItems(r.items);
    } catch {
      /* keep the current playlist */
    }
  }, []);

  useEffect(() => {
    if (boot.status === 'ready') loadContent();
  }, [boot.status, loadContent]);
  useInterval(loadContent, boot.status === 'ready' ? 5 * 60_000 : null);

  const { connected } = useSocketEvents(
    {
      'kiosk:content': () => loadContent(),
      'settings:updated': () => {
        loadContent();
        boot.reload();
      },
      'cash:inserted': (p: { amount?: number }) => p?.amount && setCashEvents((x) => [...x, Number(p.amount)]),
    },
    {},
    [boot.status],
  );

  const reset = useCallback(() => {
    setStep('idle');
    setPlate('');
    setFound([]);
    setQuote(null);
    setErr(null);
    setCamera(false);
    setPaid(null);
    setPrintMsg(null);
    setBusy(false);
  }, []);

  const idleSec = step === 'pay' ? Number(settings.paymentTimeoutSec ?? 180) : step === 'done' ? Number(settings.doneTimeoutSec ?? 20) : Number(settings.idleTimeoutSec ?? 60);
  useIdleTimeout(idleSec, reset, step !== 'idle');

  const loadQuote = useCallback(async (id: number) => {
    const r = await get<{ quote: Quote }>(`/api/kiosk/sessions/${id}/quote`, { device: true });
    setQuote(r.quote);
    return r.quote;
  }, []);
  // fee changes at quote.nextChangeAt — refresh then (summary / receipt steps)
  useAt(step === 'summary' || step === 'receipt' ? quote?.nextChangeAt : null, () => quote && loadQuote(quote.sessionId).catch(() => {}));

  const select = async (id: number) => {
    setBusy(true);
    setErr(null);
    try {
      await loadQuote(id);
      setStep('summary');
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const find = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ items: FoundItem[] }>('/api/kiosk/sessions/find', body, { device: true });
      if (!r.items.length) {
        setErr(t('notFound'));
        return;
      }
      if (r.items.length === 1) {
        await select(r.items[0].id);
        return;
      }
      setFound(r.items);
      setStep('pick');
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  useScanner((code) => find({ code }), { enabled: step === 'scan' || step === 'start' || step === 'idle' });

  const onPaid = useCallback(
    async (payment: Payment, q: Quote | null) => {
      setPaid({ payment, quote: q });
      setStep('done');
      if (settings.printReceipt === false) return;
      setPrintMsg(t('receiptPrinted'));
      try {
        const sessionId = q?.sessionId ?? quote?.sessionId;
        if (!sessionId) return;
        const printer = b?.printers?.[0] ?? (settings.printer as PrinterTarget | undefined) ?? null;
        await printParkingReceipt(sessionId, design?.config ?? null, printer, { device: true });
        setPrintMsg(null);
      } catch (e) {
        setPrintMsg(errorText(e));
      }
    },
    [b, settings.printReceipt, settings.printer, design, quote, t],
  );

  if (boot.status === 'nodevice') return <NoDevice next="/kiosk/pay" />;

  const parsed = parsePlateInput(plate);

  return (
    <div className="kx" style={b?.branding?.kioskBackgroundUrl ? { backgroundImage: `url("${b.branding.kioskBackgroundUrl}")` } : undefined}>
      <KioskHeader system="payment-kiosk" branding={b?.branding} online={connected} />
      {step === 'idle' ? (
        <PromoIdle items={items} onStart={() => setStep('start')} />
      ) : (
        <main className="kx-body">
          {step === 'start' && (
            <div className="pk-steps">
              <div className="pk-title" data-el="payment-kiosk/search/form/label">
                {t('payParking')}
              </div>
              <div className="pk-choice">
                <button type="button" className="kbtn" onClick={() => setStep('scan')}>
                  <span className="ico">▣</span>
                  {t('scanTicket')}
                </button>
                <button type="button" className="kbtn" onClick={() => setStep('plate')}>
                  <span className="ico">🚗</span>
                  {t('enterPlate')}
                </button>
              </div>
              <div className="pk-nav">
                <button type="button" className="kbtn kbtn-secondary" onClick={reset}>
                  ← {t('cancel')}
                </button>
              </div>
            </div>
          )}

          {step === 'scan' && (
            <div className="pk-steps">
              <div className="kiosk-card center">
                <div data-el="payment-kiosk/search/form/label">{t('scanTicket')}</div>
                <div className="scan-illustration">▣</div>
                <div className="k-hint" data-el="payment-kiosk/search/form/hint">
                  {t('scanTicketHint')}
                </div>
                {camera && <CameraScanner onDetect={(code) => find({ code })} />}
                {cameraScanSupported() && (
                  <button type="button" className="kbtn kbtn-secondary" onClick={() => setCamera(!camera)}>
                    📷 {camera ? t('stopCamera') : t('useCamera')}
                  </button>
                )}
              </div>
              <div className="pk-nav">
                <button type="button" className="kbtn kbtn-secondary" onClick={() => setStep('start')}>
                  ← {t('back')}
                </button>
                <button type="button" className="kbtn kbtn-secondary" onClick={() => setStep('plate')}>
                  🚗 {t('enterPlate')}
                </button>
              </div>
            </div>
          )}

          {step === 'plate' && (
            <div className="pk-steps">
              <div className="pk-title" data-el="payment-kiosk/search/form/label">
                {t('enterPlate')}
              </div>
              <div className="plate-input">
                <span data-el="payment-kiosk/search/form/input">{formatPlateInput(plate) || ' '}</span>
                <span className="caret" />
              </div>
              <div className="k-hint" data-el="payment-kiosk/search/form/hint">
                {t('plateHint')}
              </div>
              <ThaiKeyboard onKey={(c) => setPlate((v) => acceptPlateKey(v, c))} onBackspace={() => setPlate((v) => v.slice(0, -1))} onClear={() => setPlate('')} />
              <div className="pk-nav">
                <button type="button" className="kbtn kbtn-secondary" onClick={() => setStep('start')}>
                  ← {t('back')}
                </button>
                <button type="button" className="kbtn" disabled={!parsed} onClick={() => setStep('province')}>
                  {t('next')} →
                </button>
              </div>
            </div>
          )}

          {step === 'province' && parsed && (
            <div className="pk-steps">
              <div className="row" style={{ justifyContent: 'center' }}>
                <span className="plate-box">
                  <span className="pb-plate" data-el="payment-kiosk/summary/vehicle/plate">
                    {parsed.prefix} {parsed.number}
                  </span>
                </span>
              </div>
              <div className="pk-title" data-el="payment-kiosk/search/form/label">
                {t('selectProvince')}
              </div>
              <ProvincePicker onPick={(p) => find({ prefix: parsed.prefix, number: parsed.number, province: p.code })} onSkip={() => find({ prefix: parsed.prefix, number: parsed.number })} />
              <div className="pk-nav">
                <button type="button" className="kbtn kbtn-secondary" onClick={() => setStep('plate')}>
                  ← {t('back')}
                </button>
              </div>
            </div>
          )}

          {step === 'pick' && (
            <div className="pk-steps">
              <div className="pk-title" data-el="payment-kiosk/search/form/label">
                {t('selectVehicle')}
              </div>
              <div className="pk-list">
                {found.map((f) => (
                  <button key={f.id} type="button" className="pk-list-item" onClick={() => select(f.id)} disabled={busy}>
                    <PlateBox plate={f.plateText} province={f.province} plateEl="payment-kiosk/summary/vehicle/plate" provinceEl="payment-kiosk/summary/vehicle/province" />
                    <span>
                      {t('entryTime')} {dateTime(f.entryAt)}
                    </span>
                  </button>
                ))}
              </div>
              <div className="pk-nav">
                <button type="button" className="kbtn kbtn-secondary" onClick={() => setStep('start')}>
                  ← {t('back')}
                </button>
              </div>
            </div>
          )}

          {step === 'summary' && quote && (
            <Summary
              quote={quote}
              canValidate={!!b?.validation.selfServiceKiosk}
              onValidate={() => setStep('receipt')}
              onPay={() => setStep('pay')}
              onBack={reset}
            />
          )}

          {step === 'receipt' && quote && (
            <ReceiptScan
              sessionId={quote.sessionId}
              allowMultiple={!!b?.validation.allowMultipleReceipts}
              onApplied={(q) => setQuote(q)}
              onDone={() => {
                loadQuote(quote.sessionId).catch(() => {});
                setStep('summary');
              }}
            />
          )}

          {step === 'pay' && quote && b && (
            <PayStep quote={quote} methods={b.paymentMethods} cashAcceptor={!!settings.cashAcceptor} cashEvents={cashEvents} onPaid={onPaid} onBack={() => setStep('summary')} />
          )}

          {step === 'done' && paid && (
            <div className="pk-steps">
              <div className="kiosk-card center">
                <div className="big-icon ok">✓</div>
                <div data-el="payment-kiosk/payment/status/message" className="k-msg-ok">
                  {t('paymentSuccess')}
                </div>
                <div className="amount-value num" data-el="payment-kiosk/payment/qr/amount">
                  {money(paid.payment.amount)}
                </div>
                {paid.payment.method === 'CASH' && (paid.payment.changeGiven ?? 0) > 0 && (
                  <div className="notice">
                    {t('change')} {money(paid.payment.changeGiven)}
                  </div>
                )}
                {paid.quote?.exitDeadlineAt && (
                  <>
                    <div className="k-hint">{t('exitBefore')}</div>
                    <div data-el="payment-kiosk/done/message/deadline">{time(paid.quote.exitDeadlineAt)} น.</div>
                  </>
                )}
                {printMsg && <div className="muted">{printMsg}</div>}
              </div>
              <div className="pk-nav">
                <button type="button" className="kbtn" onClick={reset}>
                  {t('done')}
                </button>
              </div>
            </div>
          )}

          {err && <div className="notice notice-danger">{err}</div>}
          {busy && <div className="muted">{t('checking')}</div>}
        </main>
      )}
    </div>
  );
}

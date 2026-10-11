/**
 * Exit kiosk (/kiosk/exit). The exit camera decides the state on the server:
 * EXIT_OPEN (paid / free), EXIT_PAYMENT (pay here by PromptPay / card),
 * EXIT_NOT_FOUND (scan the ticket QR) or EXIT_MISMATCH (wait for staff).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import '../../kiosk.css';
import { get, post } from '../../lib/api';
import { dateTime, durationText, money } from '../../lib/format';
import { errorText } from '../../components/ui';
import { playSound, useBootstrap, useNow } from '../../components/kiosk/hooks';
import { useGateState } from '../../components/kiosk/useGateState';
import { useScanner } from '../../components/kiosk/useScanner';
import { CameraScanner, cameraScanSupported } from '../../components/kiosk/CameraScanner';
import { useKioskPayment, type PayMethod } from '../../components/kiosk/usePaymentWatch';
import { PayPanel } from '../../components/kiosk/PayPanel';
import { useKT } from '../../components/kiosk/kioskI18n';
import { Barrier, CallStaffDialog, InfoRow, KioskHeader, NoDevice, PlateBox } from '../../components/kiosk/KioskUi';
import type { GateState, Quote } from '../../components/kiosk/types';

const SYS = 'exit-kiosk';
const E = (p: string) => `${SYS}/main/${p}`;

export default function ExitKiosk() {
  const [sp] = useSearchParams();
  const { t, lang } = useKT();
  const boot = useBootstrap();
  const b = boot.data;
  const gateId = b?.gate?.id ?? (Number(sp.get('gate')) || null);
  const [barrierOpen, setBarrierOpen] = useState(false);
  const barrierTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { state, online, refresh, error: gateError } = useGateState(gateId, {
    onBarrierOpen: () => {
      setBarrierOpen(true);
      if (barrierTimer.current) clearTimeout(barrierTimer.current);
      barrierTimer.current = setTimeout(() => setBarrierOpen(false), 8000);
    },
  });
  const [staffOpen, setStaffOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const settings = b?.device?.settings ?? {};
  const resetAfter = Number(settings.resetAfterSec ?? 10);
  const methods = b?.paymentMethods;
  const sounds = b?.branding?.sounds;

  const recheck = useCallback(async () => {
    if (!gateId) return;
    try {
      await post(`/api/gates/${gateId}/exit/recheck`, {}, { device: true });
    } catch {
      refresh();
    }
  }, [gateId, refresh]);

  const pay = useKioskPayment(() => recheck());
  const [method, setMethod] = useState<PayMethod | null>(null);

  const startPay = useCallback(
    async (sessionId: number, m: PayMethod) => {
      setMethod(m);
      await pay.start(sessionId, m);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pay.start],
  );

  // new server state → reset local UI; auto-open the PromptPay QR on EXIT_PAYMENT
  useEffect(() => {
    setScanErr(null);
    setCamera(false);
    pay.clear();
    setMethod(null);
    if (!state) return;
    if (state.kind === 'EXIT_OPEN') playSound(sounds?.exit, sounds?.enabled);
    if (state.kind === 'EXIT_MISMATCH' || state.kind === 'EXIT_NOT_FOUND') playSound(sounds?.error, sounds?.enabled);
    if (state.kind === 'EXIT_PAYMENT' && state.quote.due > 0 && methods) {
      const m: PayMethod | null = methods.promptpay ? 'PROMPTPAY' : methods.card ? 'CARD' : null;
      if (m) startPay(state.session.id, m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.kind, state?.at, methods]);

  // auto-return to idle
  useEffect(() => {
    if (!state || state.kind === 'IDLE') return;
    const sec = state.kind === 'EXIT_OPEN' ? resetAfter : Number(settings.waitTimeoutSec ?? 300);
    const tm = setTimeout(() => post(`/api/gates/${gateId}/reset`, {}, { device: true }).catch(() => refresh()), sec * 1000);
    return () => clearTimeout(tm);
  }, [state, resetAfter, gateId, refresh, settings.waitTimeoutSec]);

  const scanTicket = useCallback(
    async (code: string) => {
      if (!gateId || scanning) return;
      setScanning(true);
      setScanErr(null);
      try {
        await post(`/api/gates/${gateId}/exit/scan`, { code }, { device: true });
      } catch (e) {
        setScanErr(errorText(e));
      } finally {
        setScanning(false);
      }
    },
    [gateId, scanning],
  );
  const canScan = !!state && (state.kind === 'IDLE' || state.kind === 'EXIT_NOT_FOUND');
  useScanner(scanTicket, { enabled: canScan });

  if (boot.status === 'nodevice') return <NoDevice next="/kiosk/exit" />;
  if (boot.status === 'ready' && !gateId) return <ExitGatePicker />;

  return (
    <div className="kx" style={b?.branding?.kioskBackgroundUrl ? { backgroundImage: `url("${b.branding.kioskBackgroundUrl}")` } : undefined}>
      <KioskHeader system={SYS} branding={b?.branding} online={online} />
      <main className="kx-body">
        {!state ? (
          <div className="k-hint" data-el={E('status/hint')}>
            {boot.error ?? gateError ?? '…'}
          </div>
        ) : (
          <View
            state={state}
            lang={lang}
            t={t}
            barrierOpen={barrierOpen}
            thanks={b?.branding?.messages.exitThanks}
            pay={pay}
            method={method}
            methods={methods}
            onMethod={(m) => state.kind === 'EXIT_PAYMENT' && startPay(state.session.id, m)}
            camera={camera}
            setCamera={setCamera}
            onScan={scanTicket}
            scanErr={scanErr}
            scanning={scanning}
          />
        )}
        <div className="k-actions" style={{ maxWidth: 900 }}>
          <button type="button" className="kbtn kbtn-secondary" data-el={E('actions/button')} onClick={() => setStaffOpen(true)}>
            ☎ {t('callStaff')}
          </button>
        </div>
      </main>
      <footer className="kx-foot">
        <span>{b?.gate?.name ?? ''}</span>
        <span className="spacer" />
        {b?.branding?.supportPhone && <span>☎ {b.branding.supportPhone}</span>}
      </footer>
      <CallStaffDialog open={staffOpen} onClose={() => setStaffOpen(false)} phone={b?.branding?.supportPhone} system={SYS} />
    </div>
  );
}

function View({
  state,
  lang,
  t,
  barrierOpen,
  thanks,
  pay,
  method,
  methods,
  onMethod,
  camera,
  setCamera,
  onScan,
  scanErr,
  scanning,
}: {
  state: GateState;
  lang: 'th' | 'en' | 'zh';
  t: ReturnType<typeof useKT>['t'];
  barrierOpen: boolean;
  thanks?: string;
  pay: ReturnType<typeof useKioskPayment>;
  method: PayMethod | null;
  methods?: { promptpay: boolean; card: boolean };
  onMethod: (m: PayMethod) => void;
  camera: boolean;
  setCamera: (v: boolean) => void;
  onScan: (code: string) => void;
  scanErr: string | null;
  scanning: boolean;
}) {
  const scanBlock = (
    <>
      <div className="scan-illustration">▣</div>
      <div className="k-hint" data-el={E('status/hint')}>
        {t('scanTicketHint')}
      </div>
      {camera && <CameraScanner onDetect={onScan} />}
      {cameraScanSupported() && (
        <button type="button" className="kbtn kbtn-secondary" data-el={E('actions/button')} onClick={() => setCamera(!camera)}>
          📷 {camera ? t('stopCamera') : t('useCamera')}
        </button>
      )}
      {scanning && <div className="muted">{t('checking')}</div>}
      {scanErr && <div className="notice notice-danger">{scanErr}</div>}
    </>
  );

  switch (state.kind) {
    case 'IDLE':
      return (
        <div className="kiosk-card center">
          <div data-el={E('status/message')}>{t('thankYou')}</div>
          <Barrier open={barrierOpen} />
          {scanBlock}
        </div>
      );
    case 'EXIT_OPEN':
      return (
        <div className="kiosk-card center">
          <PlateBox plate={state.session.plateText} province={state.session.province} plateEl={E('vehicle/plate')} provinceEl={E('vehicle/province')} />
          <div className="big-icon ok">✓</div>
          <div data-el={E('status/message')}>{lang === 'th' ? state.message || thanks : t('thankYou')}</div>
          <div className="k-hint k-msg-ok" data-el={E('status/hint')}>
            {t('barrierOpen')}
          </div>
          <Barrier open />
        </div>
      );
    case 'EXIT_PAYMENT':
      return <PaymentView state={state} lang={lang} t={t} pay={pay} method={method} methods={methods} onMethod={onMethod} />;
    case 'EXIT_NOT_FOUND':
      return (
        <div className="kiosk-card center">
          {state.detection?.plate.text && (
            <PlateBox plate={state.detection.plate.text} province={state.detection.plate.province} plateEl={E('vehicle/plate')} provinceEl={E('vehicle/province')} />
          )}
          <div data-el={E('status/message')}>{state.message || t('ticketNotFound')}</div>
          {scanBlock}
        </div>
      );
    case 'EXIT_MISMATCH':
      return (
        <div className="kiosk-card center">
          <PlateBox plate={state.session.plateText} province={state.session.province} plateEl={E('vehicle/plate')} provinceEl={E('vehicle/province')} />
          <div className="big-icon warn">⚠</div>
          <div data-el={E('status/message')}>{t('mismatch')}</div>
          <div className="k-hint" data-el={E('status/hint')}>
            {state.message} — {t('waitStaff')}
          </div>
        </div>
      );
    default:
      return (
        <div className="kiosk-card center">
          <div data-el={E('status/message')}>{t('waitStaff')}</div>
        </div>
      );
  }
}

function PaymentView({
  state,
  lang,
  t,
  pay,
  method,
  methods,
  onMethod,
}: {
  state: Extract<GateState, { kind: 'EXIT_PAYMENT' }>;
  lang: 'th' | 'en' | 'zh';
  t: ReturnType<typeof useKT>['t'];
  pay: ReturnType<typeof useKioskPayment>;
  method: PayMethod | null;
  methods?: { promptpay: boolean; card: boolean };
  onMethod: (m: PayMethod) => void;
}) {
  const [quote, setQuote] = useState<Quote>(state.quote);
  useEffect(() => setQuote(state.quote), [state.quote]);
  const now = useNow(1000);
  // refresh the displayed fee at its next change (the charge is re-created by the server when the amount changes)
  useEffect(() => {
    if (!quote.nextChangeAt) return;
    const wait = new Date(quote.nextChangeAt).getTime() - Date.now() + 500;
    const tm = setTimeout(async () => {
      try {
        const r = await get<{ quote: Quote }>(`/api/kiosk/sessions/${state.session.id}/quote`, { device: true });
        setQuote(r.quote);
        if (method && r.quote.due !== pay.payment?.amount && r.quote.due > 0) onMethod(method);
      } catch {
        /* keep current */
      }
    }, Math.max(1000, Math.min(wait, 2 ** 31 - 1)));
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.nextChangeAt]);
  const elapsed = quote.durationSeconds + Math.max(0, Math.floor((now - new Date(quote.now).getTime()) / 1000));
  const other = methods ? (['PROMPTPAY', 'CARD'] as PayMethod[]).filter((m) => m !== method && (m === 'PROMPTPAY' ? methods.promptpay : methods.card)) : [];

  return (
    <div className="kiosk-card" style={{ width: 'min(1100px, 100%)' }}>
      <div className="row" style={{ justifyContent: 'center' }}>
        <PlateBox plate={quote.plate.text} province={quote.plate.province} plateEl={E('vehicle/plate')} provinceEl={E('vehicle/province')} />
      </div>
      {state.overstay && <div className="notice notice-danger">{t('overstay')}</div>}
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="info-panel">
          <InfoRow label={t('entryTime')} value={dateTime(quote.entryAt)} labelEl={E('info/label')} valueEl={E('info/value')} />
          <InfoRow label={t('duration')} value={durationText(elapsed, lang)} labelEl={E('info/label')} valueEl={E('info/value')} />
          {quote.feeLines.map((l, i) => (
            <InfoRow key={i} label={l.label} value={money(l.amount)} labelEl={E('info/label')} valueEl={E('info/value')} />
          ))}
          <InfoRow label={t('normalFee')} value={money(quote.gross)} labelEl={E('info/label')} valueEl={E('info/value')} strong />
          {quote.discountTotal > 0 && <InfoRow label={t('discount')} value={`− ${money(quote.discountTotal)}`} labelEl={E('info/label')} valueEl={E('info/value')} />}
          {quote.paid > 0 && <InfoRow label={t('paidAlready')} value={`− ${money(quote.paid)}`} labelEl={E('info/label')} valueEl={E('info/value')} />}
          <div className="amount-box">
            <div className="amount-label">{t('amountDue')}</div>
            <div className="amount-value" data-el={E('amount/total')}>
              {money(quote.due)}
            </div>
          </div>
        </div>
        <div>
          {pay.payment ? (
            <PayPanel system={SYS} payment={pay.payment} qr={pay.qr} onRenew={() => method && onMethod(method)} />
          ) : (
            <div className="muted center">{pay.busy ? t('checking') : ''}</div>
          )}
          {pay.error && <div className="notice notice-danger">{pay.error}</div>}
          {other.length > 0 && (
            <div className="k-actions mt">
              {other.map((m) => (
                <button key={m} type="button" className="kbtn kbtn-secondary" data-el={E('actions/button')} onClick={() => onMethod(m)}>
                  {m === 'PROMPTPAY' ? `▣ ${t('promptpay')}` : `💳 ${t('card')}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExitGatePicker() {
  const [gates, setGates] = useState<Array<{ id: number; name: string; siteName: string; direction: string }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    get<{ gates: Array<{ id: number; name: string; siteName: string; direction: string }> }>('/api/gates')
      .then((r) => setGates(r.gates.filter((g) => g.direction === 'EXIT')))
      .catch((e) => setErr(errorText(e)));
  }, []);
  return (
    <div className="kiosk-center">
      <div className="kiosk-card">
        <h2>เลือกช่องทางออก</h2>
        {err && <div className="notice notice-danger">{err}</div>}
        {gates?.map((g) => (
          <a key={g.id} className="kbtn kbtn-secondary kbtn-block" href={`?gate=${g.id}`}>
            {g.siteName} · {g.name}
          </a>
        ))}
        {gates && !gates.length && <div className="muted">ไม่มีช่องทางออก</div>}
      </div>
    </div>
  );
}

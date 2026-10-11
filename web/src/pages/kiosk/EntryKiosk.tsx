/**
 * Entry kiosk (/kiosk/entry). Renders the gate state pushed by the server
 * (camera → ENTRY_CONFIRM → TICKET_ISSUED …) and prints the ticket locally.
 * Device: ENTRY_KIOSK key; staff with gate.control may open ?gate=<id>.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import '../../kiosk.css';
import { get, newIdempotencyKey, post } from '../../lib/api';
import { time } from '../../lib/format';
import { useDesign } from '../../design/DesignProvider';
import { printDoc } from '../../print/print';
import { ticketDoc } from '../../print/templates';
import { errorText } from '../../components/ui';
import { useBootstrap, playSound } from '../../components/kiosk/hooks';
import { useGateState } from '../../components/kiosk/useGateState';
import { useKT, vehicleName, freeTimeText } from '../../components/kiosk/kioskI18n';
import { Barrier, DriveForward, InfoRow, KioskHeader, NoDevice, PlateBox, QrImage } from '../../components/kiosk/KioskUi';
import type { GateState } from '../../components/kiosk/types';

const SYS = 'entry-kiosk';
const E = (p: string) => `${SYS}/main/${p}`;

type TicketPhase = 'printing' | 'take' | 'taken' | 'printError';

export default function EntryKiosk() {
  const [sp] = useSearchParams();
  const { t, lang } = useKT();
  const design = useDesign();
  const boot = useBootstrap();
  const b = boot.data;
  const gateId = b?.gate?.id ?? (Number(sp.get('gate')) || null);
  const [barrierOpen, setBarrierOpen] = useState(false);
  const barrierTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { state, online, error: gateError, refresh } = useGateState(gateId, {
    onBarrierOpen: () => {
      setBarrierOpen(true);
      if (barrierTimer.current) clearTimeout(barrierTimer.current);
      barrierTimer.current = setTimeout(() => setBarrierOpen(false), 6000);
    },
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<TicketPhase>('printing');
  const handled = useRef<number | null>(null);
  const settings = b?.device?.settings ?? {};
  const resetAfter = Number(settings.resetAfterSec ?? 12);
  const autoTakenSec = Number(settings.ticketTakenAutoSec ?? 0);
  const sounds = b?.branding?.sounds;

  const reset = useCallback(async () => {
    if (!gateId) return;
    try {
      await post(`/api/gates/${gateId}/reset`, {}, { device: true });
    } catch {
      refresh();
    }
  }, [gateId, refresh]);

  // clear transient UI whenever the server state changes
  useEffect(() => {
    setErr(null);
    setBusy(false);
    if (!state) return;
    if (state.kind === 'ENTRY_CONFIRM' || state.kind === 'ENTRY_REVIEW') playSound(sounds?.entry, sounds?.enabled);
    if (state.kind === 'ENTRY_DENIED') playSound(sounds?.error, sounds?.enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.kind, state?.at]);

  const ticketTaken = useCallback(
    async (sessionId: number) => {
      setPhase('taken');
      if (!gateId || b?.operation.autoIssueTicket) return; // auto-issue already opened the barrier
      try {
        await post(`/api/gates/${gateId}/ticket-taken`, { sessionId }, { device: true });
      } catch (e) {
        setErr(errorText(e));
      }
    },
    [gateId, b?.operation.autoIssueTicket],
  );

  // print once per issued session
  useEffect(() => {
    if (state?.kind !== 'TICKET_ISSUED' || handled.current === state.session.id) return;
    handled.current = state.session.id;
    if (state.ticketless || !state.ticket) {
      setPhase('taken');
      return;
    }
    setPhase('printing');
    const doc = ticketDoc(state.ticket);
    printDoc(doc, design?.config ?? null, b?.printers?.[0] ?? null, { device: true, job: 'ticket', ref: state.session.parkingNo })
      .then(() => setPhase((p) => (p === 'printing' ? 'take' : p)))
      .catch(() => setPhase('printError'));
  }, [state, design, b]);

  // simulated "ticket taken" sensor: auto after N seconds if configured
  useEffect(() => {
    if (state?.kind !== 'TICKET_ISSUED' || phase !== 'take' || autoTakenSec <= 0) return;
    const id = state.session.id;
    const tm = setTimeout(() => ticketTaken(id), autoTakenSec * 1000);
    return () => clearTimeout(tm);
  }, [state, phase, autoTakenSec, ticketTaken]);

  // auto-return to IDLE
  useEffect(() => {
    if (!state || state.kind === 'IDLE') return;
    let sec = 0;
    if (state.kind === 'TICKET_ISSUED') sec = phase === 'taken' ? resetAfter : phase === 'printError' ? 60 : 0;
    else if (state.kind === 'ENTRY_DENIED') sec = Math.max(resetAfter, 20);
    else if (state.kind === 'ENTRY_CONFIRM' || state.kind === 'ENTRY_REVIEW') sec = Number(settings.confirmTimeoutSec ?? 120);
    if (!sec) return;
    const tm = setTimeout(reset, sec * 1000);
    return () => clearTimeout(tm);
  }, [state, phase, resetAfter, reset, settings.confirmTimeoutSec]);

  const issue = async (body: Record<string, unknown>) => {
    if (!gateId) return;
    setBusy(true);
    setErr(null);
    try {
      await post(`/api/gates/${gateId}/entry/issue`, { ...body, idempotencyKey: newIdempotencyKey() }, { device: true });
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
      refresh();
    }
  };

  if (boot.status === 'nodevice') return <NoDevice next="/kiosk/entry" />;
  if (boot.status === 'ready' && !gateId) return <GatePicker />;

  const lotFull = state?.kind === 'ENTRY_DENIED' && state.reason === 'LOT_FULL';

  return (
    <div className="kx" style={b?.branding?.kioskBackgroundUrl ? { backgroundImage: `url("${b.branding.kioskBackgroundUrl}")` } : undefined}>
      <KioskHeader system={SYS} branding={b?.branding} online={online} lotFull={lotFull} />
      <main className="kx-body">
        {!state ? (
          <div className="k-hint" data-el={E('status/hint')}>
            {boot.error ?? gateError ?? '…'}
          </div>
        ) : (
          <StateView
            state={state}
            phase={phase}
            busy={busy}
            barrierOpen={barrierOpen}
            welcome={b?.branding?.messages.entryWelcome}
            rate={b?.rate ?? null}
            onIssue={issue}
            onTaken={ticketTaken}
            onRetryPrint={() => {
              handled.current = null;
              refresh();
            }}
            lang={lang}
            t={t}
          />
        )}
        {err && <div className="notice notice-danger">{err}</div>}
      </main>
      <footer className="kx-foot">
        <span>{b?.gate?.name ?? ''}</span>
        <span className="spacer" />
        {b?.branding?.supportPhone && <span>☎ {b.branding.supportPhone}</span>}
      </footer>
    </div>
  );
}

function StateView({
  state,
  phase,
  busy,
  barrierOpen,
  welcome,
  rate,
  onIssue,
  onTaken,
  onRetryPrint,
  lang,
  t,
}: {
  state: GateState;
  phase: TicketPhase;
  busy: boolean;
  barrierOpen: boolean;
  welcome?: string;
  rate: { freeMinutes: number; hourlyRate: number } | null;
  onIssue: (b: Record<string, unknown>) => void;
  onTaken: (sessionId: number) => void;
  onRetryPrint: () => void;
  lang: 'th' | 'en' | 'zh';
  t: ReturnType<typeof useKT>['t'];
}) {
  switch (state.kind) {
    case 'IDLE':
      return (
        <div className="kiosk-card center">
          <div data-el={E('status/message')}>{lang === 'th' && welcome ? welcome : t('welcomeEntry')}</div>
          <DriveForward />
          <div className="k-hint" data-el={E('status/hint')}>
            {t('driveForward')}
          </div>
          <Barrier open={barrierOpen} />
        </div>
      );

    case 'ENTRY_CONFIRM': {
      const d = state.detection;
      return (
        <div className="kiosk-card center">
          <PlateBox plate={d.plate.text} province={d.plate.province} plateEl={E('vehicle/plate')} provinceEl={E('vehicle/province')} />
          {state.decision === 'KIOSK_CONFIRM' && <div className="notice">{t('checkPlate')}</div>}
          <div className="info-panel">
            <InfoRow label={t('vehicleType')} value={vehicleName(d.vehicleType, lang)} labelEl={E('info/label')} valueEl={E('info/value')} />
            <InfoRow label={t('entryTime')} value={`${time(d.capturedAt)} น.`} labelEl={E('info/label')} valueEl={E('info/value')} />
            {rate && (
              <>
                <InfoRow label={t('rateFrom')} value={`${rate.hourlyRate} ${t('perHour')}`} labelEl={E('info/label')} valueEl={E('info/value')} />
                <InfoRow label={t('freeHours')} value={freeTimeText(rate.freeMinutes, lang)} labelEl={E('info/label')} valueEl={E('info/value')} />
              </>
            )}
          </div>
          <button type="button" className="kbtn kbtn-block kbtn-pulse" data-el={E('actions/button')} disabled={busy} onClick={() => onIssue({ detectionId: d.id })}>
            🎫 {t('takeTicket')}
          </button>
          <Barrier open={barrierOpen} />
        </div>
      );
    }

    case 'ENTRY_REVIEW':
      return (
        <div className="kiosk-card center">
          {state.detection?.plate.text ? (
            <PlateBox plate={state.detection.plate.text} province={state.detection.plate.province} plateEl={E('vehicle/plate')} provinceEl={E('vehicle/province')} />
          ) : (
            <div className="big-icon warn">⚠</div>
          )}
          <div data-el={E('status/message')}>{state.message || t('plateUnread')}</div>
          {state.allowUnplated ? (
            <button
              type="button"
              className="kbtn kbtn-block kbtn-pulse"
              data-el={E('actions/button')}
              disabled={busy}
              onClick={() => onIssue({ unplated: true, detectionId: state.detection?.id ?? undefined })}
            >
              🎫 {t('unplatedTicket')}
            </button>
          ) : (
            <div className="k-hint" data-el={E('status/hint')}>
              {t('waitStaff')}
            </div>
          )}
        </div>
      );

    case 'TICKET_ISSUED': {
      const s = state.session;
      if (state.ticketless) {
        return (
          <div className="kiosk-card center">
            <PlateBox plate={s.plateText} province={s.province} plateEl={E('vehicle/plate')} provinceEl={E('vehicle/province')} />
            <div className="big-icon ok">✓</div>
            <div data-el={E('status/message')}>{t('barrierOpen')}</div>
            <div className="k-hint" data-el={E('status/hint')}>
              {t('ticketless')}
            </div>
            <Barrier open={barrierOpen || phase === 'taken'} />
          </div>
        );
      }
      return (
        <div className="kiosk-card center">
          <div className="k-hint" data-el={E('info/label')}>
            {t('ticketNo')}
          </div>
          <div data-el={E('ticket/number')}>{s.parkingNo}</div>
          <PlateBox plate={s.plateText} province={s.province} plateEl={E('vehicle/plate')} provinceEl={E('vehicle/province')} />
          {state.ticket?.qrUrl && <QrImage text={state.ticket.qrUrl} size={220} />}
          <div className="info-panel">
            <InfoRow label={t('entryTime')} value={`${time(s.entryAt)} น.`} labelEl={E('info/label')} valueEl={E('info/value')} />
            {state.ticket?.freeTime && <InfoRow label={t('freeHours')} value={state.ticket.freeTime} labelEl={E('info/label')} valueEl={E('info/value')} />}
            {state.ticket?.rateText && <InfoRow label={t('rate')} value={state.ticket.rateText} labelEl={E('info/label')} valueEl={E('info/value')} />}
          </div>
          {phase === 'printing' && (
            <>
              <div className="ticket-slot" />
              <div data-el={E('status/message')}>{t('printing')}</div>
            </>
          )}
          {phase === 'take' && (
            <>
              <div className="ticket-slot" />
              <div data-el={E('status/message')}>{t('pleaseTakeTicket')}</div>
              <button type="button" className="kbtn kbtn-block kbtn-success" data-el={E('actions/button')} onClick={() => onTaken(s.id)}>
                ✓ {t('ticketTakenBtn')}
              </button>
            </>
          )}
          {phase === 'taken' && (
            <>
              <div data-el={E('status/message')} className="k-msg-ok">
                {t('barrierOpen')}
              </div>
              <Barrier open />
            </>
          )}
          {phase === 'printError' && (
            <>
              <div className="notice notice-danger">{t('printFailed')}</div>
              <div className="k-actions">
                <button type="button" className="kbtn kbtn-secondary" data-el={E('actions/button')} onClick={onRetryPrint}>
                  {t('tryAgain')}
                </button>
                <button type="button" className="kbtn" data-el={E('actions/button')} onClick={() => onTaken(s.id)}>
                  {t('ticketTakenBtn')}
                </button>
              </div>
            </>
          )}
        </div>
      );
    }

    case 'ENTRY_DENIED':
      return (
        <div className="kiosk-card center">
          <div className="big-icon err">⛔</div>
          <div data-el={E('status/message')} className="k-msg-danger">
            {state.reason === 'LOT_FULL' ? t('lotFull') : t('entryDenied')}
          </div>
          <div className="k-hint" data-el={E('status/hint')}>
            {state.message}
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

/** Staff opened /kiosk/entry without a gate: choose one. */
function GatePicker() {
  const [gates, setGates] = useState<Array<{ id: number; name: string; siteName: string; direction: string }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    get<{ gates: Array<{ id: number; name: string; siteName: string; direction: string }> }>('/api/gates')
      .then((r) => setGates(r.gates.filter((g) => g.direction === 'ENTRY')))
      .catch((e) => setErr(errorText(e)));
  }, []);
  return (
    <div className="kiosk-center">
      <div className="kiosk-card">
        <h2>เลือกช่องทางเข้า</h2>
        {err && <div className="notice notice-danger">{err}</div>}
        {gates?.map((g) => (
          <a key={g.id} className="kbtn kbtn-secondary kbtn-block" href={`?gate=${g.id}`}>
            {g.siteName} · {g.name}
          </a>
        ))}
        {gates && !gates.length && <div className="muted">ไม่มีช่องทางเข้า</div>}
      </div>
    </div>
  );
}

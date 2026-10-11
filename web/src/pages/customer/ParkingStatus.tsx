/**
 * Customer parking page (/p/:token) opened from the ticket QR. No login:
 * the unguessable token identifies the session. Live via socket
 * ({ parkingToken }) + re-fetch at quote.nextChangeAt. Amounts always come
 * from the server quote.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import '../../kiosk.css';
import { ApiError, get } from '../../lib/api';
import { date, dateTime, hms, money, time } from '../../lib/format';
import { LangSwitch, type Lang } from '../../lib/i18n';
import { useSocketEvents } from '../../lib/useSocket';
import { PlateBox } from '../../components/kiosk/KioskUi';
import { useAt, usePublicConfig, useServerClock } from '../../components/kiosk/hooks';
import { freeTimeText, useKT } from '../../components/kiosk/kioskI18n';
import { METHOD_TEXT } from '../../components/kiosk/receiptReasons';
import { PayFlow } from '../../components/customer/PayFlow';
import type { Payment, Quote } from '../../components/kiosk/types';

interface Validation {
  receipt: string;
  merchant: string | null;
  amount: number;
  status: string;
  at: string;
}
interface SessionData {
  quote: Quote;
  validations: Validation[];
  payments: Payment[];
  site: { name: string } | null;
}

const D = 'customer-web/session';

export default function ParkingStatus() {
  const { token = '' } = useParams();
  const { t, lang } = useKT();
  const cfg = usePublicConfig();
  const [data, setData] = useState<SessionData | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [closed, setClosed] = useState(false);
  const [view, setView] = useState<'status' | 'pay' | 'success'>('status');
  const [pushed, setPushed] = useState<Payment | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasData = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await get<SessionData>(`/api/public/sessions/${encodeURIComponent(token)}`);
      setData(r);
      hasData.current = true;
      setInvalid(false);
      if (r.quote.status !== 'ACTIVE') setClosed(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // a token stops working once the car exits: keep showing the last state as "exited"
        if (hasData.current) setClosed(true);
        else setInvalid(true);
      }
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const scheduleLoad = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(load, 400);
  }, [load]);

  useSocketEvents(
    {
      'session:update': (q: Quote) => {
        setData((d) => (d ? { ...d, quote: q } : d));
        scheduleLoad(); // history (validations / payments) may have changed too
      },
      'payment:update': (p: Payment) => {
        setPushed(p);
        setData((d) => (d ? { ...d, payments: [p, ...d.payments.filter((x) => x.id !== p.id)] } : d));
        scheduleLoad();
      },
      'session:closed': () => setClosed(true),
      'session:invalid': () => !hasData.current && setInvalid(true),
    },
    { parkingToken: token, token: null, deviceKey: null },
    [token],
  );

  const q = data?.quote ?? null;
  useAt(closed ? null : q?.nextChangeAt, load);
  const now = useServerClock(q?.now);
  const branding = cfg?.branding;
  const bg = branding?.customerBackgroundUrl ? { backgroundImage: `url("${branding.customerBackgroundUrl}")` } : undefined;

  const top = (
    <div className="cw-top">
      <span />
      <LangSwitch langs={(branding?.languages?.length ? branding.languages : ['th', 'en', 'zh']) as Lang[]} />
    </div>
  );

  if (invalid) {
    return (
      <div className="cw" style={bg}>
        <div className="cw-wrap">
          {top}
          <div className="cw-card center">
            <div className="big-icon warn">⚠</div>
            <div data-el={`${D}/header/status`}>{t('ticketInvalid')}</div>
            {branding?.supportPhone && <div className="muted">☎ {branding.supportPhone}</div>}
          </div>
        </div>
      </div>
    );
  }
  if (!q || !data) return <div className="cw page-loading">…</div>;

  const elapsed = Math.max(0, ((q.exitAt ? new Date(q.exitAt).getTime() : now) - new Date(q.entryAt).getTime()) / 1000);
  const freeMinutes = q.rate.freeMinutes + q.extraFreeMinutes;
  const overstay = !q.withinGrace && q.paid > 0 && q.due > 0;
  const paidInGrace = q.paid > 0 && q.due <= 0 && q.withinGrace && q.exitDeadlineAt;
  const methods = cfg?.paymentMethods ?? { promptpay: true, card: false, cash: false, ewallet: false };
  const canPay = !closed && q.due > 0 && (methods.promptpay || methods.card || methods.ewallet);
  const statusText = closed ? t('exited') : t('parking');
  const payStatus = q.paymentStatus === 'PAID' || q.paymentStatus === 'FREE' || q.paymentStatus === 'WAIVED' ? t('paid') : t('unpaid');

  return (
    <div className="cw" style={bg}>
      <div className="cw-wrap">
        {top}
        <div className="cw-head">
          {branding?.logoUrl && <img src={branding.logoUrl} alt="" />}
          <div data-el={`${D}/header/siteName`}>{branding?.siteName || data.site?.name || 'SMART PARKING'}</div>
          <span className={`cw-status ${closed ? 'exited' : ''}`} data-el={`${D}/header/status`}>
            {!closed && <span className="pulse" />}({statusText})
          </span>
        </div>

        {closed && <div className="notice">{t('sessionClosed')}</div>}

        {view === 'success' ? (
          <div className="cw-card cw-success">
            <div className="big-icon">✓</div>
            <div data-el="customer-web/payment/status/message">{t('paymentSuccess')}</div>
            {q.exitDeadlineAt && (
              <>
                <div className="muted">{t('exitBefore')}</div>
                <div className="cw-deadline" data-el="customer-web/payment/deadline/value">
                  {time(q.exitDeadlineAt)} น.
                </div>
                <div className="muted small">{date(q.exitDeadlineAt)}</div>
              </>
            )}
            <button type="button" className="btn btn-block" onClick={() => setView('status')}>
              {t('done')}
            </button>
          </div>
        ) : (
          <>
            <div className="cw-card">
              <div className="cw-plate">
                <span className="cw-label">
                  {t('plate')} / {t('province')}
                </span>
                <PlateBox plate={q.plate.text} province={q.plate.province} plateEl={`${D}/vehicle/plate`} provinceEl={`${D}/vehicle/province`} />
              </div>
              <div className="cw-timer">
                <span className="cw-label muted small">{t('duration')}</span>
                <span className="cw-timer-value" data-el={`${D}/timer/value`}>
                  {hms(elapsed)}
                </span>
                <span className="cw-sub">{t('hms')}</span>
              </div>
              <div className="cw-fee">
                <div className="muted small">{t('currentFee')}</div>
                <div className="cw-fee-value" data-el={`${D}/fee/current`}>
                  {money(q.gross)}
                </div>
              </div>
              <div className="cw-rows">
                <Row label={t('entryTime')} value={`${dateTime(q.entryAt)} น.`} />
                <Row label={t('freeTime')} value={freeTimeText(freeMinutes, lang)} />
                <Row label={t('stampDiscount')} value={q.discountTotal > 0 ? `− ${money(q.discountTotal)}` : money(0)} neg={q.discountTotal > 0} />
                {q.paid > 0 && <Row label={t('paidAlready')} value={`− ${money(q.paid)}`} neg />}
                <Row label={t('paymentStatus')} value={payStatus} />
              </div>
              <div className="cw-total">
                <div className="muted small">{t('amountDue')}</div>
                <div className="cw-total-value" data-el={`${D}/amount/total`}>
                  {money(q.due)}
                </div>
              </div>
              {overstay && (
                <div className="notice notice-danger" data-el={`${D}/notice/overstay`}>
                  {t('graceExpired')}
                </div>
              )}
              {paidInGrace && (
                <div className="notice notice-ok">
                  {t('exitBefore')} <b className="num">{time(q.exitDeadlineAt)} น.</b>
                </div>
              )}
              {view === 'status' && canPay && (
                <button type="button" className="cw-paybtn" data-el={`${D}/actions/pay`} onClick={() => setView('pay')}>
                  {t('pay')}
                </button>
              )}
            </div>

            {view === 'pay' && canPay && (
              <PayFlow
                token={token}
                quote={q}
                methods={methods}
                pushed={pushed}
                onPaid={() => {
                  load();
                  setView('success');
                }}
                onCancel={() => setView('status')}
              />
            )}

            <History data={data} t={t} />
          </>
        )}
        <div className="cw-foot">{cfg?.privacyNotice}</div>
      </div>
    </div>
  );
}

function Row({ label, value, neg }: { label: string; value: string; neg?: boolean }) {
  return (
    <div className={`cw-row ${neg ? 'neg' : ''}`}>
      <span className="cw-row-label" data-el={`${D}/details/label`}>
        {label}
      </span>
      <span className="cw-row-value num" data-el={`${D}/details/value`}>
        {value}
      </span>
    </div>
  );
}

function History({ data, t }: { data: SessionData; t: ReturnType<typeof useKT>['t'] }) {
  const { quote: q, validations, payments } = data;
  const discounts = q.discounts.filter((d) => d.type !== 'RECEIPT_VALIDATION');
  if (!validations.length && !discounts.length && !payments.length) return null;
  return (
    <div className="cw-card">
      <div className="cw-hist-title" data-el={`${D}/history/title`}>
        {t('history')}
      </div>
      {validations.length > 0 && (
        <>
          <div className="muted small">{t('stamps')}</div>
          <div className="cw-hist">
            {validations.map((v, i) => (
              <div key={i} className="cw-hist-item" data-el={`${D}/history/item`}>
                <span>{v.merchant ?? '-'}</span>
                <span className="num">{money(v.amount)}</span>
                <span className="sub">
                  {t('receiptNo')} {v.receipt}
                </span>
                <span className="sub">
                  {dateTime(v.at)} · {v.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {discounts.length > 0 && (
        <>
          <div className="muted small">{t('discounts')}</div>
          <div className="cw-hist">
            {discounts.map((d) => (
              <div key={d.id} className="cw-hist-item" data-el={`${D}/history/item`}>
                <span>{d.label}</span>
                <span className="num">{d.full ? '100%' : d.amount ? money(d.amount) : ''}</span>
                <span className="sub">{dateTime(d.createdAt)}</span>
                <span className="sub">{d.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {payments.length > 0 && (
        <>
          <div className="muted small">{t('payments')}</div>
          <div className="cw-hist">
            {payments.map((p) => (
              <div key={p.id} className="cw-hist-item" data-el={`${D}/history/item`}>
                <span>{METHOD_TEXT[p.method] ?? p.method}</span>
                <span className="num">{money(p.amount)}</span>
                <span className="sub">{dateTime(p.paidAt ?? p.createdAt)}</span>
                <span className="sub">{p.status === 'PAID' ? t('paid') : p.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

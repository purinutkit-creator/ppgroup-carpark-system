/** Building blocks shared by the entry / exit / payment kiosks. */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { LangSwitch, type Lang } from '../../lib/i18n';
import { date, time } from '../../lib/format';
import { useNow } from './hooks';
import { useKT } from './kioskI18n';
import type { Branding } from './types';

export function KioskHeader({
  system,
  branding,
  online,
  lotFull,
  right,
}: {
  system: 'entry-kiosk' | 'exit-kiosk' | 'payment-kiosk';
  branding: Branding | null | undefined;
  online: boolean;
  lotFull?: boolean;
  right?: ReactNode;
}) {
  const { t } = useKT();
  const now = useNow(1000);
  const iso = new Date(now).toISOString();
  return (
    <header className="kh">
      <div className="kh-brand">
        {branding?.logoUrl && <img src={branding.logoUrl} alt="" className="kh-logo" />}
        <span className="kh-site" data-el={`${system}/main/header/siteName`}>
          {branding?.siteName ?? ''}
        </span>
      </div>
      <div className="kh-clock" data-el={`${system}/main/header/clock`}>
        <span className="kh-date">{date(iso)}</span>
        <span className="kh-time">{time(iso, true)}</span>
      </div>
      <div className="kh-status">
        {lotFull && <span className="kh-chip kh-chip-danger">{t('lotFull')}</span>}
        <span className={`kh-chip ${online ? 'kh-chip-ok' : 'kh-chip-danger'}`}>
          <span className={`dot ${online ? 'dot-online' : 'dot-offline'}`} /> {online ? t('online') : t('offline')}
        </span>
        <LangSwitch langs={(branding?.languages?.length ? branding.languages : ['th', 'en', 'zh']) as Lang[]} />
        {right}
      </div>
    </header>
  );
}

/** Renders text as a QR image client-side. */
export function QrImage({ text, size = 280, className }: { text: string; size?: number; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: size * 2 })
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => void (alive = false);
  }, [text, size]);
  return url ? <img src={url} alt="QR" width={size} height={size} className={`qr-img ${className ?? ''}`} /> : <div className="qr-img qr-placeholder" style={{ width: size, height: size }} />;
}

/** mm:ss until `iso` (server-offset aware via `now`). */
export function Countdown({ iso, now, onExpire }: { iso: string; now: number; onExpire?: () => void }) {
  const left = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  useEffect(() => {
    if (left === 0) onExpire?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left === 0]);
  const m = Math.floor(left / 60);
  const s = left % 60;
  return (
    <span className="num">
      {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  );
}

/** Animated barrier arm; `open` lifts it. */
export function Barrier({ open }: { open: boolean }) {
  return (
    <div className={`barrier ${open ? 'barrier-open' : ''}`} aria-hidden>
      <div className="barrier-post" />
      <div className="barrier-arm" />
    </div>
  );
}

/** Animated "drive forward" chevrons. */
export function DriveForward() {
  return (
    <div className="drive-fwd" aria-hidden>
      <span>▲</span>
      <span>▲</span>
      <span>▲</span>
    </div>
  );
}

export function NoDevice({ next }: { next: string }) {
  const { t } = useKT();
  return (
    <div className="kiosk kiosk-center">
      <div className="kiosk-card center">
        <h2>{t('noDevice')}</h2>
        <p className="muted">Device key (X-Device-Key) — /setup</p>
        <Link className="btn btn-primary btn-xl" to={`/setup?next=${encodeURIComponent(next)}`}>
          {t('setupDevice')}
        </Link>
      </div>
    </div>
  );
}

export function CallStaffDialog({ open, onClose, phone, system }: { open: boolean; onClose: () => void; phone?: string; system: 'exit-kiosk' | 'payment-kiosk' | 'entry-kiosk' }) {
  const { t } = useKT();
  if (!open) return null;
  return (
    <div className="kiosk-overlay" onClick={onClose}>
      <div className="kiosk-card center" onClick={(e) => e.stopPropagation()}>
        <div className="big-icon">☎</div>
        <div data-el={`${system}/main/status/message`}>{t('callStaff')}</div>
        <p className="muted">{t('staffComing')}</p>
        {phone && (
          <a className="kiosk-phone num" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
            {phone}
          </a>
        )}
        <button type="button" className="btn btn-xl kiosk-btn-secondary" onClick={onClose}>
          {t('close')}
        </button>
      </div>
    </div>
  );
}

/** Row of label / value used on kiosk info panels. */
export function InfoRow({ label, value, labelEl, valueEl, strong }: { label: ReactNode; value: ReactNode; labelEl?: string; valueEl?: string; strong?: boolean }) {
  return (
    <div className={`info-row ${strong ? 'info-row-strong' : ''}`}>
      <span className="info-label" data-el={labelEl}>
        {label}
      </span>
      <span className="info-value num" data-el={valueEl}>
        {value}
      </span>
    </div>
  );
}

/** Thai licence-plate look-alike; typography of plate / province is set per system via data-el. */
export function PlateBox({ plate, province, plateEl, provinceEl, unknownText = 'ไม่ระบุทะเบียน', className }: { plate: string | null | undefined; province: string | null | undefined; plateEl: string; provinceEl: string; unknownText?: string; className?: string }) {
  return (
    <div className={`plate-box ${plate ? '' : 'unknown'} ${className ?? ''}`}>
      <span className="pb-plate" data-el={plateEl}>
        {plate || unknownText}
      </span>
      <span className="pb-prov" data-el={provinceEl}>
        {province || '—'}
      </span>
    </div>
  );
}

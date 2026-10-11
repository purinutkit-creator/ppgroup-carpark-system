/**
 * Payment-kiosk idle screen: promotional playlist (images / videos, each with
 * its own duration and FULL or SPLIT layout) + welcome / start panel.
 */
import { useEffect, useState } from 'react';
import { useKT } from '../../../components/kiosk/kioskI18n';
import type { KioskContentItem } from '../../../components/kiosk/types';

export function PromoIdle({ items, onStart }: { items: KioskContentItem[]; onStart: () => void }) {
  const [idx, setIdx] = useState(0);
  const item = items.length ? items[idx % items.length] : null;

  useEffect(() => {
    if (idx >= items.length) setIdx(0);
  }, [items.length, idx]);

  useEffect(() => {
    if (!item || items.length < 2) return;
    const tm = setTimeout(() => setIdx((i) => (i + 1) % items.length), Math.max(3, item.durationSec || 10) * 1000);
    return () => clearTimeout(tm);
  }, [item, items.length]);

  const next = () => setIdx((i) => (items.length ? (i + 1) % items.length : 0));

  if (!item) {
    return (
      <div className="idle-noads" onClick={onStart}>
        <Welcome onStart={onStart} />
      </div>
    );
  }
  const media = <Media key={`${item.id}-${idx}`} item={item} cover={item.layout === 'FULL'} onEnded={items.length > 1 ? next : undefined} />;
  const dots =
    items.length > 1 ? (
      <div className="promo-dots">
        {items.map((it, i) => (
          <span key={it.id} className={i === idx % items.length ? 'on' : ''} />
        ))}
      </div>
    ) : null;

  if (item.layout === 'SPLIT') {
    return (
      <div className="idle-split">
        <div className="promo-stage">
          {media}
          {dots}
        </div>
        <Welcome onStart={onStart} />
      </div>
    );
  }
  return (
    <div className="idle-full" onClick={onStart}>
      <div className="promo-stage">
        {media}
        {dots}
      </div>
      <div className="promo-full-cta">
        <StartButton onStart={onStart} />
      </div>
    </div>
  );
}

function Media({ item, cover, onEnded }: { item: KioskContentItem; cover: boolean; onEnded?: () => void }) {
  if (item.kind === 'VIDEO') {
    return <video className={cover ? 'promo-cover' : ''} src={item.url} autoPlay muted playsInline loop={!onEnded} onEnded={onEnded} />;
  }
  return <img className={cover ? 'promo-cover' : ''} src={item.url} alt={item.title} />;
}

function StartButton({ onStart }: { onStart: () => void }) {
  const { t } = useKT();
  return (
    <button
      type="button"
      className="kbtn kbtn-pulse"
      data-el="payment-kiosk/idle/actions/start"
      onClick={(e) => {
        e.stopPropagation();
        onStart();
      }}
    >
      {t('payParking')} [{t('start')}]
    </button>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  const { t } = useKT();
  return (
    <div className="welcome-panel">
      <div data-el="payment-kiosk/idle/header/welcome">WELCOME</div>
      <div data-el="payment-kiosk/idle/header/subtitle">{t('welcome')}</div>
      <StartButton onStart={onStart} />
      <div className="muted">{t('pressToStart')}</div>
    </div>
  );
}

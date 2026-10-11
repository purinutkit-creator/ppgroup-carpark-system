/**
 * Touch province picker: search with the on-screen consonant keyboard
 * (matches the consonant skeleton, so "ชบ" finds ชลบุรี) or the English name,
 * with the most common provinces first.
 */
import { useMemo, useState } from 'react';
import { PROVINCES, type Province } from '@pp/shared/provinces';
import { ThaiKeyboard } from './ThaiKeyboard';
import { useKT } from './kioskI18n';

/** Most frequent registrations around Bangkok first. */
export const COMMON_PROVINCES = ['10', '12', '13', '11', '20', '74', '73', '14', '24', '21', '50', '30'];

const skeleton = (s: string) => s.replace(/[^ก-ฮ]/g, '');

function matches(p: Province, q: string) {
  if (!q) return true;
  const latin = /[a-z]/i.test(q);
  if (latin) return p.en.toLowerCase().includes(q.toLowerCase());
  const names = [p.th, ...(p.aliases ?? [])];
  return names.some((n) => n.includes(q) || skeleton(n).includes(skeleton(q)));
}

export function ProvincePicker({ value, onPick, onSkip, el }: { value?: string | null; onPick: (p: Province) => void; onSkip?: () => void; el?: string }) {
  const { t, lang } = useKT();
  const [q, setQ] = useState('');
  const regular = useMemo(() => PROVINCES.filter((p) => /^\d+$/.test(p.code)), []);
  const common = useMemo(() => COMMON_PROVINCES.map((c) => regular.find((p) => p.code === c)).filter(Boolean) as Province[], [regular]);
  const found = useMemo(() => regular.filter((p) => matches(p, q)).sort((a, b) => a.th.localeCompare(b.th, 'th')), [regular, q]);
  const label = (p: Province) => (lang === 'th' ? p.th : `${p.th} · ${p.en}`);

  return (
    <div className="prov-picker">
      <div className="prov-search">
        <span className="prov-search-icon">🔍</span>
        <input
          className="prov-search-input"
          value={q}
          placeholder={t('search')}
          onChange={(e) => setQ(e.target.value)}
          inputMode="none"
          aria-label={t('search')}
        />
        {q && (
          <button type="button" className="btn btn-ghost" onClick={() => setQ('')}>
            ✕
          </button>
        )}
      </div>
      <div className="prov-lists">
        {!q && (
          <>
            <div className="prov-heading">{t('commonProvinces')}</div>
            <div className="prov-grid">
              {common.map((p) => (
                <button key={p.code} type="button" className={`prov-item prov-common ${value === p.code ? 'active' : ''}`} data-el={el} onClick={() => onPick(p)}>
                  {label(p)}
                </button>
              ))}
            </div>
            <div className="prov-heading">{t('allProvinces')}</div>
          </>
        )}
        <div className="prov-grid">
          {found.map((p) => (
            <button key={p.code} type="button" className={`prov-item ${value === p.code ? 'active' : ''}`} data-el={el} onClick={() => onPick(p)}>
              {label(p)}
            </button>
          ))}
          {!found.length && <div className="muted">—</div>}
        </div>
      </div>
      <ThaiKeyboard digits={false} onKey={(c) => setQ((x) => x + c)} onBackspace={() => setQ((x) => x.slice(0, -1))} onClear={() => setQ('')} />
      {onSkip && (
        <button type="button" className="btn btn-lg kiosk-btn-secondary" onClick={onSkip}>
          {t('noProvince')}
        </button>
      )}
    </div>
  );
}

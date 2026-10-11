/**
 * Font picker: searches the font library (uploaded + added Google fonts),
 * the Google Fonts catalogue and common system fonts, with a live preview.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesignConfig, FontAsset } from '@pp/shared/design/index';
import { ALL_WEIGHTS, PREVIEW_TEXT, WEIGHT_NAMES, cssFamily, ensurePreview, useFontSources } from './fonts';

/** Add (or keep) a font asset in config.fonts so clients load it. */
export function withFontAsset(cfg: DesignConfig, asset: FontAsset | null): DesignConfig {
  if (!asset || cfg.fonts.some((f) => f.family === asset.family)) return cfg;
  return { ...cfg, fonts: [...cfg.fonts, asset] };
}

export function setAssetWeights(cfg: DesignConfig, family: string, weights: number[]): DesignConfig {
  return { ...cfg, fonts: cfg.fonts.map((f) => (f.family === family ? { ...f, weights: [...weights].sort((a, b) => a - b) } : f)) };
}

const SUBSETS = [
  { id: '', label: 'ทุกภาษา' },
  { id: 'thai', label: 'ไทย' },
  { id: 'latin', label: 'English' },
  { id: 'chinese-simplified', label: '中文' },
];

export function FontPicker({
  value,
  onChange,
  config,
  allowEmpty,
  emptyLabel = '— ใช้ค่าที่สืบทอด —',
  showWeights = true,
  previewText = PREVIEW_TEXT,
  compact,
  disabled,
  onWeights,
}: {
  value: string;
  onChange: (family: string, asset: FontAsset | null) => void;
  config: DesignConfig;
  allowEmpty?: boolean;
  emptyLabel?: string;
  showWeights?: boolean;
  previewText?: string;
  compact?: boolean;
  disabled?: boolean;
  /** Called when the loaded weights of the selected font change. */
  onWeights?: (weights: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [subset, setSubset] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const { library, system, google, googleSource } = useFontSources(open ? query : '', subset);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (value) ensurePreview(value, config);
  }, [value, config]);
  useEffect(() => {
    if (hover) ensurePreview(hover, config, google.find((g) => g.family === hover)?.weights.filter((w) => w === 400 || w === 700));
  }, [hover, config, google]);

  const ql = query.trim().toLowerCase();
  const libFonts = useMemo(() => {
    const fromCfg = config.fonts.filter((f) => f.source !== 'SYSTEM').map((f) => ({ family: f.family, source: f.source, weights: f.weights }));
    const extra = library.filter((l) => l.source !== 'SYSTEM' && !fromCfg.some((f) => f.family === l.family)).map((l) => ({ family: l.family, source: l.source, weights: l.weights }));
    return [...fromCfg, ...extra].filter((f) => !ql || f.family.toLowerCase().includes(ql));
  }, [config.fonts, library, ql]);
  const sysFonts = system.filter((f) => !ql || f.family.toLowerCase().includes(ql));
  const gFonts = google.filter((g) => !libFonts.some((l) => l.family === g.family));

  const pick = (family: string, asset: FontAsset | null) => {
    onChange(family, asset);
    setOpen(false);
    setQuery('');
  };
  const assetFor = (family: string) => config.fonts.find((f) => f.family === family);
  const asset = value ? assetFor(value) : undefined;
  const avail = (() => {
    if (!asset) return [];
    if (asset.source === 'UPLOAD') return [...new Set((asset.files ?? []).map((f) => f.weight))];
    if (asset.source === 'SYSTEM') return [400, 700];
    return google.find((g) => g.family === value)?.weights ?? library.find((l) => l.family === value)?.weights ?? ALL_WEIGHTS;
  })();

  return (
    <div className={`ap-fontpicker ${compact ? 'compact' : ''}`} ref={box}>
      <button type="button" className="input ap-fp-btn" disabled={disabled} onClick={() => setOpen((o) => !o)} style={{ fontFamily: value ? `${cssFamily(value)}, sans-serif` : undefined }}>
        <span>{value || <span className="muted">{emptyLabel}</span>}</span>
        {asset && <span className="badge">{asset.source}</span>}
        <span className="muted">▾</span>
      </button>
      {!compact && value && (
        <div className="ap-fp-preview" style={{ fontFamily: `${cssFamily(value)}, sans-serif` }}>
          {previewText}
        </div>
      )}
      {showWeights && !compact && asset && asset.source === 'GOOGLE' && avail.length > 1 && (
        onWeights ? <FontWeightsEditor available={avail} value={asset.weights} onChange={onWeights} disabled={disabled} /> : <WeightChips available={avail} value={asset.weights} />
      )}
      {open && (
        <div className="ap-fp-pop card">
          <div className="row" style={{ gap: 6 }}>
            <input className="input" autoFocus placeholder="ค้นหาฟอนต์…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
            <select className="input" style={{ width: 110 }} value={subset} onChange={(e) => setSubset(e.target.value)}>
              {SUBSETS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ap-fp-preview big" style={{ fontFamily: hover || value ? `${cssFamily(hover || value)}, sans-serif` : undefined }}>
            {previewText}
          </div>
          <div className="ap-fp-list">
            {allowEmpty && (
              <div className="ap-fp-item" onClick={() => pick('', null)}>
                <span className="muted">{emptyLabel}</span>
              </div>
            )}
            {libFonts.length > 0 && <div className="ap-fp-sec">Font Library</div>}
            {libFonts.map((f) => (
              <div key={'l' + f.family} className={`ap-fp-item ${f.family === value ? 'active' : ''}`} onMouseEnter={() => setHover(f.family)} onClick={() => pick(f.family, assetFor(f.family) ?? { family: f.family, source: f.source, weights: f.weights })}>
                <span style={{ fontFamily: `${cssFamily(f.family)}, sans-serif` }}>{f.family}</span>
                <span className="badge">{f.source === 'UPLOAD' ? 'Uploaded' : 'Google'}</span>
              </div>
            ))}
            {gFonts.length > 0 && <div className="ap-fp-sec">Google Fonts {googleSource === 'builtin' ? '(รายการแนะนำ)' : ''}</div>}
            {gFonts.map((g) => (
              <div
                key={'g' + g.family}
                className={`ap-fp-item ${g.family === value ? 'active' : ''}`}
                onMouseEnter={() => setHover(g.family)}
                onClick={() => pick(g.family, { family: g.family, source: 'GOOGLE', weights: g.weights.filter((w) => [400, 500, 600, 700].includes(w)).length ? g.weights.filter((w) => [400, 500, 600, 700].includes(w)) : g.weights.slice(0, 2) })}
              >
                <span>{g.family}</span>
                <span className="small muted">
                  {g.category} · {g.subsets.filter((s) => ['thai', 'latin', 'chinese-simplified', 'chinese-traditional'].includes(s)).join(', ')}
                </span>
              </div>
            ))}
            {sysFonts.length > 0 && <div className="ap-fp-sec">System Fonts</div>}
            {sysFonts.map((f) => (
              <div key={'s' + f.family} className={`ap-fp-item ${f.family === value ? 'active' : ''}`} onMouseEnter={() => setHover(f.family)} onClick={() => pick(f.family, { family: f.family, source: 'SYSTEM', weights: [400, 700] })}>
                <span style={{ fontFamily: cssFamily(f.family) }}>{f.family}</span>
                <span className="small muted">{f.note}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Read-only display of the loaded weights; editing happens through FontWeightsEditor. */
function WeightChips({ available, value }: { available: number[]; value: number[] }) {
  return (
    <div className="ap-weights small muted">
      Weights:{' '}
      {available.map((w) => (
        <span key={w} className={`ap-wchip ${value.includes(w) ? 'on' : ''}`} title={WEIGHT_NAMES[w]}>
          {w}
        </span>
      ))}
    </div>
  );
}

/** Choose which weights of a Google font are loaded by clients. */
export function FontWeightsEditor({ available, value, onChange, disabled }: { available: number[]; value: number[]; onChange: (w: number[]) => void; disabled?: boolean }) {
  return (
    <div className="ap-weights">
      {available.map((w) => (
        <label key={w} className={`ap-wchip ${value.includes(w) ? 'on' : ''}`} title={WEIGHT_NAMES[w]}>
          <input
            type="checkbox"
            hidden
            disabled={disabled}
            checked={value.includes(w)}
            onChange={(e) => {
              const next = e.target.checked ? [...value, w] : value.filter((x) => x !== w);
              if (next.length) onChange(next.sort((a, b) => a - b));
            }}
          />
          {w} {WEIGHT_NAMES[w]}
        </label>
      ))}
    </div>
  );
}

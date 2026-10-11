/**
 * "Edit Typography – <element>" side panel. Each property shows where its
 * value is inherited from and a mode: Use Global / Use System / Custom / Reset.
 */
import type { ReactNode } from 'react';
import {
  resolveTypography,
  setTypography,
  splitPath,
  type DesignConfig,
  type ElementDef,
  type Level,
  type Scope,
  type TypographyProp,
  type TypographyStyle,
} from '@pp/shared/design/index';
import { FontPicker, withFontAsset } from './FontPicker';

export type ScopeLevel = 'element' | 'component' | 'page' | 'system' | 'global';
export const SCOPE_LABEL: Record<ScopeLevel, string> = { element: 'Element', component: 'Component', page: 'Page', system: 'System', global: 'Global' };
const SCOPE_TO_LEVEL: Record<ScopeLevel, Level> = { element: 'Element', component: 'Component', page: 'Page', system: 'System', global: 'Global' };

export function scopeFor(el: ElementDef, level: ScopeLevel): Scope {
  const p = splitPath(el.path);
  switch (level) {
    case 'global':
      return { level: 'global' };
    case 'system':
      return { level: 'system', system: p.system };
    case 'page':
      return { level: 'page', key: p.pageKey };
    case 'component':
      return { level: 'component', key: p.componentKey };
    default:
      return { level: 'element', path: el.path };
  }
}

/** Value stored at exactly this scope (undefined = inherits). */
export function valueAt(cfg: DesignConfig, el: ElementDef, level: ScopeLevel, prop: TypographyProp): unknown {
  const p = splitPath(el.path);
  const src =
    level === 'global' ? cfg.global.text : level === 'system' ? cfg.systems[p.system]?.text : level === 'page' ? cfg.pages[p.pageKey]?.text : level === 'component' ? cfg.components[p.componentKey]?.text : cfg.elements[el.path];
  const v = src?.[prop];
  return v === '' || v === null ? undefined : v;
}

const ORDER: ScopeLevel[] = ['global', 'system', 'page', 'component', 'element'];

/** Clear a property on this element's chain from `from` down to Element. */
function clearChain(cfg: DesignConfig, el: ElementDef, from: ScopeLevel, prop: TypographyProp): DesignConfig {
  let next = cfg;
  for (const lvl of ORDER.slice(ORDER.indexOf(from))) {
    if (valueAt(next, el, lvl, prop) !== undefined) next = setTypography(next, scopeFor(el, lvl), { [prop]: undefined } as Partial<TypographyStyle>);
  }
  return next;
}

type Mode = 'global' | 'system' | 'custom' | 'reset';

const PROPS: Array<{ prop: TypographyProp; label: string }> = [
  { prop: 'fontFamily', label: 'Font Family' },
  { prop: 'fontSize', label: 'Size (px)' },
  { prop: 'fontWeight', label: 'Weight' },
  { prop: 'fontStyle', label: 'Style' },
  { prop: 'lineHeight', label: 'Line Height' },
  { prop: 'letterSpacing', label: 'Letter Spacing (px)' },
  { prop: 'textAlign', label: 'Alignment' },
  { prop: 'textTransform', label: 'Transform' },
  { prop: 'textDecoration', label: 'Decoration' },
  { prop: 'color', label: 'Color' },
];

const OPTIONS: Partial<Record<TypographyProp, Array<[string, string]>>> = {
  fontWeight: [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => [String(w), String(w)]),
  fontStyle: [
    ['normal', 'Normal'],
    ['italic', 'Italic'],
  ],
  textAlign: [
    ['inherit', 'Inherit'],
    ['left', 'Left'],
    ['center', 'Center'],
    ['right', 'Right'],
    ['justify', 'Justify'],
  ],
  textTransform: [
    ['none', 'None'],
    ['uppercase', 'UPPERCASE'],
    ['lowercase', 'lowercase'],
    ['capitalize', 'Capitalize'],
  ],
  textDecoration: [
    ['none', 'None'],
    ['underline', 'Underline'],
    ['line-through', 'Line-through'],
  ],
};

export function TypographyPanel({
  el,
  config,
  scope,
  onScope,
  onChange,
  disabled,
  header,
}: {
  el: ElementDef;
  config: DesignConfig;
  scope: ScopeLevel;
  onScope: (s: ScopeLevel) => void;
  onChange: (cfg: DesignConfig) => void;
  disabled?: boolean;
  header?: ReactNode;
}) {
  const { style, source } = resolveTypography(config, el);
  const p = splitPath(el.path);
  const scopeName: Record<ScopeLevel, string> = {
    element: el.label,
    component: p.componentKey,
    page: p.pageKey,
    system: p.system,
    global: 'ทุกระบบ',
  };

  const setProp = (prop: TypographyProp, value: unknown, base = config) => onChange(setTypography(base, scopeFor(el, scope), { [prop]: value } as Partial<TypographyStyle>));
  const modeOf = (prop: TypographyProp): Mode => {
    if (valueAt(config, el, scope, prop) !== undefined) return 'custom';
    return source[prop] === 'Global' || source[prop] === 'Default' ? 'global' : 'system';
  };
  const setMode = (prop: TypographyProp, m: Mode) => {
    if (m === 'custom') return setProp(prop, style[prop]);
    if (m === 'reset') return setProp(prop, undefined);
    if (m === 'global') return onChange(clearChain(config, el, 'system', prop));
    onChange(clearChain(config, el, 'page', prop));
  };

  const input = (prop: TypographyProp) => {
    const v = style[prop];
    const dis = disabled;
    if (prop === 'fontFamily')
      return (
        <FontPicker
          compact
          config={config}
          value={String(v ?? '')}
          disabled={dis}
          onChange={(family, asset) => setProp('fontFamily', family || undefined, withFontAsset(config, asset))}
        />
      );
    if (prop === 'color')
      return (
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <input type="color" className="ap-color" disabled={dis} value={/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : '#000000'} onChange={(e) => setProp('color', e.target.value)} />
          <input className="input" disabled={dis} value={String(v ?? '')} placeholder="inherit" onChange={(e) => setProp('color', e.target.value || undefined)} />
        </div>
      );
    const opts = OPTIONS[prop];
    if (opts)
      return (
        <select className="input" disabled={dis} value={String(v)} onChange={(e) => setProp(prop, prop === 'fontWeight' ? Number(e.target.value) : e.target.value)}>
          {opts.map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
      );
    const step = prop === 'lineHeight' ? 0.05 : prop === 'letterSpacing' ? 0.5 : 1;
    return (
      <input
        className="input"
        type="number"
        step={step}
        disabled={dis}
        value={Number(v)}
        onChange={(e) => e.target.value !== '' && setProp(prop, Number(e.target.value))}
      />
    );
  };

  return (
    <div className="ap-panel col">
      <div className="card-title" style={{ marginBottom: 0 }}>
        Edit Typography – {el.label}
      </div>
      <div className="small muted mono">{el.path}</div>
      {header}
      <div className="field">
        <label>ขอบเขตการแก้ไข (Scope)</label>
        <div className="pill-tabs ap-scope">
          {(['element', 'component', 'page', 'system', 'global'] as ScopeLevel[]).map((s) => (
            <button key={s} type="button" className={scope === s ? 'active' : ''} onClick={() => onScope(s)}>
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
        <span className="hint">
          แก้ไขที่ระดับ <b>{SCOPE_LABEL[scope]}</b>: {scopeName[scope]}
        </span>
      </div>
      {PROPS.map(({ prop, label }) => {
        const mode = modeOf(prop);
        const src = source[prop];
        const here = src === SCOPE_TO_LEVEL[scope];
        return (
          <div key={prop} className={`ap-prop ${mode === 'custom' ? 'custom' : ''}`}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
              <label className="field-label">{label}</label>
              <span className={`ap-src ${here ? 'here' : ''}`}>Inherited from: {src}</span>
            </div>
            <div className="ap-prop-row">
              <div style={{ flex: 1, minWidth: 0 }}>{input(prop)}</div>
              <select className="input ap-mode" disabled={disabled} value={mode} onChange={(e) => setMode(prop, e.target.value as Mode)}>
                <option value="global">Use Global Setting</option>
                <option value="system">Use System Setting</option>
                <option value="custom">Custom</option>
                <option value="reset">Reset to Default</option>
              </select>
            </div>
          </div>
        );
      })}
      <div className="small muted">
        Use Global Setting = ล้างค่าที่ตั้งไว้ระดับ System/Page/Component/Element ของ element นี้ · Use System Setting = ล้างระดับ Page/Component/Element · Reset to Default = ล้างค่าเฉพาะระดับที่กำลังแก้ไข
      </div>
    </div>
  );
}

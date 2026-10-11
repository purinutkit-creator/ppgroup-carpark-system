import {
  BASE_TYPOGRAPHY,
  DARK_TOKENS,
  DEFAULT_DESIGN,
  TYPOGRAPHY_PROPS,
  type DesignConfig,
  type DesignTokens,
  type FontRole,
  type LevelOverride,
  type SystemId,
  type TypographyProp,
  type TypographyStyle,
} from './model.ts';

export interface ElementDef {
  path: string;           // system/page/component/element
  label: string;
  role: FontRole;
  defaults?: Partial<TypographyStyle>;
  sample?: string;
}

export type Level = 'Default' | 'Global' | 'System' | 'Page' | 'Component' | 'Element';

export interface ResolvedTypography {
  style: TypographyStyle;
  source: Record<TypographyProp, Level>;
}

export function splitPath(path: string) {
  const [system, page, component, element] = path.split('/');
  return {
    system: system as SystemId,
    pageKey: `${system}/${page}`,
    componentKey: `${system}/${page}/${component}`,
    element,
  };
}

/** Deep-ish merge of a stored config onto defaults so new keys always exist. */
export function normalizeDesign(input?: Partial<DesignConfig> | null): DesignConfig {
  const d = structuredClone(DEFAULT_DESIGN);
  if (!input) return d;
  return {
    global: {
      ...d.global,
      ...(input.global ?? {}),
      fonts: { ...d.global.fonts, ...(input.global?.fonts ?? {}) },
      languageFonts: { ...d.global.languageFonts, ...(input.global?.languageFonts ?? {}) },
      tokens: { ...d.global.tokens, ...(input.global?.tokens ?? {}) },
    },
    systems: input.systems ?? {},
    pages: input.pages ?? {},
    components: input.components ?? {},
    elements: input.elements ?? {},
    fonts: input.fonts ?? d.fonts,
  };
}

export function resolveFonts(cfg: DesignConfig, system: SystemId): Record<FontRole, string> {
  return { ...cfg.global.fonts, ...(cfg.systems[system]?.fonts ?? {}) } as Record<FontRole, string>;
}

export function resolveTokens(cfg: DesignConfig, system: SystemId): DesignTokens {
  const sys = cfg.systems[system]?.tokens ?? {};
  const merged = { ...cfg.global.tokens, ...sys } as DesignTokens;
  if (merged.theme === 'dark' && cfg.global.tokens.theme !== 'dark' && !sys.background) {
    return { ...merged, ...DARK_TOKENS, ...sys } as DesignTokens;
  }
  return merged;
}

export function resolveTypography(cfg: DesignConfig, el: ElementDef): ResolvedTypography {
  const { system, pageKey, componentKey } = splitPath(el.path);
  const style: TypographyStyle = { ...BASE_TYPOGRAPHY, ...(el.defaults ?? {}) };
  const source = Object.fromEntries(TYPOGRAPHY_PROPS.map((p) => [p, 'Default'])) as Record<TypographyProp, Level>;
  const apply = (o: Partial<TypographyStyle> | undefined, lvl: Level) => {
    if (!o) return;
    for (const p of TYPOGRAPHY_PROPS) {
      const v = o[p];
      if (v !== undefined && v !== '' && v !== null) {
        (style as unknown as Record<string, unknown>)[p] = v;
        source[p] = lvl;
      }
    }
  };
  // font family from role
  style.fontFamily = cfg.global.fonts[el.role];
  source.fontFamily = 'Global';
  apply(cfg.global.text, 'Global');
  const sys: LevelOverride | undefined = cfg.systems[system];
  if (sys?.fonts?.[el.role]) {
    style.fontFamily = sys.fonts[el.role]!;
    source.fontFamily = 'System';
  }
  apply(sys?.text, 'System');
  apply(cfg.pages[pageKey]?.text, 'Page');
  apply(cfg.components[componentKey]?.text, 'Component');
  apply(cfg.elements[el.path], 'Element');
  return { style, source };
}

const quote = (f: string) => (/^[\w-]+$/.test(f) && !/\s/.test(f) ? f : `"${f.replace(/"/g, '')}"`);

/** CSS font-family stack with per-language fonts and fallback. */
export function fontStack(cfg: DesignConfig, family: string): string {
  const parts: string[] = [];
  if (family) parts.push(quote(family));
  const lf = cfg.global.languageFonts;
  if (lf.enabled) {
    // Order matters: a Latin-only font first so Thai/CJK glyphs fall through.
    for (const f of [lf.en, lf.th, lf.zh]) if (f && !parts.includes(quote(f))) parts.push(quote(f));
  }
  parts.push(cfg.global.fallback || 'sans-serif');
  return parts.join(', ');
}

const SHADOWS: Record<DesignTokens['shadow'], string> = {
  none: 'none',
  sm: '0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.08)',
  md: '0 4px 12px rgba(15,23,42,.10)',
  lg: '0 12px 32px rgba(15,23,42,.16)',
};

export function tokensToCssVars(t: DesignTokens, fonts: Record<FontRole, string>, cfg: DesignConfig): string {
  const v: Record<string, string> = {
    '--color-primary': t.primary,
    '--color-secondary': t.secondary,
    '--color-accent': t.accent,
    '--color-bg': t.background,
    '--color-surface': t.surface,
    '--color-text': t.text,
    '--color-muted': t.textMuted,
    '--color-btn': t.buttonBg,
    '--color-btn-text': t.buttonText,
    '--color-border': t.border,
    '--color-success': t.success,
    '--color-warning': t.warning,
    '--color-danger': t.danger,
    '--radius': `${t.radius}px`,
    '--border-width': `${t.borderWidth}px`,
    '--shadow': SHADOWS[t.shadow] ?? SHADOWS.sm,
    '--space': `${t.spacing}px`,
    '--bg-image': t.backgroundImage ? `url("${t.backgroundImage}")` : 'none',
  };
  for (const [role, fam] of Object.entries(fonts)) v[`--font-${role}`] = fontStack(cfg, fam);
  return Object.entries(v)
    .map(([k, val]) => `${k}:${val};`)
    .join('');
}

function styleToCss(s: TypographyStyle, cfg: DesignConfig): string {
  const out = [
    `font-family:${fontStack(cfg, s.fontFamily)}`,
    `font-size:${s.fontSize}px`,
    `font-weight:${s.fontWeight}`,
    `font-style:${s.fontStyle}`,
    `line-height:${s.lineHeight}`,
    `letter-spacing:${s.letterSpacing}px`,
    `text-transform:${s.textTransform}`,
    `text-decoration:${s.textDecoration}`,
  ];
  if (s.textAlign !== 'inherit') out.push(`text-align:${s.textAlign}`);
  if (s.color) out.push(`color:${s.color}`);
  return out.join(';');
}

/**
 * Build the stylesheet for one system: CSS variables on [data-system] plus a
 * rule per registered element ([data-el="path"]).
 */
export function buildSystemCss(cfg: DesignConfig, system: SystemId, elements: ElementDef[]): string {
  const tokens = resolveTokens(cfg, system);
  const fonts = resolveFonts(cfg, system);
  const sel = `[data-system="${system}"]`;
  let css = `${sel}{${tokensToCssVars(tokens, fonts, cfg)}}\n`;
  const sysText = cfg.systems[system]?.text;
  if (sysText?.fontSize) css += `${sel}{font-size:${sysText.fontSize}px}\n`;
  for (const el of elements.filter((e) => e.path.startsWith(system + '/'))) {
    const { style } = resolveTypography(cfg, el);
    css += `${sel} [data-el="${el.path}"]{${styleToCss(style, cfg)}}\n`;
  }
  return css;
}

export function usedFamilies(cfg: DesignConfig): string[] {
  const set = new Set<string>();
  const add = (f?: string) => f && set.add(f);
  Object.values(cfg.global.fonts).forEach(add);
  if (cfg.global.languageFonts.enabled) [cfg.global.languageFonts.th, cfg.global.languageFonts.en, cfg.global.languageFonts.zh].forEach(add);
  add(cfg.global.text?.fontFamily);
  for (const lvl of [...Object.values(cfg.systems), ...Object.values(cfg.pages), ...Object.values(cfg.components)]) {
    if (!lvl) continue;
    Object.values(lvl.fonts ?? {}).forEach(add);
    add(lvl.text?.fontFamily);
  }
  Object.values(cfg.elements).forEach((e) => add(e.fontFamily));
  return [...set];
}

/** Google Fonts CSS2 URL for families that are not uploaded/system fonts. */
export function googleFontsUrl(cfg: DesignConfig): string | null {
  const nonGoogle = new Set(cfg.fonts.filter((f) => f.source !== 'GOOGLE').map((f) => f.family));
  const fams = usedFamilies(cfg).filter((f) => !nonGoogle.has(f) && !/system-ui|sans-serif|serif|monospace|Tahoma|Arial/i.test(f));
  if (!fams.length) return null;
  const q = fams
    .map((f) => {
      const asset = cfg.fonts.find((a) => a.family === f);
      const w = (asset?.weights?.length ? asset.weights : [400, 500, 600, 700]).slice().sort((a, b) => a - b);
      return `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@${w.join(';')}`;
    })
    .join('&');
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

export function uploadedFontFaces(cfg: DesignConfig): string {
  return cfg.fonts
    .filter((f) => f.source === 'UPLOAD')
    .flatMap((f) =>
      (f.files ?? []).map(
        (file) =>
          `@font-face{font-family:"${f.family}";src:url("${file.url}") format("${file.format}");font-weight:${file.weight};font-style:${file.style};font-display:swap}`,
      ),
    )
    .join('\n');
}

// ---- mutations used by the editor / server ---------------------------------

export type Scope =
  | { level: 'global' }
  | { level: 'system'; system: SystemId }
  | { level: 'page'; key: string }
  | { level: 'component'; key: string }
  | { level: 'element'; path: string };

/** Set (or clear with undefined) typography props at a scope. */
export function setTypography(cfg: DesignConfig, scope: Scope, patch: Partial<TypographyStyle>): DesignConfig {
  const next = structuredClone(cfg);
  const merge = (o: Partial<TypographyStyle> = {}) => {
    const r: Partial<TypographyStyle> = { ...o };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') delete (r as Record<string, unknown>)[k];
      else (r as Record<string, unknown>)[k] = v;
    }
    return r;
  };
  switch (scope.level) {
    case 'global':
      next.global.text = merge(next.global.text);
      break;
    case 'system':
      next.systems[scope.system] = { ...(next.systems[scope.system] ?? {}), text: merge(next.systems[scope.system]?.text) };
      break;
    case 'page':
      next.pages[scope.key] = { ...(next.pages[scope.key] ?? {}), text: merge(next.pages[scope.key]?.text) };
      break;
    case 'component':
      next.components[scope.key] = { ...(next.components[scope.key] ?? {}), text: merge(next.components[scope.key]?.text) };
      break;
    case 'element': {
      const m = merge(next.elements[scope.path]);
      if (Object.keys(m).length) next.elements[scope.path] = m;
      else delete next.elements[scope.path];
      break;
    }
  }
  return next;
}

/**
 * Apply a font role / token patch to several systems at once ("Apply To…").
 * When every system is targeted the value is written to Global and the
 * per-system overrides for those keys are cleared ("Apply to All").
 */
export function applyToSystems(
  cfg: DesignConfig,
  systems: SystemId[],
  patch: { fonts?: Partial<Record<FontRole, string>>; tokens?: Partial<DesignTokens>; text?: Partial<TypographyStyle> },
  allSystems: SystemId[],
): DesignConfig {
  const next = structuredClone(cfg);
  const everything = allSystems.every((s) => systems.includes(s));
  if (everything) {
    if (patch.fonts) next.global.fonts = { ...next.global.fonts, ...(patch.fonts as Record<FontRole, string>) };
    if (patch.tokens) next.global.tokens = { ...next.global.tokens, ...patch.tokens };
    if (patch.text) next.global.text = { ...(next.global.text ?? {}), ...patch.text };
    for (const s of allSystems) {
      const o = next.systems[s];
      if (!o) continue;
      for (const k of Object.keys(patch.fonts ?? {})) delete (o.fonts as Record<string, unknown> | undefined)?.[k];
      for (const k of Object.keys(patch.tokens ?? {})) delete (o.tokens as Record<string, unknown> | undefined)?.[k];
      for (const k of Object.keys(patch.text ?? {})) delete (o.text as Record<string, unknown> | undefined)?.[k];
    }
    return next;
  }
  for (const s of systems) {
    const o = (next.systems[s] = next.systems[s] ?? {});
    if (patch.fonts) o.fonts = { ...(o.fonts ?? {}), ...patch.fonts };
    if (patch.tokens) o.tokens = { ...(o.tokens ?? {}), ...patch.tokens };
    if (patch.text) o.text = { ...(o.text ?? {}), ...patch.text };
  }
  return next;
}

/** Which systems differ between two configs (used to target realtime pushes). */
export function changedSystems(a: DesignConfig, b: DesignConfig, all: SystemId[]): SystemId[] {
  const g = JSON.stringify(a.global) !== JSON.stringify(b.global) || JSON.stringify(a.fonts) !== JSON.stringify(b.fonts);
  if (g) return all;
  return all.filter((s) => {
    const pick = (c: DesignConfig) =>
      JSON.stringify([
        c.systems[s],
        Object.entries(c.pages).filter(([k]) => k.startsWith(s + '/')),
        Object.entries(c.components).filter(([k]) => k.startsWith(s + '/')),
        Object.entries(c.elements).filter(([k]) => k.startsWith(s + '/')),
      ]);
    return pick(a) !== pick(b);
  });
}

/**
 * Font catalogue + preview loading for the Appearance editor.
 */
import { useEffect, useState } from 'react';
import type { DesignConfig, FontAsset } from '@pp/shared/design/index';
import { get, qs } from '../../lib/api';

export interface CatalogFont {
  family: string;
  category: string;
  subsets: string[];
  weights: number[];
}

export interface LibraryFont {
  id: number | null;
  family: string;
  source: 'GOOGLE' | 'UPLOAD' | 'SYSTEM';
  weights: number[];
  files: NonNullable<FontAsset['files']>;
  licenseName: string | null;
  licenseNote: string | null;
  licenseConfirmedBy: string | null;
  licenseConfirmedAt: string | null;
  createdBy: string | null;
  createdAt: string | null;
  inConfig: boolean;
  inUse: boolean;
}

export interface SystemFont {
  family: string;
  note: string;
}

export const PREVIEW_TEXT = 'SMART PARKING กข 1234 กรุงเทพมหานคร ฿120.00 智能停车';
export const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
export const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
};

const GENERIC = /^(system-ui|-apple-system|sans-serif|serif|monospace|cursive|fantasy)$/i;
export const cssFamily = (f: string) => (GENERIC.test(f) ? f : `"${f.replace(/"/g, '')}"`);

/** Load a Google font (for previews only) without touching the published font link. */
export function ensureGoogleFont(family: string, weights: number[] = [400, 700]) {
  if (!family || GENERIC.test(family)) return;
  const id = `ap-gf-${family.replace(/[^a-z0-9]/gi, '-')}-${weights.join('-')}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${[...weights].sort((a, b) => a - b).join(';')}&display=swap`;
  document.head.appendChild(link);
}

/** Make sure an uploaded font's faces are registered (FontFace API). */
export function ensureUploadedFont(asset: FontAsset) {
  if (!('fonts' in document)) return;
  for (const f of asset.files ?? []) {
    const key = `${asset.family}|${f.url}`;
    if (loadedFaces.has(key)) continue;
    loadedFaces.add(key);
    const face = new FontFace(asset.family, `url("${f.url}") format("${f.format}")`, { weight: String(f.weight), style: f.style });
    face.load().then((ff) => document.fonts.add(ff)).catch(() => loadedFaces.delete(key));
  }
}
const loadedFaces = new Set<string>();

/** Load whatever is needed to preview `family` given the draft config. */
export function ensurePreview(family: string, cfg: DesignConfig | null, weights?: number[]) {
  const asset = cfg?.fonts.find((f) => f.family === family);
  if (asset?.source === 'UPLOAD') return ensureUploadedFont(asset);
  if (asset?.source === 'SYSTEM') return;
  ensureGoogleFont(family, weights ?? asset?.weights ?? [400, 700]);
}

// ---- data hooks (cached per page load) --------------------------------------

let libraryP: Promise<LibraryFont[]> | null = null;
let systemP: Promise<SystemFont[]> | null = null;
const googleCache = new Map<string, Promise<{ items: CatalogFont[]; source: 'api' | 'builtin' }>>();

export function invalidateLibrary() {
  libraryP = null;
}

export function useFontSources(query: string, subset = '') {
  const [library, setLibrary] = useState<LibraryFont[]>([]);
  const [system, setSystem] = useState<SystemFont[]>([]);
  const [google, setGoogle] = useState<CatalogFont[]>([]);
  const [googleSource, setGoogleSource] = useState<'api' | 'builtin' | null>(null);
  useEffect(() => {
    libraryP ??= get<{ items: LibraryFont[] }>('/api/appearance/fonts').then((r) => r.items);
    systemP ??= get<{ items: SystemFont[] }>('/api/appearance/system-fonts').then((r) => r.items);
    libraryP.then(setLibrary).catch(() => (libraryP = null));
    systemP.then(setSystem).catch(() => (systemP = null));
  }, []);
  useEffect(() => {
    let alive = true;
    const key = `${query}|${subset}`;
    const t = setTimeout(() => {
      if (!googleCache.has(key)) googleCache.set(key, get<{ items: CatalogFont[]; source: 'api' | 'builtin' }>(`/api/appearance/google-fonts${qs({ q: query, subset, limit: 80 })}`));
      googleCache
        .get(key)!
        .then((r) => {
          if (!alive) return;
          setGoogle(r.items);
          setGoogleSource(r.source);
        })
        .catch(() => {
          googleCache.delete(key);
          if (alive) setGoogle([]);
        });
    }, googleCache.has(key) ? 0 : 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, subset]);
  return { library, system, google, googleSource };
}

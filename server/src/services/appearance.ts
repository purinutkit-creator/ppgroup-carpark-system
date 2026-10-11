/**
 * Centralized design configuration: publish (version + realtime push + audit),
 * diffing, permission rules for "Apply To…" and the Google Fonts catalogue.
 */
import type { Request } from 'express';
import { changedSystems, normalizeDesign, SYSTEMS, usedFamilies, type DesignConfig, type SystemId } from '@pp/shared';
import { q, json } from '../db/index.ts';
import { getSetting, saveSetting } from '../lib/settings.ts';
import { emit } from '../lib/realtime.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, forbidden } from '../lib/http.ts';
import { can } from '../auth/middleware.ts';

export const ALL_SYSTEMS: SystemId[] = SYSTEMS.map((s) => s.id);

export function parseSystems(v: unknown): SystemId[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw badRequest('VALIDATION', 'systems must be an array');
  const bad = v.filter((s) => !ALL_SYSTEMS.includes(s as SystemId));
  if (bad.length) throw badRequest('VALIDATION', `unknown systems: ${bad.join(', ')}`);
  return [...new Set(v as SystemId[])];
}

export interface VersionInfo {
  id: number | null;
  versionNo: number;
  createdAt: string | null;
  createdBy: string | null;
}

export function currentVersion(): VersionInfo {
  const r = q.get(
    `SELECT v.id, v.version_no, v.created_at, u.display_name FROM config_versions v LEFT JOIN users u ON u.id=v.created_by
      WHERE v.module='design' ORDER BY v.id DESC LIMIT 1`,
  );
  return r ? { id: r.id, versionNo: r.version_no, createdAt: r.created_at, createdBy: r.display_name ?? null } : { id: null, versionNo: 0, createdAt: null, createdBy: null };
}

// ---- diff -----------------------------------------------------------------

export interface Change {
  path: string;
  before: unknown;
  after: unknown;
}

/** Leaf-level differences between two JSON values ("global.fonts.primary"). */
export function diffPaths(a: unknown, b: unknown, base = ''): Change[] {
  const isObj = (x: unknown) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (isObj(a) && isObj(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort();
    return keys.flatMap((k) => diffPaths(ao[k], bo[k], base ? `${base}.${k}` : k));
  }
  if (isObj(a) && b === undefined) return diffPaths(a, {}, base);
  if (a === undefined && isObj(b)) return diffPaths({}, b, base);
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ path: base, before: a, after: b }];
}

/** Changes that touch Global (fonts, tokens, language fonts, global text, font library). */
const touchesGlobal = (changes: Change[]) => changes.some((c) => c.path.startsWith('global.'));

// ---- permissions ----------------------------------------------------------

/**
 * Publishing needs configuration.apply; publishing to every system or
 * changing Global needs configuration.apply_all.
 */
export function assertApplyAllowed(req: Request, appliedTo: SystemId[] | undefined, changes: Change[]) {
  const all = !appliedTo || ALL_SYSTEMS.every((s) => appliedTo.includes(s));
  if ((all || touchesGlobal(changes)) && changes.length) {
    if (!can(req, 'configuration.apply_all')) throw forbidden('FORBIDDEN', 'requires configuration.apply_all');
  } else if (!can(req, 'configuration.apply') && !can(req, 'configuration.apply_all')) {
    throw forbidden('FORBIDDEN', 'requires configuration.apply');
  }
}

// ---- publish --------------------------------------------------------------

export interface PublishOptions {
  appliedTo?: SystemId[];
  note?: string | null;
  rolledBackFrom?: number;
  action?: string;
  /** Override which systems receive the realtime push (default: changed ∩ appliedTo). */
  broadcastTo?: SystemId[];
  meta?: Record<string, unknown>;
}

const summarize = (changes: Change[]) => changes.slice(0, 200).map((c) => ({ path: c.path, before: c.before, after: c.after }));

export function publishDesign(req: Request, input: Partial<DesignConfig>, opts: PublishOptions = {}) {
  const prev = getSetting('design');
  const next = normalizeDesign(input);
  const changes = diffPaths(prev, next);
  const row = saveSetting('design', next, {
    userId: req.user?.id ?? null,
    appliedTo: opts.appliedTo ?? ALL_SYSTEMS,
    note: opts.note ?? undefined,
    rolledBackFrom: opts.rolledBackFrom,
  }) as { id: number; version_no: number; created_at: string };
  const changed = changedSystems(prev, next, ALL_SYSTEMS);
  // A Global change affects every system even when the editor targeted one, so push it to all changed systems.
  const scoped = opts.appliedTo && !touchesGlobal(changes) ? changed.filter((s) => opts.appliedTo!.includes(s)) : changed;
  const targets = opts.broadcastTo ?? scoped;
  for (const s of targets) emit.config(s, 'design:updated', { versionId: row.id, versionNo: row.version_no });
  audit(req, {
    action: opts.action ?? 'appearance.apply',
    entityType: 'config_version',
    entityId: row.id,
    before: { versionNo: row.version_no - 1, changes: summarize(changes).map((c) => ({ path: c.path, value: c.before })) },
    after: { versionNo: row.version_no, changes: summarize(changes).map((c) => ({ path: c.path, value: c.after })) },
    reason: opts.note ?? null,
    meta: { appliedTo: opts.appliedTo ?? ALL_SYSTEMS, broadcastTo: targets, changedCount: changes.length, rolledBackFrom: opts.rolledBackFrom ?? null, ...(opts.meta ?? {}) },
  });
  return {
    version: { id: row.id, versionNo: row.version_no, createdAt: row.created_at, createdBy: req.user?.displayName ?? null },
    changedSystems: targets,
    changes: changes.length,
    config: next,
  };
}

/** Families referenced anywhere in the config (fonts, language fonts, all text levels). */
export function familiesInUse(cfg: DesignConfig = getSetting('design')): Set<string> {
  return new Set(usedFamilies(cfg));
}

// ---- versions -------------------------------------------------------------

export function listVersions(limit: number, offset: number) {
  const rows = q.all(
    `SELECT v.id, v.version_no, v.applied_to, v.note, v.rolled_back_from, v.created_at, u.display_name created_by_name,
            (SELECT COUNT(*) FROM config_deliveries d WHERE d.version_id=v.id) deliveries,
            (SELECT version_no FROM config_versions r WHERE r.id=v.rolled_back_from) rolled_back_from_no
       FROM config_versions v LEFT JOIN users u ON u.id=v.created_by
      WHERE v.module='design' ORDER BY v.id DESC LIMIT ? OFFSET ?`,
    limit,
    offset,
  );
  const total = q.get<{ n: number }>("SELECT COUNT(*) n FROM config_versions WHERE module='design'")!.n;
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      versionNo: r.version_no,
      label: `Design Configuration v${r.version_no}`,
      createdBy: r.created_by_name ?? null,
      createdAt: r.created_at,
      appliedTo: json<string[] | null>(r.applied_to, null),
      note: r.note,
      rolledBackFrom: r.rolled_back_from ?? null,
      rolledBackFromNo: r.rolled_back_from_no ?? null,
      deliveries: r.deliveries,
    })),
  };
}

export function versionRow(id: number) {
  return q.get("SELECT * FROM config_versions WHERE id=? AND module='design'", id);
}

// ---- Google Fonts catalogue -----------------------------------------------

export interface CatalogFont {
  family: string;
  category: 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';
  subsets: string[];
  weights: number[];
}

const W = (...w: number[]) => w;
const TH = ['thai', 'latin', 'latin-ext', 'vietnamese'];
const LAT = ['latin', 'latin-ext'];

/** Built-in list used when GOOGLE_FONTS_API_KEY is not configured. */
export const BUILTIN_GOOGLE_FONTS: CatalogFont[] = [
  { family: 'Sarabun', category: 'sans-serif', subsets: TH, weights: W(100, 200, 300, 400, 500, 600, 700, 800) },
  { family: 'Kanit', category: 'sans-serif', subsets: TH, weights: W(100, 200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'Prompt', category: 'sans-serif', subsets: TH, weights: W(100, 200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'Mitr', category: 'sans-serif', subsets: TH, weights: W(200, 300, 400, 500, 600, 700) },
  { family: 'Noto Sans Thai', category: 'sans-serif', subsets: ['thai', 'latin', 'latin-ext'], weights: W(100, 200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'Noto Serif Thai', category: 'serif', subsets: ['thai', 'latin', 'latin-ext'], weights: W(100, 200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'IBM Plex Sans Thai', category: 'sans-serif', subsets: ['thai', 'latin', 'latin-ext', 'cyrillic-ext'], weights: W(100, 200, 300, 400, 500, 600, 700) },
  { family: 'IBM Plex Sans Thai Looped', category: 'sans-serif', subsets: ['thai', 'latin', 'latin-ext', 'cyrillic-ext'], weights: W(100, 200, 300, 400, 500, 600, 700) },
  { family: 'Anuphan', category: 'sans-serif', subsets: ['thai', 'latin', 'latin-ext', 'vietnamese'], weights: W(100, 200, 300, 400, 500, 600, 700) },
  { family: 'Bai Jamjuree', category: 'sans-serif', subsets: TH, weights: W(200, 300, 400, 500, 600, 700) },
  { family: 'Chakra Petch', category: 'sans-serif', subsets: TH, weights: W(300, 400, 500, 600, 700) },
  { family: 'Niramit', category: 'sans-serif', subsets: TH, weights: W(200, 300, 400, 500, 600, 700) },
  { family: 'K2D', category: 'sans-serif', subsets: TH, weights: W(100, 200, 300, 400, 500, 600, 700, 800) },
  { family: 'Krub', category: 'sans-serif', subsets: TH, weights: W(200, 300, 400, 500, 600, 700) },
  { family: 'KoHo', category: 'sans-serif', subsets: TH, weights: W(200, 300, 400, 500, 600, 700) },
  { family: 'Kodchasan', category: 'sans-serif', subsets: TH, weights: W(200, 300, 400, 500, 600, 700) },
  { family: 'Mali', category: 'handwriting', subsets: TH, weights: W(200, 300, 400, 500, 600, 700) },
  { family: 'Pridi', category: 'serif', subsets: TH, weights: W(200, 300, 400, 500, 600, 700) },
  { family: 'Taviraj', category: 'serif', subsets: TH, weights: W(100, 200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'Trirong', category: 'serif', subsets: TH, weights: W(100, 200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'Athiti', category: 'sans-serif', subsets: TH, weights: W(200, 300, 400, 500, 600, 700) },
  { family: 'Chonburi', category: 'display', subsets: TH, weights: W(400) },
  { family: 'Itim', category: 'handwriting', subsets: TH, weights: W(400) },
  { family: 'Pattaya', category: 'sans-serif', subsets: ['thai', 'latin', 'latin-ext', 'vietnamese', 'cyrillic'], weights: W(400) },
  { family: 'Sriracha', category: 'handwriting', subsets: TH, weights: W(400) },
  { family: 'Thasadith', category: 'sans-serif', subsets: TH, weights: W(400, 700) },
  { family: 'Charm', category: 'handwriting', subsets: TH, weights: W(400, 700) },
  { family: 'Charmonman', category: 'handwriting', subsets: TH, weights: W(400, 700) },
  { family: 'Fahkwang', category: 'sans-serif', subsets: TH, weights: W(200, 300, 400, 500, 600, 700) },
  { family: 'Srisakdi', category: 'display', subsets: TH, weights: W(400, 700) },
  { family: 'Inter', category: 'sans-serif', subsets: ['latin', 'latin-ext', 'cyrillic', 'greek', 'vietnamese'], weights: W(100, 200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'Roboto', category: 'sans-serif', subsets: ['latin', 'latin-ext', 'cyrillic', 'greek', 'vietnamese'], weights: W(100, 300, 400, 500, 700, 900) },
  { family: 'Open Sans', category: 'sans-serif', subsets: ['latin', 'latin-ext', 'cyrillic', 'greek', 'hebrew', 'vietnamese'], weights: W(300, 400, 500, 600, 700, 800) },
  { family: 'Lato', category: 'sans-serif', subsets: LAT, weights: W(100, 300, 400, 700, 900) },
  { family: 'Montserrat', category: 'sans-serif', subsets: ['latin', 'latin-ext', 'cyrillic', 'vietnamese'], weights: W(100, 200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'Poppins', category: 'sans-serif', subsets: ['latin', 'latin-ext', 'devanagari'], weights: W(100, 200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'Noto Sans SC', category: 'sans-serif', subsets: ['chinese-simplified', 'latin', 'latin-ext', 'cyrillic', 'vietnamese'], weights: W(100, 200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'Noto Sans TC', category: 'sans-serif', subsets: ['chinese-traditional', 'latin', 'latin-ext', 'cyrillic', 'vietnamese'], weights: W(100, 200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'Noto Serif SC', category: 'serif', subsets: ['chinese-simplified', 'latin', 'latin-ext', 'cyrillic', 'vietnamese'], weights: W(200, 300, 400, 500, 600, 700, 800, 900) },
  { family: 'ZCOOL XiaoWei', category: 'serif', subsets: ['chinese-simplified', 'latin'], weights: W(400) },
  { family: 'Ma Shan Zheng', category: 'handwriting', subsets: ['chinese-simplified', 'latin'], weights: W(400) },
];

let apiCache: { at: number; items: CatalogFont[] } | null = null;
const DAY = 24 * 3600 * 1000;

function parseVariants(variants: string[]): number[] {
  const w = new Set<number>();
  for (const v of variants) {
    if (v === 'regular' || v === 'italic') w.add(400);
    else {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) w.add(n);
    }
  }
  return [...w].sort((a, b) => a - b);
}

async function loadCatalog(): Promise<{ source: 'api' | 'builtin'; items: CatalogFont[] }> {
  const key = process.env.GOOGLE_FONTS_API_KEY;
  if (!key) return { source: 'builtin', items: BUILTIN_GOOGLE_FONTS };
  if (apiCache && Date.now() - apiCache.at < DAY) return { source: 'api', items: apiCache.items };
  try {
    const r = await fetch(`https://www.googleapis.com/webfonts/v1/webfonts?key=${encodeURIComponent(key)}&sort=popularity`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as { items?: Array<{ family: string; category: CatalogFont['category']; subsets: string[]; variants: string[] }> };
    const items = (data.items ?? []).map((f) => ({ family: f.family, category: f.category, subsets: f.subsets, weights: parseVariants(f.variants) }));
    apiCache = { at: Date.now(), items };
    return { source: 'api', items };
  } catch (e) {
    console.warn('[appearance] Google Fonts API failed, using built-in list:', (e as Error).message);
    if (apiCache) return { source: 'api', items: apiCache.items };
    return { source: 'builtin', items: BUILTIN_GOOGLE_FONTS };
  }
}

export async function searchGoogleFonts(query: string, subset: string, limit = 200) {
  const { source, items } = await loadCatalog();
  const ql = query.trim().toLowerCase();
  const filtered = items.filter((f) => (!ql || f.family.toLowerCase().includes(ql)) && (!subset || f.subsets.includes(subset)));
  return { source, total: filtered.length, items: filtered.slice(0, limit) };
}

export async function findGoogleFont(family: string): Promise<CatalogFont | undefined> {
  const { items } = await loadCatalog();
  return items.find((f) => f.family.toLowerCase() === family.toLowerCase());
}

export const SYSTEM_FONTS = [
  { family: 'system-ui', note: 'ฟอนต์ระบบของอุปกรณ์' },
  { family: '-apple-system', note: 'macOS / iOS' },
  { family: 'Segoe UI', note: 'Windows' },
  { family: 'Tahoma', note: 'Windows (รองรับภาษาไทย)' },
  { family: 'Leelawadee UI', note: 'Windows 10+ (ภาษาไทย)' },
  { family: 'Leelawadee', note: 'Windows (ภาษาไทย)' },
  { family: 'Thonburi', note: 'macOS / iOS (ภาษาไทย)' },
  { family: 'Sukhumvit Set', note: 'macOS / iOS (ภาษาไทย)' },
  { family: 'Noto Sans Thai UI', note: 'Android / Linux (ภาษาไทย)' },
  { family: 'Microsoft YaHei', note: 'Windows (จีนตัวย่อ)' },
  { family: 'PingFang SC', note: 'macOS / iOS (จีนตัวย่อ)' },
  { family: 'Arial', note: 'Latin' },
  { family: 'Helvetica', note: 'Latin' },
  { family: 'sans-serif', note: 'Generic' },
  { family: 'serif', note: 'Generic' },
  { family: 'monospace', note: 'Generic' },
];

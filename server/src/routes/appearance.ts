/**
 * Admin → Appearance: centralized design configuration, font library,
 * versions / deliveries / rollback. Every publish creates a config version,
 * pushes `design:updated` to the affected `config:<system>` rooms and is audited.
 */
import { Router } from 'express';
import multer from 'multer';
import { applyToSystems, normalizeDesign, SYSTEM_GROUPS, SYSTEMS, type DesignConfig, type FontAsset } from '@pp/shared';
import { q, json, nowIso } from '../db/index.ts';
import { body, bool, h, HttpError, badRequest, conflict, notFound, paging, reqStr, str } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { getSetting } from '../lib/settings.ts';
import { audit } from '../lib/audit.ts';
import { storePublicFile } from './media.ts';
import {
  ALL_SYSTEMS,
  assertApplyAllowed,
  currentVersion,
  diffPaths,
  familiesInUse,
  findGoogleFont,
  listVersions,
  parseSystems,
  publishDesign,
  searchGoogleFonts,
  SYSTEM_FONTS,
  versionRow,
} from '../services/appearance.ts';

export const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 16 } });

const FAMILY_RE = /^[\p{L}\p{N} _.-]{1,80}$/u;
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function parseConfig(v: unknown): DesignConfig {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest('VALIDATION', 'config must be an object');
  return normalizeDesign(v as Partial<DesignConfig>);
}

// ---- design ---------------------------------------------------------------

router.get(
  '/design',
  requirePerm('appearance.edit'),
  h((_req, res) => {
    const b = getSetting('branding');
    res.json({
      config: getSetting('design'),
      version: currentVersion(),
      systems: SYSTEMS,
      groups: SYSTEM_GROUPS,
      // for realistic previews (print templates, logos)
      branding: { siteName: b.siteName, logoUrl: b.logoUrl },
      print: { ticket: getSetting('ticket'), receipt: getSetting('receipt') },
    });
  }),
);

router.post(
  '/design',
  requirePerm('appearance.edit'),
  h((req, res) => {
    const b = body(req);
    const next = parseConfig(b.config);
    const appliedTo = parseSystems(b.appliedTo);
    if (appliedTo && !appliedTo.length) throw badRequest('VALIDATION', 'appliedTo is empty');
    const changes = diffPaths(getSetting('design'), next);
    if (!changes.length) throw badRequest('NO_CHANGES', 'ไม่มีการเปลี่ยนแปลง');
    assertApplyAllowed(req, appliedTo, changes);
    const r = publishDesign(req, next, { appliedTo, note: str(b, 'note', { max: 500 }) ?? null });
    res.json(r);
  }),
);

/** "Save & Apply To…" / "Apply to All": copy a fonts/tokens/text patch to systems. */
router.post(
  '/design/apply',
  requirePerm('appearance.edit'),
  h((req, res) => {
    const b = body(req);
    const systems = parseSystems(b.systems);
    if (!systems?.length) throw badRequest('VALIDATION', 'systems is required');
    const p = (b.patch ?? {}) as Record<string, unknown>;
    if (typeof p !== 'object' || Array.isArray(p)) throw badRequest('VALIDATION', 'patch must be an object');
    const patch = {
      fonts: p.fonts && typeof p.fonts === 'object' ? (p.fonts as Record<string, string>) : undefined,
      tokens: p.tokens && typeof p.tokens === 'object' ? (p.tokens as Record<string, unknown>) : undefined,
      text: p.text && typeof p.text === 'object' ? (p.text as Record<string, unknown>) : undefined,
    };
    if (!patch.fonts && !patch.tokens && !patch.text) throw badRequest('VALIDATION', 'patch is empty');
    const current = getSetting('design');
    const next = normalizeDesign(applyToSystems(current, systems, patch as Parameters<typeof applyToSystems>[2], ALL_SYSTEMS));
    const changes = diffPaths(current, next);
    if (!changes.length) throw badRequest('NO_CHANGES', 'ไม่มีการเปลี่ยนแปลง');
    assertApplyAllowed(req, systems, changes);
    res.json(publishDesign(req, next, { appliedTo: systems, note: str(b, 'note', { max: 500 }) ?? null, meta: { patch } }));
  }),
);

// ---- versions -------------------------------------------------------------

router.get(
  '/versions',
  requirePerm('appearance.edit', 'configuration.rollback'),
  h((req, res) => {
    const { limit, offset } = paging(req, 200);
    res.json(listVersions(limit, offset));
  }),
);

router.get(
  '/versions/:id',
  requirePerm('appearance.edit', 'configuration.rollback'),
  h((req, res) => {
    const v = versionRow(Number(req.params.id));
    if (!v) throw notFound();
    const data = normalizeDesign(json(v.data_json, null));
    const prev = v.prev_json ? normalizeDesign(json(v.prev_json, null)) : null;
    const by = v.created_by ? q.get('SELECT display_name FROM users WHERE id=?', v.created_by) : null;
    res.json({
      id: v.id,
      versionNo: v.version_no,
      label: `Design Configuration v${v.version_no}`,
      createdAt: v.created_at,
      createdBy: by?.display_name ?? null,
      appliedTo: json(v.applied_to, null),
      note: v.note,
      rolledBackFrom: v.rolled_back_from,
      data,
      prev,
      changes: diffPaths(prev ?? normalizeDesign(null), data),
    });
  }),
);

router.get(
  '/versions/:id/deliveries',
  requirePerm('appearance.edit', 'configuration.rollback'),
  h((req, res) => {
    const v = versionRow(Number(req.params.id));
    if (!v) throw notFound();
    const items = q.all(
      `SELECT d.client_id, d.system, d.device_id, d.received_at, dv.name device_name, dv.type device_type
         FROM config_deliveries d LEFT JOIN devices dv ON dv.id=d.device_id
        WHERE d.version_id=? ORDER BY d.received_at DESC`,
      v.id,
    );
    res.json({ items: items.map((r) => ({ clientId: r.client_id, system: r.system, deviceId: r.device_id, deviceName: r.device_name ?? null, deviceType: r.device_type ?? null, receivedAt: r.received_at })) });
  }),
);

router.post(
  '/versions/:id/rollback',
  requirePerm('configuration.rollback'),
  h((req, res) => {
    const v = versionRow(Number(req.params.id));
    if (!v) throw notFound();
    const data = normalizeDesign(json(v.data_json, null));
    const reason = str(body(req), 'reason', { max: 500 });
    const r = publishDesign(req, data, {
      appliedTo: ALL_SYSTEMS,
      broadcastTo: ALL_SYSTEMS,
      rolledBackFrom: v.id,
      note: reason ?? `Rollback to v${v.version_no}`,
      action: 'appearance.rollback',
    });
    res.json(r);
  }),
);

// ---- fonts ----------------------------------------------------------------

interface FontRow {
  id: number;
  family: string;
  source: 'GOOGLE' | 'UPLOAD' | 'SYSTEM';
  weights_json: string;
  files_json: string;
  license_name: string | null;
  license_note: string | null;
  license_confirmed_by: number | null;
  license_confirmed_at: string | null;
  created_by: number | null;
  created_at: string;
}

router.get(
  '/fonts',
  requirePerm('appearance.edit', 'font.upload', 'font.google.manage'),
  h((_req, res) => {
    const cfg = getSetting('design');
    const used = familiesInUse(cfg);
    const rows = q.all<FontRow & { confirmed_by_name: string | null; created_by_name: string | null }>(
      `SELECT f.*, cu.display_name confirmed_by_name, u.display_name created_by_name FROM fonts f
         LEFT JOIN users cu ON cu.id=f.license_confirmed_by LEFT JOIN users u ON u.id=f.created_by ORDER BY f.family`,
    );
    const items = rows.map((r) => ({
      id: r.id,
      family: r.family,
      source: r.source,
      weights: json<number[]>(r.weights_json, []),
      files: json<NonNullable<FontAsset['files']>>(r.files_json, []),
      licenseName: r.license_name,
      licenseNote: r.license_note,
      licenseConfirmedBy: r.confirmed_by_name,
      licenseConfirmedAt: r.license_confirmed_at,
      createdBy: r.created_by_name,
      createdAt: r.created_at,
      inConfig: cfg.fonts.some((f) => f.family === r.family),
      inUse: used.has(r.family),
    }));
    // Fonts that exist only in the design config (e.g. built-in defaults).
    for (const f of cfg.fonts) {
      if (items.some((i) => i.family === f.family)) continue;
      items.push({
        id: null as unknown as number,
        family: f.family,
        source: f.source,
        weights: f.weights,
        files: f.files ?? [],
        licenseName: f.source === 'GOOGLE' ? 'SIL Open Font License' : null,
        licenseNote: null,
        licenseConfirmedBy: null,
        licenseConfirmedAt: null,
        createdBy: null,
        createdAt: null as unknown as string,
        inConfig: true,
        inUse: used.has(f.family),
      });
    }
    items.sort((a, b) => a.family.localeCompare(b.family));
    res.json({ items, inUse: [...used] });
  }),
);

router.get(
  '/google-fonts',
  requirePerm('appearance.edit', 'font.google.manage'),
  h(async (req, res) => {
    const subset = String(req.query.subset ?? '');
    res.json(await searchGoogleFonts(String(req.query.q ?? ''), subset, Math.min(500, Number(req.query.limit ?? 200))));
  }),
);

router.get(
  '/system-fonts',
  requirePerm('appearance.edit'),
  h((_req, res) => res.json({ items: SYSTEM_FONTS })),
);

/** Upsert a font asset in config.fonts and publish (push only when the family is in use). */
function publishFontAsset(req: Parameters<typeof publishDesign>[0], asset: FontAsset | null, family: string, note: string) {
  const cfg = structuredClone(getSetting('design'));
  cfg.fonts = cfg.fonts.filter((f) => f.family !== family);
  if (asset) cfg.fonts.push(asset);
  const inUse = familiesInUse(cfg).has(family);
  return publishDesign(req, cfg, { appliedTo: ALL_SYSTEMS, broadcastTo: inUse ? ALL_SYSTEMS : [], note, meta: { family, fontLibrary: true } });
}

router.post(
  '/fonts/google',
  requirePerm('font.google.manage'),
  h(async (req, res) => {
    const b = body(req);
    const family = reqStr(b, 'family', 80);
    if (!FAMILY_RE.test(family)) throw badRequest('VALIDATION', 'invalid family name');
    const known = await findGoogleFont(family);
    let weights = (Array.isArray(b.weights) ? b.weights : [400, 700]).map(Number).filter((w) => WEIGHTS.includes(w));
    if (known) weights = weights.filter((w) => known.weights.includes(w));
    if (!weights.length) weights = known?.weights.includes(400) ? [400] : (known?.weights.slice(0, 1) ?? [400]);
    weights = [...new Set(weights)].sort((a, c) => a - c);
    const name = known?.family ?? family;
    const existing = q.get<FontRow>('SELECT * FROM fonts WHERE family=?', name);
    if (existing && existing.source !== 'GOOGLE') throw conflict('FONT_EXISTS', `มีฟอนต์ชื่อ ${name} (${existing.source}) อยู่แล้ว`);
    if (existing) q.update('fonts', existing.id, { weights_json: JSON.stringify(weights) });
    else q.insert('fonts', { family: name, source: 'GOOGLE', weights_json: JSON.stringify(weights), license_name: 'SIL Open Font License / Apache 2.0 (Google Fonts)', created_by: req.user!.id });
    const r = publishFontAsset(req, { family: name, source: 'GOOGLE', weights }, name, `Add Google font ${name}`);
    audit(req, { action: 'font.google.add', entityType: 'font', entityId: name, before: existing ? { weights: json(existing.weights_json, []) } : null, after: { family: name, weights, versionNo: r.version.versionNo } });
    res.json({ family: name, weights, version: r.version });
  }),
);

const FORMAT: Record<string, string> = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' };
const asArray = (v: unknown): string[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

router.post(
  '/fonts/upload',
  requirePerm('font.upload'),
  upload.array('files', 16),
  h((req, res) => {
    const b = body(req);
    const family = reqStr(b, 'family', 80);
    if (!FAMILY_RE.test(family)) throw badRequest('VALIDATION', 'invalid family name');
    if (!bool(b, 'licenseConfirmed')) throw badRequest('LICENSE_CONFIRMATION_REQUIRED', 'ต้องยืนยันว่ามีสิทธิ์ใช้งานฟอนต์ (license) ก่อนอัปโหลด');
    const licenseName = reqStr(b, 'licenseName', 200);
    const licenseNote = str(b, 'licenseNote', { max: 1000 }) ?? null;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw badRequest('FILE_REQUIRED', 'ต้องแนบไฟล์ฟอนต์อย่างน้อย 1 ไฟล์');
    // Per-file weight/style: either `meta` = JSON [{weight, style}] or repeated `weights` / `styles` fields in file order.
    let meta: Array<{ weight?: unknown; style?: unknown }> = [];
    if (typeof b.meta === 'string') meta = json(b.meta, []);
    const ws = asArray(b.weights);
    const ss = asArray(b.styles);
    const existing = q.get<FontRow>('SELECT * FROM fonts WHERE family=?', family);
    if (existing && existing.source !== 'UPLOAD') throw conflict('FONT_EXISTS', `มีฟอนต์ชื่อ ${family} (${existing.source}) อยู่แล้ว`);
    const prevFiles = existing ? json<NonNullable<FontAsset['files']>>(existing.files_json, []) : [];
    const stored = files.map((f, i) => {
      const weight = Number(meta[i]?.weight ?? ws[i] ?? 400);
      const style = String(meta[i]?.style ?? ss[i] ?? 'normal');
      if (!WEIGHTS.includes(weight)) throw badRequest('VALIDATION', `invalid weight for ${f.originalname}`);
      if (style !== 'normal' && style !== 'italic') throw badRequest('VALIDATION', `invalid style for ${f.originalname}`);
      return { weight, style: style as 'normal' | 'italic', original: f.originalname, buf: f.buffer };
    });
    const dup = stored.find((s, i) => stored.findIndex((x) => x.weight === s.weight && x.style === s.style) !== i);
    if (dup) throw badRequest('VALIDATION', `มีไฟล์ซ้ำสำหรับ weight ${dup.weight} ${dup.style}`);
    const newFiles = stored.map((s) => {
      const m = storePublicFile(s.buf, 'fonts', ['FONT'], s.original, req.user!.id, `font:${family}`);
      const ext = m.url.split('.').pop()!;
      return { weight: s.weight, style: s.style, url: m.url, format: FORMAT[ext] ?? 'truetype' };
    });
    const allFiles = [...prevFiles.filter((p) => !newFiles.some((n) => n.weight === p.weight && n.style === p.style)), ...newFiles].sort((a, c) => a.weight - c.weight);
    const weights = [...new Set(allFiles.map((f) => f.weight))].sort((a, c) => a - c);
    const row = {
      weights_json: JSON.stringify(weights),
      files_json: JSON.stringify(allFiles),
      license_name: licenseName,
      license_note: licenseNote,
      license_confirmed_by: req.user!.id,
      license_confirmed_at: nowIso(),
    };
    let id: number;
    if (existing) {
      q.update('fonts', existing.id, row);
      id = existing.id;
    } else id = q.insert('fonts', { family, source: 'UPLOAD', created_by: req.user!.id, ...row });
    const r = publishFontAsset(req, { family, source: 'UPLOAD', weights, files: allFiles }, family, `Upload font ${family}`);
    audit(req, {
      action: 'font.upload',
      entityType: 'font',
      entityId: id,
      before: existing ? { files: prevFiles } : null,
      after: { family, files: allFiles, licenseName, licenseNote, licenseConfirmed: true, versionNo: r.version.versionNo },
    });
    res.json({ id, family, weights, files: allFiles, version: r.version });
  }),
);

/** :id = fonts table id, or a URL-encoded family name for config-only fonts. */
router.delete(
  '/fonts/:id',
  requirePerm('font.upload', 'font.google.manage'),
  h((req, res) => {
    const key = String(req.params.id);
    const row = /^\d+$/.test(key) ? q.get<FontRow>('SELECT * FROM fonts WHERE id=?', Number(key)) : q.get<FontRow>('SELECT * FROM fonts WHERE family=?', key);
    const cfg = getSetting('design');
    const family = row?.family ?? (cfg.fonts.find((f) => f.family === key)?.family ?? null);
    if (!family) throw notFound();
    const source = row?.source ?? cfg.fonts.find((f) => f.family === family)!.source;
    const perm = source === 'UPLOAD' ? 'font.upload' : 'font.google.manage';
    if (!req.user!.permissions.has(perm)) throw new HttpError(403, 'FORBIDDEN', `requires ${perm}`);
    if (familiesInUse(cfg).has(family)) throw conflict('FONT_IN_USE', `ฟอนต์ ${family} ยังถูกใช้งานอยู่ในการตั้งค่า กรุณาเปลี่ยนฟอนต์ก่อนลบ`);
    if (row) q.run('DELETE FROM fonts WHERE id=?', row.id);
    const r = cfg.fonts.some((f) => f.family === family) ? publishFontAsset(req, null, family, `Delete font ${family}`) : null;
    audit(req, { action: 'font.delete', entityType: 'font', entityId: row?.id ?? family, before: row ? { family, source, weights: json(row.weights_json, []), files: json(row.files_json, []) } : { family, source }, after: null });
    res.json({ ok: true, version: r?.version ?? null });
  }),
);

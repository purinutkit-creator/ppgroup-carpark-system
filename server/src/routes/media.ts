/**
 * Public media uploads (logos, banners, kiosk ads, product images, fonts).
 * Files are type-checked by magic bytes and stored under uploads/public.
 * LPR images never go here (they are private, see lib/files.ts).
 */
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q } from '../db/index.ts';
import { config } from '../config.ts';
import { h, HttpError, paging } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';

export const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const SIGS: Array<{ ext: string; mime: string; kind: string; test: (b: Buffer) => boolean }> = [
  { ext: 'jpg', mime: 'image/jpeg', kind: 'IMAGE', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', kind: 'IMAGE', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  { ext: 'gif', mime: 'image/gif', kind: 'IMAGE', test: (b) => b.subarray(0, 3).toString() === 'GIF' },
  { ext: 'webp', mime: 'image/webp', kind: 'IMAGE', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { ext: 'svg', mime: 'image/svg+xml', kind: 'IMAGE', test: (b) => /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(b.subarray(0, 300).toString()) && !/<script|on\w+=/i.test(b.toString()) },
  { ext: 'mp4', mime: 'video/mp4', kind: 'VIDEO', test: (b) => b.subarray(4, 8).toString() === 'ftyp' },
  { ext: 'webm', mime: 'video/webm', kind: 'VIDEO', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  { ext: 'woff2', mime: 'font/woff2', kind: 'FONT', test: (b) => b.subarray(0, 4).toString() === 'wOF2' },
  { ext: 'woff', mime: 'font/woff', kind: 'FONT', test: (b) => b.subarray(0, 4).toString() === 'wOFF' },
  { ext: 'otf', mime: 'font/otf', kind: 'FONT', test: (b) => b.subarray(0, 4).toString() === 'OTTO' },
  { ext: 'ttf', mime: 'font/ttf', kind: 'FONT', test: (b) => b.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])) || b.subarray(0, 4).toString() === 'true' },
];

export function detectFile(buf: Buffer) {
  return SIGS.find((s) => s.test(buf)) ?? null;
}

/** Store a validated buffer under uploads/public/<folder>; returns { url, kind, mime }. */
export function storePublicFile(buf: Buffer, folder: string, allowKinds: string[], originalName?: string, userId?: number | null, purpose?: string) {
  const t = detectFile(buf);
  if (!t || !allowKinds.includes(t.kind)) throw new HttpError(400, 'UNSUPPORTED_FILE', `allowed: ${allowKinds.join(', ')}`);
  if (t.kind === 'IMAGE' && buf.length > 15 * 1024 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE');
  if (t.kind === 'FONT' && buf.length > 20 * 1024 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE');
  const safeFolder = folder.replace(/[^a-z0-9-]/gi, '') || 'misc';
  const rel = path.posix.join('public', safeFolder, `${crypto.randomUUID()}.${t.ext}`);
  const abs = path.join(config.uploadDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  const url = `/uploads/${rel}`;
  const id = q.insert('media', { url, kind: t.kind, mime: t.mime, size: buf.length, original_name: originalName ?? null, purpose: purpose ?? safeFolder, created_by: userId ?? null });
  return { id, url, kind: t.kind, mime: t.mime, size: buf.length };
}

export const uploadSingle = upload.single('file');

router.post(
  '/',
  requirePerm('kiosk_content.manage', 'appearance.edit', 'settings.manage', 'merchants.manage', 'pos.products', 'merchant.settings', 'font.upload'),
  uploadSingle,
  h((req, res) => {
    if (!req.file) throw new HttpError(400, 'FILE_REQUIRED');
    const folder = String(req.body?.folder ?? 'media');
    const kinds = folder === 'fonts' ? ['FONT'] : ['IMAGE', 'VIDEO'];
    res.json(storePublicFile(req.file.buffer, folder, kinds, req.file.originalname, req.user!.id, String(req.body?.purpose ?? folder)));
  }),
);

router.get(
  '/',
  requirePerm('kiosk_content.manage', 'appearance.edit', 'settings.manage'),
  h((req, res) => {
    const { limit, offset } = paging(req);
    const kind = req.query.kind ? String(req.query.kind) : null;
    res.json({ items: kind ? q.all('SELECT * FROM media WHERE kind=? ORDER BY id DESC LIMIT ? OFFSET ?', kind, limit, offset) : q.all('SELECT * FROM media ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset) });
  }),
);

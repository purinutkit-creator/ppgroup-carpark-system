import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.ts';
import { badRequest } from './http.ts';

const IMAGE_SIG: Array<[string, number[]]> = [
  ['jpg', [0xff, 0xd8, 0xff]],
  ['png', [0x89, 0x50, 0x4e, 0x47]],
  ['webp', [0x52, 0x49, 0x46, 0x46]],
];

/** Save a base64 / data-URL image under a private (non-public) folder. Returns relative path. */
export function savePrivateImage(data: string | undefined | null, folder = 'lpr'): string | null {
  if (!data) return null;
  const b64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 8) return null;
  if (buf.length > 8 * 1024 * 1024) throw badRequest('IMAGE_TOO_LARGE');
  const ext = IMAGE_SIG.find(([, sig]) => sig.every((b, i) => buf[i] === b))?.[0];
  if (!ext) throw badRequest('UNSUPPORTED_IMAGE');
  const d = new Date();
  const rel = path.join('private', folder, d.toISOString().slice(0, 10), `${crypto.randomUUID()}.${ext}`);
  const abs = path.join(config.uploadDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return rel.split(path.sep).join('/');
}

export function privateFilePath(rel: string): string | null {
  const abs = path.resolve(config.uploadDir, rel);
  if (!abs.startsWith(path.resolve(config.uploadDir, 'private') + path.sep)) return null;
  return fs.existsSync(abs) ? abs : null;
}

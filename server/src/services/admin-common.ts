/**
 * Small helpers shared by the admin configuration routers (routes/admin.ts).
 */
import type { Request } from 'express';
import { manualPlate, parsePlateText, provinceByCode } from '@pp/shared';
import { q, json, type Row } from '../db/index.ts';
import { badRequest, notFound } from '../lib/http.ts';
import { assertSite } from '../auth/middleware.ts';

export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('INVALID_ID', `${name} must be a positive integer`);
  return n;
}

/** Fetch a row by id or 404. Table names are internal constants only. */
export function mustGet(table: string, id: number, code = 'NOT_FOUND'): Row {
  const r = q.get(`SELECT * FROM ${table} WHERE id=?`, id);
  if (!r) throw notFound(code);
  return r;
}

/** Parse a JSON array column / body value of positive integers; empty → null (= all). */
export function idList(v: unknown): number[] | null {
  const arr = typeof v === 'string' ? json<unknown>(v, null) : v;
  if (!Array.isArray(arr)) return null;
  const ids = [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  return ids.length ? ids : null;
}

export function strList(v: unknown, allowed?: readonly string[]): string[] | null {
  const arr = typeof v === 'string' ? json<unknown>(v, null) : v;
  if (!Array.isArray(arr)) return null;
  const out = [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))].filter((s) => !allowed || allowed.includes(s));
  return out.length ? out : null;
}

export const jsonOrNull = (v: unknown) => (v == null ? null : JSON.stringify(v));

/** Columns whose value changed (for compact audit entries). */
export function changed(before: Row, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (before[k] !== v) out[k] = v;
  return out;
}

/** The previous values of the columns in `diff` (audit "before"). */
export function beforeOf(row: Row, diff: Record<string, unknown>): Row {
  return pickCols(row, Object.keys(diff));
}

export function pickCols(row: Row, cols: string[]): Row {
  const out: Row = {};
  for (const c of cols) out[c] = row[c];
  return out;
}

/** Users scoped to sites may only write rows for their sites; global rows need an unscoped user. */
export function assertSiteWrite(req: Request, siteId: number | null | undefined) {
  if (siteId == null) {
    if (req.user?.siteIds) throw badRequest('SITE_REQUIRED', 'site-scoped users must choose a site');
    return;
  }
  assertSite(req, siteId);
}

/** Resolve a typed plate (prefix + number + province code/name) → canonical key. */
export function plateFrom(input: { prefix?: string | null; number?: string | null; plate?: string | null; province?: string | null }) {
  let prefix = (input.prefix ?? '').trim();
  let number = (input.number ?? '').trim();
  if ((!prefix || !number) && input.plate) {
    const p = parsePlateText(input.plate);
    if (!p) throw badRequest('INVALID_PLATE', 'ไม่สามารถอ่านรูปแบบทะเบียนได้');
    prefix = p.prefix;
    number = p.number;
  }
  if (!prefix || !/^\d+$/.test(number)) throw badRequest('INVALID_PLATE', 'ต้องระบุหมวดอักษรและเลขทะเบียน');
  const m = manualPlate(prefix, number, input.province ?? null);
  return { ...m, provinceName: m.provinceName ?? (m.provinceCode ? provinceByCode(m.provinceCode)?.th ?? null : null) };
}

export function isoOrNull(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw badRequest('VALIDATION', `${field} must be a date/time`);
  return d.toISOString();
}

export function hhmmOrNull(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw badRequest('VALIDATION', `${field} must be HH:mm`);
  return s;
}

export function dateOrNull(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest('VALIDATION', `${field} must be YYYY-MM-DD`);
  return s;
}

export function like(qs: unknown): string | null {
  const s = typeof qs === 'string' ? qs.trim() : '';
  return s ? `%${s.replace(/[%_]/g, '')}%` : null;
}

/**
 * Conform `incoming` to the shape of `template`: only known keys survive and
 * each value must match the template's type (arrays stay arrays, nested objects
 * are conformed recursively). Missing / invalid values fall back to `current`.
 */
export function conform<T>(template: T, incoming: unknown, current: T = template): T {
  if (Array.isArray(template)) return (Array.isArray(incoming) ? incoming : current) as T;
  if (template && typeof template === 'object') {
    const src = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? (incoming as Record<string, unknown>) : {};
    const cur = (current && typeof current === 'object' ? current : template) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, t] of Object.entries(template as Record<string, unknown>)) {
      out[k] = k in src ? conform(t, src[k], (cur[k] ?? t) as typeof t) : (cur[k] ?? t);
    }
    return out as T;
  }
  if (typeof template === 'number') {
    const n = typeof incoming === 'string' && incoming.trim() !== '' ? Number(incoming) : incoming;
    return (typeof n === 'number' && Number.isFinite(n) ? n : current) as T;
  }
  if (typeof template === 'boolean') return (typeof incoming === 'boolean' ? incoming : current) as T;
  if (typeof template === 'string') return (typeof incoming === 'string' ? incoming : current) as T;
  return (incoming ?? current) as T;
}

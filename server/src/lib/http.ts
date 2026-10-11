import type { NextFunction, Request, Response, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, msg?: string, details?: unknown) => new HttpError(400, code, msg, details);
export const notFound = (code = 'NOT_FOUND', msg?: string) => new HttpError(404, code, msg);
export const forbidden = (code = 'FORBIDDEN', msg?: string) => new HttpError(403, code, msg);
export const conflict = (code: string, msg?: string, details?: unknown) => new HttpError(409, code, msg, details);

/** Wrap sync/async handlers so thrown errors reach the error middleware. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => {
    try {
      const r = fn(req, res, next);
      if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).catch(next);
    } catch (e) {
      next(e);
    }
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  const e = err as { type?: string; status?: number; message?: string; code?: string };
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'INVALID_JSON' });
    return;
  }
  if (e?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'FILE_TOO_LARGE' });
    return;
  }
  if (typeof e?.message === 'string' && e.message.includes('UNIQUE constraint failed')) {
    res.status(409).json({ error: 'DUPLICATE', message: e.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
}

// ---- tiny input validation helpers (no external schema lib) ---------------
type Obj = Record<string, unknown>;
export function body(req: Request): Obj {
  return (req.body ?? {}) as Obj;
}
export function str(o: Obj, k: string, opts: { required?: boolean; max?: number } = {}): string | undefined {
  const v = o[k];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw badRequest('VALIDATION', `${k} is required`);
    return undefined;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw badRequest('VALIDATION', `${k} must be a string`);
  const s = String(v).trim();
  if (opts.max && s.length > opts.max) throw badRequest('VALIDATION', `${k} too long`);
  return s;
}
export function reqStr(o: Obj, k: string, max = 500): string {
  return str(o, k, { required: true, max })!;
}
export function num(o: Obj, k: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | undefined {
  const v = o[k];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw badRequest('VALIDATION', `${k} is required`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw badRequest('VALIDATION', `${k} must be a number`);
  if (opts.min !== undefined && n < opts.min) throw badRequest('VALIDATION', `${k} must be >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw badRequest('VALIDATION', `${k} must be <= ${opts.max}`);
  return n;
}
export function int(o: Obj, k: string, opts: { required?: boolean; min?: number; max?: number } = {}) {
  const n = num(o, k, opts);
  return n === undefined ? undefined : Math.trunc(n);
}
export function bool(o: Obj, k: string): boolean | undefined {
  const v = o[k];
  if (v === undefined || v === null || v === '') return undefined;
  return v === true || v === 1 || v === '1' || v === 'true';
}
export function oneOf<T extends string>(o: Obj, k: string, values: readonly T[], required = false): T | undefined {
  const v = str(o, k, { required });
  if (v === undefined) return undefined;
  if (!values.includes(v as T)) throw badRequest('VALIDATION', `${k} must be one of ${values.join(', ')}`);
  return v as T;
}
export function paging(req: Request, max = 500) {
  const limit = Math.min(max, Math.max(1, Number(req.query.limit ?? 50)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  return { limit, offset };
}
export const r2 = (n: number) => Math.round(n * 100) / 100;

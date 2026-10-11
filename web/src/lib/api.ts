/**
 * HTTP client. Staff requests carry the login token; kiosks/devices carry the
 * device key (X-Device-Key) stored on the kiosk PC during setup.
 */
const TOKEN_KEY = 'pp.token';
const DEVICE_KEY = 'pp.deviceKey';

export const storage = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

export const getToken = () => storage.get(TOKEN_KEY);
export const setToken = (t: string | null) => storage.set(TOKEN_KEY, t);
export const getDeviceKey = () => storage.get(DEVICE_KEY);
export const setDeviceKey = (k: string | null) => storage.set(DEVICE_KEY, k);

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Use device key instead of staff token (kiosks). */
  device?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function api<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const token = getToken();
  const dk = getDeviceKey();
  if (opts.device && dk) headers['X-Device-Key'] = dk;
  else if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!opts.device && dk && !token) headers['X-Device-Key'] = dk;
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const d = (typeof data === 'object' ? data : {}) as { error?: string; message?: string; details?: unknown };
    if (res.status === 401 && d.error === 'UNAUTHENTICATED' && !opts.device) {
      setToken(null);
      window.dispatchEvent(new Event('pp:logout'));
    }
    throw new ApiError(res.status, d.error ?? 'HTTP_' + res.status, d.message ?? d.error ?? res.statusText, d.details);
  }
  return data as T;
}

export const get = <T = any>(p: string, o?: RequestOptions) => api<T>(p, { ...o, method: 'GET' });
export const post = <T = any>(p: string, body?: unknown, o?: RequestOptions) => api<T>(p, { ...o, method: 'POST', body: body ?? {} });
export const put = <T = any>(p: string, body?: unknown, o?: RequestOptions) => api<T>(p, { ...o, method: 'PUT', body: body ?? {} });
export const patch = <T = any>(p: string, body?: unknown, o?: RequestOptions) => api<T>(p, { ...o, method: 'PATCH', body: body ?? {} });
export const del = <T = any>(p: string, o?: RequestOptions) => api<T>(p, { ...o, method: 'DELETE' });

/** Query-string helper that skips empty values. */
export function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function newIdempotencyKey() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

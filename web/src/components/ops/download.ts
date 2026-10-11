import { ApiError, getToken, qs } from '../../lib/api';

/** Download an authenticated file (report export) and hand it to the browser. */
export async function downloadAuthed(path: string, params: Record<string, unknown>, fallbackName: string) {
  const res = await fetch(path + qs(params), { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) {
    let d: { error?: string; message?: string } = {};
    try {
      d = await res.json();
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, d.error ?? `HTTP_${res.status}`, d.message ?? res.statusText);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Trailing-edge debounce for realtime refreshes. */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Local (Bangkok) YYYY-MM-DD for today ± days. */
export function localDate(offsetDays = 0) {
  return new Date(Date.now() + 7 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

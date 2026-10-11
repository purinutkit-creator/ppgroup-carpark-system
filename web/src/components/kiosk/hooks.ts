/** Small hooks shared by the kiosks, counter and customer web. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get, getDeviceKey, getToken } from '../../lib/api';
import type { Bootstrap, PublicConfig } from './types';

/** Current time, re-rendering every `ms`. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * Server clock: keeps the offset between the device clock and the server's
 * `now` (from a Quote) so timers do not drift on kiosks with a wrong clock.
 */
export function useServerClock(serverNowIso: string | null | undefined, ms = 1000) {
  const offset = useRef(0);
  useEffect(() => {
    if (serverNowIso) offset.current = new Date(serverNowIso).getTime() - Date.now();
  }, [serverNowIso]);
  const now = useNow(ms);
  return now + offset.current;
}

/** Calls `fn` once at the given ISO time (e.g. quote.nextChangeAt). */
export function useAt(iso: string | null | undefined, fn: () => void, offsetMs = 0) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!iso) return;
    const wait = new Date(iso).getTime() - Date.now() + 400;
    // setTimeout overflows above ~24.8 days; quotes are re-fetched long before that.
    const t = setTimeout(() => ref.current(), Math.min(2 ** 31 - 1, Math.max(500, wait + offsetMs)));
    return () => clearTimeout(t);
  }, [iso, offsetMs]);
}

/** Fires `onIdle` after `seconds` without touch / key / pointer activity. */
export function useIdleTimeout(seconds: number, onIdle: () => void, enabled = true) {
  const ref = useRef(onIdle);
  ref.current = onIdle;
  useEffect(() => {
    if (!enabled || seconds <= 0) return;
    let t = setTimeout(() => ref.current(), seconds * 1000);
    const bump = () => {
      clearTimeout(t);
      t = setTimeout(() => ref.current(), seconds * 1000);
    };
    const evs = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [seconds, enabled]);
}

/** Runs `fn` every `ms` while `enabled`. */
export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms == null) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

let cfgPromise: Promise<PublicConfig> | null = null;
/** Branding / payment methods / payment provider (cached per page load). */
export function usePublicConfig() {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  useEffect(() => {
    let alive = true;
    cfgPromise ??= get<PublicConfig>('/api/public/config').catch((e) => {
      cfgPromise = null;
      throw e;
    });
    cfgPromise.then((c) => alive && setCfg(c)).catch(() => {});
    return () => void (alive = false);
  }, []);
  return cfg;
}

/**
 * Device bootstrap for kiosks. `status` is 'nodevice' when the browser has
 * neither a device key nor a staff login (the page should link to /setup).
 */
export function useBootstrap() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'nodevice' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!getDeviceKey() && !getToken()) {
      setStatus('nodevice');
      return;
    }
    try {
      const b = await get<Bootstrap>('/api/kiosk/bootstrap', { device: true });
      setData(b);
      setStatus('ready');
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setStatus('nodevice');
      else {
        setStatus('error');
        setError((e as Error).message);
      }
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { data, status, error, reload: load };
}

/** Plays a configured sound URL (branding.sounds), ignoring autoplay errors. */
export function playSound(url: string | null | undefined, enabled = true) {
  if (!url || !enabled) return;
  try {
    const a = new Audio(url);
    void a.play().catch(() => {});
  } catch {
    /* no audio */
  }
}

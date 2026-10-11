/**
 * Kiosk payment helper: create a charge for a session (server computes the
 * amount) and poll GET /api/kiosk/payments/:id every 2 s until it settles.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, newIdempotencyKey, post } from '../../lib/api';
import { errorText } from '../ui';
import type { Payment, Quote } from './types';

export type PayMethod = 'PROMPTPAY' | 'CARD' | 'EWALLET';

export function useKioskPayment(onPaid: (p: Payment, q: Quote | null) => void) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cb = useRef(onPaid);
  cb.current = onPaid;
  const done = useRef<number | null>(null);

  const start = useCallback(async (sessionId: number, method: PayMethod) => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ payment: Payment; qrDataUrl: string | null }>(`/api/kiosk/sessions/${sessionId}/payments`, { method, idempotencyKey: newIdempotencyKey() }, { device: true });
      done.current = null;
      setPayment(r.payment);
      setQr(r.qrDataUrl);
      return r.payment;
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => {
    setPayment(null);
    setQr(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!payment || payment.status !== 'PENDING') return;
    const id = payment.id;
    const tick = async () => {
      try {
        const r = await get<{ payment: Payment; quote: Quote }>(`/api/kiosk/payments/${id}`, { device: true });
        if (r.payment.status !== 'PENDING') setPayment(r.payment);
        if ((r.payment.status === 'PAID' || r.quote.due <= 0) && done.current !== id) {
          done.current = id;
          cb.current(r.payment, r.quote);
        }
      } catch {
        /* keep polling */
      }
    };
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, [payment]);

  return { payment, qr, error, busy, start, clear, setError };
}

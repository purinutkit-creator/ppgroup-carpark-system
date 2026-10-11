import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { connectSocket, type SocketAuth } from './socket';

/**
 * Subscribe to realtime events for the lifetime of a component.
 *   useSocketEvents({ 'session:update': (q) => ... }, { parkingToken })
 */
export function useSocketEvents(handlers: Record<string, (payload: any) => void>, auth: SocketAuth = {}, deps: unknown[] = []) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  useEffect(() => {
    const s = connectSocket(auth);
    setSocket(s);
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    const names = Object.keys(ref.current);
    const bound = names.map((n) => {
      const fn = (p: unknown) => ref.current[n]?.(p);
      s.on(n, fn);
      return [n, fn] as const;
    });
    return () => {
      bound.forEach(([n, fn]) => s.off(n, fn));
      s.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { connected, socket };
}

/**
 * Live gate state for entry / exit kiosks: initial GET /api/gates/:id/state,
 * then `gate:state` pushes. Staff browsers (no device key) join the gate room
 * with `gate:watch`. Falls back to polling while the socket is down.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '../../lib/api';
import { connectSocket } from '../../lib/socket';
import type { GateState } from './types';

export interface GateInfo {
  id: number;
  name: string;
  direction: 'ENTRY' | 'EXIT';
  siteId: number;
}

export function useGateState(gateId: number | null, handlers: { onBarrierOpen?: (cmd: unknown) => void } = {}) {
  const [state, setState] = useState<GateState | null>(null);
  const [gate, setGate] = useState<GateInfo | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const h = useRef(handlers);
  h.current = handlers;

  const refresh = useCallback(async () => {
    if (!gateId) return;
    try {
      const r = await get<{ gate: GateInfo; state: GateState }>(`/api/gates/${gateId}/state`, { device: true });
      setGate(r.gate);
      setState(r.state);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [gateId]);

  useEffect(() => {
    if (!gateId) return;
    refresh();
    const s = connectSocket();
    s.on('connect', () => {
      setOnline(true);
      s.emit('gate:watch', gateId);
      refresh();
    });
    s.on('disconnect', () => setOnline(false));
    s.on('gate:state', (p: GateState | { gateId: number; state: GateState }) => {
      // gate room sends the bare state; the staff room sends { gateId, state } for every gate
      if ('kind' in p) setState(p);
      else if (p.gateId === gateId) setState(p.state);
    });
    s.on('barrier:open', (cmd: { gateId?: number }) => {
      if (cmd?.gateId && cmd.gateId !== gateId) return;
      h.current.onBarrierOpen?.(cmd);
    });
    return () => {
      s.disconnect();
    };
  }, [gateId, refresh]);

  useEffect(() => {
    if (online || !gateId) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [online, gateId, refresh]);

  return { state, gate, online, error, refresh, setState };
}

/**
 * Real-time fan-out via Socket.IO rooms:
 *   staff            — admin / dashboard / counters (authenticated users)
 *   site:<id>        — site-scoped staff screens
 *   gate:<id>        — entry/exit kiosk + gate devices
 *   device:<id>      — a single device (kiosk, edge agent)
 *   session:<id>     — customer website for one parking session (joined by token)
 *   merchant:<id>    — merchant POS / portal
 *   config:<system>  — design / configuration pushes
 */
import type { Server } from 'socket.io';

let io: Server | null = null;
export function setIo(server: Server) {
  io = server;
}
export function getIo() {
  return io;
}

function to(room: string, event: string, payload: unknown) {
  io?.to(room).emit(event, payload);
}

export const emit = {
  staff: (event: string, payload: unknown) => to('staff', event, payload),
  site: (siteId: number, event: string, payload: unknown) => to(`site:${siteId}`, event, payload),
  gate: (gateId: number, event: string, payload: unknown) => to(`gate:${gateId}`, event, payload),
  device: (deviceId: number, event: string, payload: unknown) => to(`device:${deviceId}`, event, payload),
  session: (sessionId: number, event: string, payload: unknown) => to(`session:${sessionId}`, event, payload),
  merchant: (merchantId: number, event: string, payload: unknown) => to(`merchant:${merchantId}`, event, payload),
  config: (system: string, event: string, payload: unknown) => to(`config:${system}`, event, payload),
  all: (event: string, payload: unknown) => io?.emit(event, payload),
};

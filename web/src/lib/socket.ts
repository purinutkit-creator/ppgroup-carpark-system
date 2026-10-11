import { io, type Socket } from 'socket.io-client';
import { getDeviceKey, getToken } from './api';

export interface SocketAuth {
  token?: string | null;
  deviceKey?: string | null;
  parkingToken?: string | null;
  system?: string;
}

/** Create a socket; staff token / device key are attached automatically unless overridden. */
export function connectSocket(auth: SocketAuth = {}): Socket {
  return io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: {
      token: auth.token === undefined ? getToken() : auth.token,
      deviceKey: auth.deviceKey === undefined ? getDeviceKey() : auth.deviceKey,
      parkingToken: auth.parkingToken ?? undefined,
      system: auth.system,
    },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });
}

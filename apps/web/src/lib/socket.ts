import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

let brSocket: Socket | null = null;

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('td_token');
}

/** Socket principal — Battle Royale + market ticks */
export function getBrSocket(): Socket {
  if (!brSocket) {
    brSocket = io(`${WS_URL}/br`, {
      autoConnect: false,
      auth: { token: getToken() },
      transports: ['websocket', 'polling'],
    });
  }
  return brSocket;
}

export function connectSockets() {
  const token = getToken();
  if (!token) return;
  const s = getBrSocket();
  s.auth = { token };
  if (!s.connected) s.connect();
}

/** Chart / arena — con o sin sesión */
export function ensureBrSocketConnected() {
  const token = getToken();
  const s = getBrSocket();
  s.auth = { token: token ?? '' };
  if (!s.connected) s.connect();
  return s;
}

/** @deprecated alias para chart legacy */
export function ensureDuelsSocketConnected() {
  return ensureBrSocketConnected();
}

export function getDuelsSocket() {
  return getBrSocket();
}

export function disconnectSockets() {
  brSocket?.disconnect();
  brSocket = null;
}

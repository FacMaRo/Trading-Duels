import { io, Socket } from 'socket.io-client';

/**
 * Public API origin for Socket.IO (no path, no trailing slash).
 * Must be baked in at build time via NEXT_PUBLIC_API_URL on Railway.
 */
function resolveSocketBaseUrl(): string {
  const raw = (
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_WS_URL ||
    ''
  ).trim();

  let url = raw.replace(/\/+$/, '');
  // REST client uses `${API_URL}/api/...` — strip accidental /api suffix
  if (url.endsWith('/api')) {
    url = url.slice(0, -4);
  }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalPage =
      host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';

    if (!url) {
      if (isLocalPage) {
        console.warn(
          '[socket] NEXT_PUBLIC_API_URL missing — falling back to http://localhost:3001 (dev only)',
        );
        return 'http://localhost:3001';
      }
      console.error(
        '[socket] NEXT_PUBLIC_API_URL is not set. WebSocket cannot reach the API. ' +
          'Set NEXT_PUBLIC_API_URL to your public API origin ' +
          '(e.g. https://trading-duels-production.up.railway.app) and redeploy/rebuild the WEB service.',
      );
      return '';
    }

    // Guard: production page must not point sockets at localhost
    if (
      !isLocalPage &&
      (url.includes('localhost') || url.includes('127.0.0.1'))
    ) {
      console.error(
        '[socket] NEXT_PUBLIC_API_URL is localhost but the site is not local. ' +
          'Rebuild WEB with the production API URL. Current value:',
        url,
      );
    }
  } else if (!url) {
    return 'http://localhost:3001';
  }

  return url;
}

let brSocket: Socket | null = null;
let brSocketBase: string | null = null;

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('td_token');
}

/** Socket principal — Battle Royale + market ticks (namespace /br) */
export function getBrSocket(): Socket {
  const base = resolveSocketBaseUrl();
  if (!base) {
    // Return a disconnected stub socket so callers don't crash; connect is no-op
    if (!brSocket) {
      brSocket = io('http://127.0.0.1:9', {
        autoConnect: false,
        path: '/socket.io',
      });
    }
    return brSocket;
  }

  // Recreate if env/base changed (e.g. HMR) or first init
  if (!brSocket || brSocketBase !== base) {
    if (brSocket) {
      brSocket.removeAllListeners();
      brSocket.disconnect();
    }
    brSocketBase = base;
    brSocket = io(`${base}/br`, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      auth: { token: getToken() ?? '' },
    });

    if (typeof window !== 'undefined') {
      brSocket.on('connect_error', (err) => {
        console.warn('[socket] connect_error', base, err.message);
      });
      brSocket.on('connect', () => {
        console.info('[socket] connected', base, brSocket?.id);
      });
    }
  }
  return brSocket;
}

export function connectSockets() {
  const token = getToken();
  if (!token) return;
  const base = resolveSocketBaseUrl();
  if (!base) return;
  const s = getBrSocket();
  s.auth = { token };
  if (!s.connected) s.connect();
}

/** Chart / arena / demo queue — connect with or without session */
export function ensureBrSocketConnected() {
  const token = getToken();
  const base = resolveSocketBaseUrl();
  if (!base) return getBrSocket();
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
  brSocket?.removeAllListeners();
  brSocket?.disconnect();
  brSocket = null;
  brSocketBase = null;
}

/** Exposed for debugging / QA */
export function getSocketBaseUrlForDebug() {
  return resolveSocketBaseUrl();
}

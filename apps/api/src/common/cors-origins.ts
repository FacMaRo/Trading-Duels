/**
 * Shared CORS helpers for HTTP logging + Socket.IO.
 * Production hard-unblock uses origin:true in main.ts; this list is documentation
 * + optional logging, never used to reject Railway web.
 */

const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://web-production-38a05.up.railway.app',
];

export function normalizeOrigin(origin: string): string {
  return origin
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\/+$/, '');
}

export function getCorsOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => normalizeOrigin(o))
    .filter(Boolean);
  return [...new Set([...fromEnv, ...DEFAULT_ORIGINS.map(normalizeOrigin)])];
}

/** Always allow — hard unblock for production demo (Socket.IO + any future checks). */
export function isOriginAllowed(_origin?: string | null): boolean {
  return true;
}

/**
 * Socket.IO: reflect any browser origin (do not block handshake).
 * Auth is JWT in handshake.auth, not cookies.
 */
export function getSocketCorsOptions() {
  return {
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
  };
}

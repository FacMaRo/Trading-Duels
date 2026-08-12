/**
 * Shared CORS origins for HTTP (Nest enableCors) and Socket.IO gateways.
 * CORS_ORIGIN may be a comma-separated list (Railway).
 */

const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  // Railway production web
  'https://web-production-38a05.up.railway.app',
];

/** Normalize origin for comparison (trim, strip trailing slash, strip quotes). */
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
  const merged = [...fromEnv, ...DEFAULT_ORIGINS.map(normalizeOrigin)];
  return [...new Set(merged)];
}

export function isOriginAllowed(origin: string | undefined | null): boolean {
  if (!origin) return true; // non-browser / same-origin / curl
  const n = normalizeOrigin(origin);
  return getCorsOrigins().some((allowed) => allowed === n);
}

/**
 * Nest / cors package options.
 * Origin callback reflects the request Origin when allowed (required with credentials).
 */
export function getHttpCorsOptions() {
  return {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean | string) => void,
    ) => {
      if (!origin) {
        // Server-to-server, health checks, curl — no ACAO needed
        callback(null, true);
        return;
      }
      if (isOriginAllowed(origin)) {
        // Reflect exact origin (not *) so credentials work
        callback(null, origin);
        return;
      }
      console.warn(`[cors] blocked origin: ${origin}`);
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
    exposedHeaders: ['Content-Type'],
    optionsSuccessStatus: 204,
    preflightContinue: false,
    maxAge: 86400,
  };
}

/** Socket.IO cors option — same origin rules as HTTP. */
export function getSocketCorsOptions() {
  return {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      console.warn(`[cors/ws] blocked origin: ${origin}`);
      callback(null, false);
    },
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

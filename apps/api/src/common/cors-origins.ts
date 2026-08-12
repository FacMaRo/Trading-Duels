/**
 * Shared CORS origins for HTTP and Socket.IO.
 * CORS_ORIGIN can be a comma-separated list.
 */
const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  // Railway production web (documented product surface)
  'https://web-production-38a05.up.railway.app',
];

export function getCorsOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, ...DEFAULT_ORIGINS])];
}

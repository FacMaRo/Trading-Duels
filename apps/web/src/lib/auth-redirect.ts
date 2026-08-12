/**
 * Public access + on-demand login helpers.
 * Pages are viewable without a session; money/account actions redirect to login.
 */

import { COPY } from '@/lib/copy';

export function buildLoginUrl(returnTo?: string | null, reason?: string | null) {
  const params = new URLSearchParams();
  if (returnTo) params.set('next', returnTo);
  if (reason) params.set('reason', reason);
  const q = params.toString();
  return q ? `/login?${q}` : '/login';
}

export function buildRegisterUrl(
  returnTo?: string | null,
  reason?: string | null,
) {
  const params = new URLSearchParams();
  if (returnTo) params.set('next', returnTo);
  if (reason) params.set('reason', reason);
  const q = params.toString();
  return q ? `/register?${q}` : '/register';
}

/** Safe post-login destination (internal relative paths only) */
export function safeReturnPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return '/lobby';
  }
  // Avoid loops to login/register
  if (next.startsWith('/login') || next.startsWith('/register')) {
    return '/lobby';
  }
  return next;
}

export const AUTH_REASONS = {
  matchmaking: COPY.authReasons.matchmaking,
  challenge: COPY.authReasons.challenge,
  bet: COPY.authReasons.bet,
  wallet: COPY.authReasons.wallet,
  mission: COPY.authReasons.mission,
  trade: COPY.authReasons.trade,
  dashboard: COPY.authReasons.dashboard,
} as const;

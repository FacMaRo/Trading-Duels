/** Onboarding / first-run — localStorage state per user */

export const ONBOARDING_STORAGE_PREFIX = 'td_onboarding_';

export interface OnboardingState {
  /** Welcome modal seen or skipped */
  welcomeSeen: boolean;
  /** Checklist fully dismissed */
  checklistDismissed: boolean;
  /** Minimized (still visible as chip) */
  checklistCollapsed: boolean;
}

const DEFAULT_STATE: OnboardingState = {
  welcomeSeen: false,
  checklistDismissed: false,
  checklistCollapsed: false,
};

export function isNewPlayer(user: {
  wins: number;
  losses: number;
  draws: number;
}): boolean {
  return user.wins + user.losses + user.draws === 0;
}

export function loadOnboarding(userId: string): OnboardingState {
  if (typeof window === 'undefined') return { ...DEFAULT_STATE };
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_PREFIX + userId);
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveOnboarding(
  userId: string,
  patch: Partial<OnboardingState>,
): OnboardingState {
  const next = { ...loadOnboarding(userId), ...patch };
  if (typeof window !== 'undefined') {
    localStorage.setItem(
      ONBOARDING_STORAGE_PREFIX + userId,
      JSON.stringify(next),
    );
  }
  return next;
}

export type ChecklistStepId = 'deposit' | 'find_duel' | 'first_duel';

export interface ChecklistStep {
  id: ChecklistStepId;
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
}

export function buildChecklistSteps(ctx: {
  availableBalance: number;
  duelCount: number;
  gamesPlayed: number;
}): ChecklistStep[] {
  return [
    {
      id: 'deposit',
      title: 'Fund your wallet',
      description: 'Deposit at least $10 (simulated) to stake.',
      href: '/wallet',
      cta: 'Go to Wallet',
      done: ctx.availableBalance >= 10,
    },
    {
      id: 'find_duel',
      title: 'Find or create a match',
      description: 'Open the Lobby and find an opponent in seconds.',
      href: '/lobby',
      cta: 'Go to Lobby',
      done: ctx.duelCount > 0 || ctx.gamesPlayed > 0,
    },
    {
      id: 'first_duel',
      title: 'Complete your first match',
      description: 'Highest R-multiple wins.',
      href: '/lobby',
      cta: 'Play now',
      done: ctx.gamesPlayed > 0,
    },
  ];
}

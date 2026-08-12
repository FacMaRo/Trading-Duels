export type RankTone =
  | 'slate'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'cyan'
  | 'violet'
  | 'amber';

export const RANK_TONE_STYLES: Record<
  RankTone,
  { badge: string; text: string; ring: string; bg: string }
> = {
  slate: {
    badge: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
    text: 'text-slate-300',
    ring: 'ring-slate-500/40',
    bg: 'from-slate-500/20 to-transparent',
  },
  bronze: {
    badge: 'border-orange-700/50 bg-orange-900/30 text-orange-300',
    text: 'text-orange-300',
    ring: 'ring-orange-700/40',
    bg: 'from-orange-800/25 to-transparent',
  },
  silver: {
    badge: 'border-slate-300/40 bg-slate-400/10 text-slate-200',
    text: 'text-slate-200',
    ring: 'ring-slate-300/40',
    bg: 'from-slate-300/15 to-transparent',
  },
  gold: {
    badge: 'border-amber-400/50 bg-amber-500/15 text-amber-300',
    text: 'text-amber-300',
    ring: 'ring-amber-400/40',
    bg: 'from-amber-500/20 to-transparent',
  },
  cyan: {
    badge: 'border-cyan-400/50 bg-cyan-500/15 text-cyan-300',
    text: 'text-cyan-300',
    ring: 'ring-cyan-400/40',
    bg: 'from-cyan-500/20 to-transparent',
  },
  violet: {
    badge: 'border-violet-400/50 bg-violet-500/15 text-violet-300',
    text: 'text-violet-300',
    ring: 'ring-violet-400/40',
    bg: 'from-violet-500/20 to-transparent',
  },
  amber: {
    badge: 'border-yellow-300/60 bg-yellow-500/15 text-yellow-200',
    text: 'text-yellow-200',
    ring: 'ring-yellow-300/50',
    bg: 'from-yellow-400/25 to-transparent',
  },
};

/** Mapeo de tier id → tone (espejo del backend) */
export const TIER_TONES: Record<string, RankTone> = {
  NOVICE: 'slate',
  CONTENDER: 'bronze',
  SPECIALIST: 'silver',
  EXPERT: 'gold',
  ELITE: 'cyan',
  MASTER: 'violet',
  LEGEND: 'amber',
};

export function toneForTier(tierId: string): RankTone {
  return TIER_TONES[tierId] ?? 'slate';
}

export function formatAvgR(avgR: number | null | undefined): string {
  if (avgR == null) return '—';
  const sign = avgR > 0 ? '+' : '';
  return `${sign}${avgR.toFixed(2)}R`;
}

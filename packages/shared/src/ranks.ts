/**
 * Ranks competitivos basados en ELO global.
 * Transmite prestigio sin ser "gamified" de casino.
 */

export interface RankTier {
  id: string;
  label: string;
  minElo: number;
  /** Clase de color para UI (tailwind-friendly token) */
  tone: 'slate' | 'bronze' | 'silver' | 'gold' | 'cyan' | 'violet' | 'amber';
}

export const RANK_TIERS: RankTier[] = [
  { id: 'NOVICE', label: 'Novice', minElo: 0, tone: 'slate' },
  { id: 'CONTENDER', label: 'Contender', minElo: 900, tone: 'bronze' },
  { id: 'SPECIALIST', label: 'Specialist', minElo: 1100, tone: 'silver' },
  { id: 'EXPERT', label: 'Expert', minElo: 1300, tone: 'gold' },
  { id: 'ELITE', label: 'Elite', minElo: 1500, tone: 'cyan' },
  { id: 'MASTER', label: 'Master', minElo: 1700, tone: 'violet' },
  { id: 'LEGEND', label: 'Legend', minElo: 1900, tone: 'amber' },
];

export function getRankForElo(elo: number): RankTier {
  let current = RANK_TIERS[0];
  for (const tier of RANK_TIERS) {
    if (elo >= tier.minElo) current = tier;
  }
  return current;
}

export function getNextRank(elo: number): RankTier | null {
  const current = getRankForElo(elo);
  const idx = RANK_TIERS.findIndex((t) => t.id === current.id);
  return RANK_TIERS[idx + 1] ?? null;
}

/** Progreso 0–1 hacia el siguiente rank */
export function rankProgress(elo: number): number {
  const current = getRankForElo(elo);
  const next = getNextRank(elo);
  if (!next) return 1;
  const span = next.minElo - current.minElo;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (elo - current.minElo) / span));
}

export function calcWinrate(wins: number, losses: number, draws = 0): number {
  const total = wins + losses + draws;
  if (total <= 0) return 0;
  return Math.round((wins / total) * 1000) / 10;
}

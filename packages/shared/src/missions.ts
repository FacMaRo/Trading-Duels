/** Constantes y definiciones del sistema de misiones */

/** Stake mínimo para misiones pequeñas */
export const MISSION_SMALL_MIN_STAKE = 3;

/** Stake mínimo para misión grande mensual */
export const MISSION_BIG_MIN_STAKE = 5;

/** % de la comisión de plataforma que va al Pozo de Misiones */
export const MISSION_POOL_FEE_SHARE = 0.1;

/**
 * Tope diario global de recompensas de misiones pequeñas (USD).
 * Rango de diseño $250–$300; usamos $300 como cap operativo.
 */
export const MISSION_SMALL_DAILY_CAP = 300;

/** Cooldown entre claims de la racha de 5 (ms) */
export const STREAK_CLAIM_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

/** Rango de recompensa misión grande */
export const MONTHLY_REWARD_MIN = 25;
export const MONTHLY_REWARD_MAX = 60;

export type MissionTypeId =
  | 'DAILY_WINS_6'
  | 'WEEKLY_WINS_18'
  | 'STREAK_5'
  | 'MONTHLY_WINS_35';

export type MissionCategory = 'SMALL' | 'BIG';

export interface MissionDefinition {
  type: MissionTypeId;
  category: MissionCategory;
  title: string;
  description: string;
  target: number;
  /** Recompensa fija (misiones pequeñas). Mensual se calcula al reclamar. */
  fixedReward: number | null;
  minStake: number;
  period: 'day' | 'week' | 'month' | 'streak';
}

export const MISSION_DEFINITIONS: Record<MissionTypeId, MissionDefinition> = {
  DAILY_WINS_6: {
    type: 'DAILY_WINS_6',
    category: 'SMALL',
    title: '6 wins today',
    description: 'Win 6 matches in the same day (min. stake $3).',
    target: 6,
    fixedReward: 1.5,
    minStake: MISSION_SMALL_MIN_STAKE,
    period: 'day',
  },
  WEEKLY_WINS_18: {
    type: 'WEEKLY_WINS_18',
    category: 'SMALL',
    title: '18 weekly wins',
    description: 'Win 18 matches this week (min. stake $3).',
    target: 18,
    fixedReward: 6,
    minStake: MISSION_SMALL_MIN_STAKE,
    period: 'week',
  },
  STREAK_5: {
    type: 'STREAK_5',
    category: 'SMALL',
    title: '5-win streak',
    description:
      'Win 5 matches in a row (min. stake $3). Max 1 claim every 3 days.',
    target: 5,
    fixedReward: 2,
    minStake: MISSION_SMALL_MIN_STAKE,
    period: 'streak',
  },
  MONTHLY_WINS_35: {
    type: 'MONTHLY_WINS_35',
    category: 'BIG',
    title: '35 wins this month',
    description:
      'Win 35 matches in the calendar month (min. stake $5). Monthly reward unlocks when available ($25–$60).',
    target: 35,
    fixedReward: null,
    minStake: MISSION_BIG_MIN_STAKE,
    period: 'month',
  },
};

export type MissionUiStatus =
  | 'IN_PROGRESS'
  | 'CLAIMABLE'
  | 'CLAIMED'
  | 'PAUSED_DAILY_CAP'
  | 'PAUSED_POOL'
  | 'COOLDOWN';

export interface MissionView {
  type: MissionTypeId;
  category: MissionCategory;
  title: string;
  description: string;
  progress: number;
  target: number;
  progressPct: number;
  rewardLabel: string;
  rewardAmount: number | null;
  status: MissionUiStatus;
  statusMessage: string | null;
  periodKey: string;
  periodLabel: string;
  minStake: number;
  canClaim: boolean;
  cooldownEndsAt: string | null;
}

/**
 * Public missions overview.
 * Intentionally omits pool balance / fee-share / lifetime accounting —
 * only availability + reward ranges for a professional rewards UX.
 */
export interface MissionsOverview {
  /** @deprecated Prefer smallMissionsActive + utilization; kept for compat */
  smallDailyCap?: number;
  smallDailyPaidOut?: number;
  smallDailyRemaining?: number;
  smallMissionsActive: boolean;
  /** 0–100 utilization of daily small-mission claims (no raw $) */
  smallDailyUtilizationPct: number;
  pool: {
    monthlyMinReward: number;
    monthlyMaxReward: number;
    canFundMonthly: boolean;
  };
  missions: MissionView[];
  generatedAt: string;
}

/** Keys de período en UTC */
export function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function monthKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 7);
}

/** ISO week: YYYY-Www */
export function weekKey(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday in current week decides the year
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function periodKeyFor(
  period: MissionDefinition['period'],
  d: Date = new Date(),
): string {
  if (period === 'day') return dayKey(d);
  if (period === 'week') return weekKey(d);
  if (period === 'month') return monthKey(d);
  return 'active';
}

/**
 * Recompensa variable $25–$60 según saldo del pozo.
 * Si pool < 25 → null (pausada).
 * Si 25 ≤ pool < 60 → floor(pool) capped... actually pay min(60, max(25, available))
 * Prefer: if pool >= 60 pay 60; elif pool >= 25 pay max(25, min(60, pool rounded))
 */
export function calcMonthlyReward(poolBalance: number): number | null {
  if (poolBalance < MONTHLY_REWARD_MIN) return null;
  if (poolBalance >= MONTHLY_REWARD_MAX) return MONTHLY_REWARD_MAX;
  // Entre 25 y 60: dar lo que haya redondeado a 2 decimales, mínimo 25
  return Math.round(Math.max(MONTHLY_REWARD_MIN, poolBalance) * 100) / 100;
}

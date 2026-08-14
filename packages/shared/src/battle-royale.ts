/**
 * Battle Royale — constantes, premios y helpers de dominio.
 * Modo único del producto.
 */

export const BR_MAX_PLAYERS = 50;
export const BR_MIN_PLAYERS = 20;
/**
 * Demo-only: minimum *human* players to start the countdown.
 * Bots do not count toward this threshold.
 */
export const BR_DEMO_MIN_HUMANS_TO_START = 1;
/** @deprecated Prefer BR_DEMO_MIN_HUMANS_TO_START — kept as match.minPlayers default for demo */
export const BR_DEMO_MIN_PLAYERS = BR_DEMO_MIN_HUMANS_TO_START;
/** Demo-only: fill queue toward this size (1 human + bots → 50) */
export const BR_DEMO_TARGET_PLAYERS = 50;
export const BR_DEMO_STAKE = 0;
/** Demo bots join stagger (ms between each bot) */
export const BR_DEMO_BOT_JOIN_MS_MIN = 120;
export const BR_DEMO_BOT_JOIN_MS_MAX = 380;
export const BR_COUNTDOWN_SECONDS = 60;
/**
 * When lobby hits max seats, remaining countdown snaps down to this
 * if it was still longer (UI jumps to 0:10 then finishes).
 */
export const BR_FULL_LOBBY_COUNTDOWN_SECONDS = 10;
export const BR_MATCH_DURATION_SECONDS = 10 * 60; // 10 min
/**
 * Post-lock intro before the official 10:00 trading clock.
 * Outside BR_MATCH_DURATION — liveStartedAt is delayed by this many seconds.
 */
export const BR_MATCH_INTRO_SECONDS = 5;

export const BR_VIRTUAL_CAPITAL = 10_000;
export const BR_MAX_TRADES = 2;
export const BR_MAX_RISK_PCT = 2;

/** Stakes permitidos */
export const BR_STAKES = [1, 5, 10] as const;
export type BrStake = (typeof BR_STAKES)[number];

/** Activos permitidos */
export const BR_ASSETS = ['EURUSD', 'NAS100', 'BTCUSD', 'XAUUSD'] as const;
export type BrAsset = (typeof BR_ASSETS)[number];

export const BR_PLATFORM_FEE_RATE = 0.1;

/**
 * Demo pot math / “would have paid” / stake-back amounts when match.stake is 0.
 * Presented as a virtual $5 match for testers.
 */
export const BR_DEMO_DISPLAY_STAKE = 5;

/**
 * Soft cap on a single bot’s final total PnL in demo (virtual capital $10k).
 * Keeps bot winners modest so humans can still finish Top 10.
 */
export const BR_DEMO_BOT_MAX_PNL = 120;
/** Soft floor so bot losses stay believable (not all −$2k) */
export const BR_DEMO_BOT_MIN_PNL = -280;

/** Entrada gratis semanal Premium: solo stake 1 */
export const BR_FREE_ENTRY_STAKE = 1 as const;

// ─── Dynamic prize structure by lobby size ─────────────────────────────────

/** Player-count thresholds for prize / refund tiers */
export const BR_PRIZE_TIER = {
  /** N ≥ this → Top 5 prizes + refund ranks 6–10 */
  LARGE: 40,
  /** N ≥ this (and < LARGE) → Top 5 + refund 6–8 */
  MID: 30,
  /** N ≥ this (and < MID) → Top 3 + refund 4–6 */
  SMALL: 20,
} as const;

/** Strong-prize shares of the pool remaining after refund reserve */
export const BR_STRONG_SHARES_TOP5 = [0.4, 0.24, 0.16, 0.12, 0.08] as const;
export const BR_STRONG_SHARES_TOP3 = [0.5, 0.3, 0.2] as const;

export type BrPrizeZone = 'PRIZE' | 'REFUND' | 'OUT';

export type BrPayoutKind = 'PRIZE' | 'REFUND';

export interface BrRankPayout {
  rank: number;
  kind: BrPayoutKind;
  amount: number;
  /** Share of strong pool (0 for refunds) */
  share: number;
}

export interface BrPrizeStructure {
  playerCount: number;
  stake: number;
  pot: number;
  platformFee: number;
  /** Pool after platform rake (90%) */
  prizePool: number;
  strongCount: number;
  refundFrom: number | null;
  refundTo: number | null;
  refundSlots: number;
  refundReserve: number;
  strongPool: number;
  payouts: BrRankPayout[];
  /** Short footer: "Prize: Top 5 · Stake back: 6–10" */
  footer: string;
  prizeLine: string;
  refundLine: string;
}

/**
 * Effective stake for prize math. Demo with stake 0 uses BR_DEMO_DISPLAY_STAKE
 * so breakdown / settlement amounts remain meaningful.
 */
export function brEffectiveStake(stake: number, isDemo?: boolean): number {
  if (stake > 0) return stake;
  if (isDemo) return BR_DEMO_DISPLAY_STAKE;
  return 0;
}

/**
 * Prize + stake-refund structure by seated player count N.
 * After 10% rake, reserve refund slots × stake, then split remainder to strong places.
 */
export function getBrPrizeStructure(
  playerCount: number,
  stake: number,
): BrPrizeStructure {
  const n = Math.max(0, Math.floor(playerCount));
  const s = Math.max(0, stake);
  const pot = brPot(n, s);
  const platformFee = brPlatformFee(pot);
  const prizePool = brPrizePool(pot);

  let strongCount = 3;
  let refundFrom: number | null = null;
  let refundTo: number | null = null;

  if (n >= BR_PRIZE_TIER.LARGE) {
    strongCount = 5;
    refundFrom = 6;
    refundTo = 10;
  } else if (n >= BR_PRIZE_TIER.MID) {
    strongCount = 5;
    refundFrom = 6;
    refundTo = 8;
  } else if (n >= BR_PRIZE_TIER.SMALL) {
    strongCount = 3;
    refundFrom = 4;
    refundTo = 6;
  } else if (n >= 4) {
    strongCount = Math.min(3, n);
    refundFrom = 4;
    refundTo = 4;
  } else {
    strongCount = Math.min(3, n);
    refundFrom = null;
    refundTo = null;
  }

  // Cap strong/refund to available seats
  strongCount = Math.min(strongCount, n);
  let refundSlots = 0;
  if (refundFrom != null && refundTo != null) {
    refundTo = Math.min(refundTo, n);
    if (refundTo >= refundFrom) {
      refundSlots = refundTo - refundFrom + 1;
    } else {
      refundFrom = null;
      refundTo = null;
      refundSlots = 0;
    }
  }

  // Reserve refunds first; shrink refund band if pool cannot cover
  let refundReserve = round2(refundSlots * s);
  if (s <= 0 || prizePool <= 0) {
    refundSlots = 0;
    refundReserve = 0;
    refundFrom = null;
    refundTo = null;
  } else {
    while (refundSlots > 0 && refundReserve > prizePool + 1e-9) {
      refundSlots -= 1;
      refundReserve = round2(refundSlots * s);
    }
    if (refundSlots === 0) {
      refundFrom = null;
      refundTo = null;
    } else if (refundFrom != null) {
      refundTo = refundFrom + refundSlots - 1;
    }
  }

  const strongPool = round2(Math.max(0, prizePool - refundReserve));
  const shares =
    strongCount >= 5
      ? [...BR_STRONG_SHARES_TOP5]
      : strongCount >= 3
        ? [...BR_STRONG_SHARES_TOP3]
        : strongCount === 2
          ? [0.65, 0.35]
          : strongCount === 1
            ? [1]
            : [];

  const payouts: BrRankPayout[] = [];
  const shareSum = shares.slice(0, strongCount).reduce((a, b) => a + b, 0) || 1;

  for (let i = 0; i < strongCount; i++) {
    const share = shares[i] / shareSum;
    payouts.push({
      rank: i + 1,
      kind: 'PRIZE',
      amount: round2(strongPool * share),
      share,
    });
  }
  // Rounding drift → rank 1
  if (payouts.length && strongPool > 0) {
    const paid = payouts.reduce((a, p) => a + p.amount, 0);
    const drift = round2(strongPool - paid);
    if (Math.abs(drift) >= 0.01) {
      payouts[0].amount = round2(payouts[0].amount + drift);
    }
  }

  if (refundFrom != null && refundSlots > 0) {
    for (let r = refundFrom; r < refundFrom + refundSlots; r++) {
      payouts.push({
        rank: r,
        kind: 'REFUND',
        amount: round2(s),
        share: 0,
      });
    }
  }

  const prizeLine =
    strongCount > 0 ? `Top ${strongCount} win prizes` : 'No prize places';
  const refundLine =
    refundFrom != null && refundTo != null
      ? refundFrom === refundTo
        ? `Place ${refundFrom} gets stake back`
        : `Places ${refundFrom}–${refundTo} get stake back`
      : 'No stake-back places';
  const footer =
    refundFrom != null && refundTo != null
      ? `Prize: Top ${strongCount} · Stake back: ${refundFrom}${refundFrom === refundTo ? '' : `–${refundTo}`}`
      : `Prize: Top ${strongCount}`;

  return {
    playerCount: n,
    stake: s,
    pot,
    platformFee,
    prizePool,
    strongCount,
    refundFrom,
    refundTo,
    refundSlots,
    refundReserve,
    strongPool,
    payouts,
    footer,
    prizeLine,
    refundLine,
  };
}

export function zoneForRank(
  rank: number,
  structure: Pick<BrPrizeStructure, 'strongCount' | 'refundFrom' | 'refundTo'>,
): BrPrizeZone {
  if (rank >= 1 && rank <= structure.strongCount) return 'PRIZE';
  if (
    structure.refundFrom != null &&
    structure.refundTo != null &&
    rank >= structure.refundFrom &&
    rank <= structure.refundTo
  ) {
    return 'REFUND';
  }
  return 'OUT';
}

export function payoutForRank(
  rank: number,
  structure: BrPrizeStructure,
): BrRankPayout | null {
  return structure.payouts.find((p) => p.rank === rank) ?? null;
}

/**
 * Clave de semana ISO en UTC (ej. "2026-W12").
 * La entrada gratis se renueva cada semana calendario UTC.
 */
export function utcIsoWeekKey(date: Date = new Date()): string {
  // ISO week: jueves de la semana determina el año ISO
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Próximo lunes 00:00 UTC (inicio de la siguiente semana ISO simplificado: +1 día tras domingo) */
export function nextUtcWeekStart(date: Date = new Date()): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0 Sun … 6 Sat
  // Días hasta próximo lunes
  const add = day === 0 ? 1 : 8 - day;
  d.setUTCDate(d.getUTCDate() + add);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function daysUntilNextUtcWeek(date: Date = new Date()): number {
  const next = nextUtcWeekStart(date);
  const ms = next.getTime() - date.getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
}

export type BrMatchStatus =
  | 'QUEUE'
  | 'COUNTDOWN'
  | 'LIVE'
  | 'SETTLING'
  | 'COMPLETED'
  | 'CANCELLED';

export function isBrStake(n: number): n is BrStake {
  return (BR_STAKES as readonly number[]).includes(n);
}

export function isBrAsset(s: string): s is BrAsset {
  return (BR_ASSETS as readonly string[]).includes(s.toUpperCase());
}

export function brPot(playerCount: number, stake: number): number {
  return round2(playerCount * stake);
}

export function brPlatformFee(pot: number): number {
  return round2(pot * BR_PLATFORM_FEE_RATE);
}

export function brPrizePool(pot: number): number {
  return round2(pot - brPlatformFee(pot));
}

/** @deprecated Legacy shape — prefer getBrPrizeStructure */
export interface BrPrizePayout {
  rank: number;
  share: number;
  amount: number;
}

/**
 * Legacy helper. Prefer getBrPrizeStructure(N, stake) for full prize + refund math.
 * When stake is provided, uses dynamic structure (strong prizes only in return array).
 */
export function distributeBrPrizes(
  prizePool: number,
  playerCount: number,
  stake = 0,
): BrPrizePayout[] {
  if (stake > 0 && playerCount > 0) {
    const structure = getBrPrizeStructure(playerCount, stake);
    return structure.payouts.map((p) => ({
      rank: p.rank,
      share: p.share,
      amount: p.amount,
    }));
  }
  // No stake: split prizePool across top places only (legacy)
  const strongCount = playerCount >= 30 ? 5 : Math.min(3, playerCount);
  if (strongCount <= 0 || prizePool <= 0) return [];
  const shares =
    strongCount >= 5
      ? [...BR_STRONG_SHARES_TOP5]
      : strongCount >= 3
        ? [...BR_STRONG_SHARES_TOP3]
        : strongCount === 2
          ? [0.65, 0.35]
          : [1];
  const sum = shares.slice(0, strongCount).reduce((a, b) => a + b, 0);
  const out: BrPrizePayout[] = [];
  for (let i = 0; i < strongCount; i++) {
    const share = shares[i] / sum;
    out.push({
      rank: i + 1,
      share,
      amount: round2(prizePool * share),
    });
  }
  const paid = out.reduce((a, p) => a + p.amount, 0);
  const drift = round2(prizePool - paid);
  if (out[0] && Math.abs(drift) >= 0.01) {
    out[0].amount = round2(out[0].amount + drift);
  }
  return out;
}

/** @deprecated Prefer BR_STRONG_SHARES_TOP5 via getBrPrizeStructure */
export const BR_PRIZE_SHARES = {
  1: 0.4,
  2: 0.24,
  3: 0.16,
  4: 0.12,
  5: 0.08,
} as const;

/**
 * Ordena jugadores por profit $ (desc). Empate: mayor tradeCount, luego joinedAt asc.
 */
export function rankBrPlayers<
  T extends {
    totalPnl: number;
    tradeCount: number;
    joinedAt: number | string | Date;
  },
>(players: T[]): T[] {
  return [...players].sort((a, b) => {
    if (b.totalPnl !== a.totalPnl) return b.totalPnl - a.totalPnl;
    if (b.tradeCount !== a.tradeCount) return b.tradeCount - a.tradeCount;
    const ta = new Date(a.joinedAt).getTime();
    const tb = new Date(b.joinedAt).getTime();
    return ta - tb;
  });
}

export function validateBrTradeOpen(params: {
  tradeCount: number;
  totalRiskUsedPct: number;
  riskPct: number;
}): { ok: true } | { ok: false; message: string } {
  if (params.tradeCount >= BR_MAX_TRADES) {
    return {
      ok: false,
      message: `Maximum ${BR_MAX_TRADES} trades per match`,
    };
  }
  if (params.riskPct <= 0 || params.riskPct > BR_MAX_RISK_PCT) {
    return {
      ok: false,
      message: `Risk must be between 0.01% and ${BR_MAX_RISK_PCT}%`,
    };
  }
  if (params.totalRiskUsedPct + params.riskPct > BR_MAX_RISK_PCT + 1e-9) {
    return {
      ok: false,
      message: `Total risk cannot exceed ${BR_MAX_RISK_PCT}%`,
    };
  }
  return { ok: true };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

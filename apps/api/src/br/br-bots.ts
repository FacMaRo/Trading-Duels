/**
 * Demo-only bot helpers — realistic handles, weak-biased trading personalities.
 * Never used for Real Money matches.
 */

import { createHash, randomBytes } from 'crypto';

/** Believable trader handles (not Bot1 / NPC_x) */
export const DEMO_BOT_HANDLES = [
  'apex_tape',
  'london_desk',
  'northwire',
  'delta_fx',
  'nova_charts',
  'silver_edge',
  'pulse_trade',
  'orbit_cap',
  'kite_flow',
  'harbor_fx',
  'ridge_book',
  'cipher_desk',
  'volt_tape',
  'amber_lane',
  'quartz_fx',
  'nimbus_book',
  'helix_trade',
  'cedar_markets',
  'prism_flow',
  'atlas_tape',
  'meridian_fx',
  'cobalt_desk',
  'echo_charts',
  'vector_cap',
  'signal_ridge',
  'folio_north',
  'tide_book',
  'arc_markets',
  'lumen_fx',
  'granite_tape',
  'swift_lane',
  'pioneer_desk',
  'flux_charts',
  'summit_book',
  'relay_fx',
  'orbit_lane',
  'canvas_trade',
  'stride_cap',
  'beacon_fx',
  'iron_tape',
  'night_ledger',
  'parch_fx',
  'drift_book',
  'scalar_desk',
  'ember_tape',
  'frost_lane',
  'quartz_book',
  'polar_fx',
  'cinder_desk',
  'vine_markets',
] as const;

/** Mulberry32 — deterministic per bot/match for stable personalities */
export function seededRng(seed: string): () => number {
  let h = 0;
  const hex = createHash('sha256').update(seed).digest();
  h =
    (hex[0] << 24) |
    (hex[1] << 16) |
    (hex[2] << 8) |
    hex[3];
  return function next() {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBotUsername(used: Set<string>): string {
  const base: string =
    DEMO_BOT_HANDLES[Math.floor(Math.random() * DEMO_BOT_HANDLES.length)];
  let candidate: string = base;
  let n = 0;
  while (used.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${base}${n}`;
    if (n > 20) {
      candidate = `${base}_${randomBytes(2).toString('hex')}`;
      break;
    }
  }
  return candidate.slice(0, 24);
}

export function botEmail(username: string): string {
  return `bot_${username.toLowerCase()}_${randomBytes(3).toString('hex')}@bot.local`;
}

/**
 * Skill tiers — majority weak/flat so humans can place Top 10.
 * ~18% idle · ~37% weak · ~27% loser · ~13% small win · ~5% medium win
 */
export type BotSkillTier =
  | 'idle'
  | 'weak'
  | 'loser'
  | 'small_win'
  | 'medium_win';

export function botSkillTier(matchId: string, userId: string): BotSkillTier {
  const rng = seededRng(`${matchId}:${userId}:tier`);
  const r = rng();
  if (r < 0.18) return 'idle';
  if (r < 0.55) return 'weak';
  if (r < 0.82) return 'loser';
  if (r < 0.95) return 'small_win';
  return 'medium_win';
}

export type BotPersonality = {
  tier: BotSkillTier;
  /** Planned market trades this match: 0–2 */
  plannedTrades: number;
  /** Match progress fractions (0–1) when each trade should open */
  openAt: number[];
  /** Bias toward LONG (>0.5) or SHORT */
  longBias: number;
  /** Typical risk % per trade (kept low for modest PnL) */
  riskPct: number;
  /** SL distance as fraction of price — tight ⇒ more stop-outs */
  slFrac: number;
  /** Chance to set TP */
  tpChance: number;
  /** TP distance multiple of SL distance (smaller = smaller wins) */
  tpMult: number;
  /** Chance per tick to early-close an open trade */
  earlyCloseChance: number;
  /** Soft cap on cumulative PnL for this bot (demo) */
  maxPnl: number;
  minPnl: number;
};

export function botPersonality(
  matchId: string,
  userId: string,
): BotPersonality {
  const tier = botSkillTier(matchId, userId);
  const rng = seededRng(`${matchId}:${userId}:persona`);

  const openAtFor = (n: number): number[] => {
    const openAt: number[] = [];
    for (let i = 0; i < n; i++) {
      // Weaker bots trade later / choppier; winners a bit earlier
      const base =
        tier === 'small_win' || tier === 'medium_win'
          ? 0.1 + rng() * 0.45
          : 0.15 + rng() * 0.65;
      openAt.push(Math.min(0.88, base + i * 0.08));
    }
    return openAt.sort((a, b) => a - b);
  };

  switch (tier) {
    case 'idle':
      return {
        tier,
        plannedTrades: 0,
        openAt: [],
        longBias: 0.5,
        riskPct: 0.3,
        slFrac: 0.001,
        tpChance: 0,
        tpMult: 1,
        earlyCloseChance: 0,
        maxPnl: 20,
        minPnl: -20,
      };
    case 'weak':
      // Often flat or small red — tight SL, low risk, choppy closes
      return {
        tier,
        plannedTrades: rng() < 0.35 ? 0 : 1,
        openAt: openAtFor(1),
        longBias: 0.4 + rng() * 0.2,
        riskPct: Math.round((0.25 + rng() * 0.35) * 100) / 100, // 0.25–0.6
        slFrac: 0.0005 + rng() * 0.0012, // tight
        tpChance: 0.15,
        tpMult: 0.6 + rng() * 0.5,
        earlyCloseChance: 0.04 + rng() * 0.04,
        maxPnl: 45,
        minPnl: -90,
      };
    case 'loser':
      // Clear red bias via tight SL + higher risk of stop + frequent early exit
      return {
        tier,
        plannedTrades: rng() < 0.4 ? 1 : 2,
        openAt: openAtFor(rng() < 0.4 ? 1 : 2),
        longBias: 0.35 + rng() * 0.3,
        riskPct: Math.round((0.4 + rng() * 0.55) * 100) / 100, // 0.4–0.95
        slFrac: 0.0004 + rng() * 0.0009, // very tight → stop-outs
        tpChance: 0.08,
        tpMult: 1.5 + rng(),
        earlyCloseChance: 0.05 + rng() * 0.05,
        maxPnl: 30,
        minPnl: -220,
      };
    case 'small_win':
      // Modest green — low risk, take profit closer, wider SL
      return {
        tier,
        plannedTrades: 1,
        openAt: openAtFor(1),
        longBias: 0.42 + rng() * 0.16,
        riskPct: Math.round((0.3 + rng() * 0.35) * 100) / 100, // 0.3–0.65
        slFrac: 0.0012 + rng() * 0.002,
        tpChance: 0.85,
        tpMult: 0.7 + rng() * 0.5, // ~0.7–1.2R
        earlyCloseChance: 0.01,
        maxPnl: 85,
        minPnl: -60,
      };
    case 'medium_win':
      // Rare slightly better winner — still capped
      return {
        tier,
        plannedTrades: rng() < 0.3 ? 2 : 1,
        openAt: openAtFor(rng() < 0.3 ? 2 : 1),
        longBias: 0.4 + rng() * 0.2,
        riskPct: Math.round((0.45 + rng() * 0.4) * 100) / 100, // 0.45–0.85
        slFrac: 0.0015 + rng() * 0.0025,
        tpChance: 0.9,
        tpMult: 1.0 + rng() * 0.6,
        earlyCloseChance: 0.008,
        maxPnl: 120,
        minPnl: -80,
      };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function botJoinDelayMs(min: number, max: number): number {
  return min + Math.floor(Math.random() * Math.max(1, max - min));
}

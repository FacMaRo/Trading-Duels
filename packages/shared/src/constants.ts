/** Comisión de la plataforma sobre el pot final */
export const PLATFORM_FEE_RATE = 0.1;

/** Depósito y retiro mínimos (USD) */
export const MIN_DEPOSIT_USD = 10;
export const MIN_WITHDRAWAL_USD = 20;

/** Capital virtual por duelo (mismo para ambos jugadores) */
export const VIRTUAL_CAPITAL = 100_000;

/** Tiempo de respuesta a una subida de apuesta (ms) */
export const RAISE_RESPONSE_TIMEOUT_MS = 40_000;

/** Incremento mínimo de subida: > 10% del stake actual */
export const MIN_RAISE_RATIO = 0.1;

/** ELO inicial para nuevos jugadores */
export const INITIAL_ELO = 1000;

/** K-factor ELO por defecto */
export const ELO_K_FACTOR = 32;

/** Tolerancia de matchmaking ELO (suave) */
export const MATCHMAKING_ELO_RANGE = 200;

export const DUEL_MODE_CONFIG = {
  BLITZ: {
    label: 'Blitz',
    prepSeconds: 2 * 60,
    developSeconds: 8 * 60,
    maxTrades: 2,
    maxTotalRiskPct: 3,
    maxRaises: 2,
  },
  NORMAL: {
    label: 'Normal',
    prepSeconds: 5 * 60,
    developSeconds: 15 * 60,
    maxTrades: 3,
    maxTotalRiskPct: 4,
    maxRaises: 3,
  },
  SLOW: {
    label: 'Slow',
    prepSeconds: 30 * 60,
    developSeconds: 2 * 60 * 60,
    maxTrades: 5,
    maxTotalRiskPct: 5,
    maxRaises: 5,
  },
} as const;

export type DuelModeKey = keyof typeof DUEL_MODE_CONFIG;

export const ASSETS = {
  FOREX: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF'] as const,
  INDICES: ['NAS100', 'US30', 'SPX500'] as const,
  METALS: ['XAUUSD'] as const,
  CRYPTO: ['BTCUSD', 'ETHUSD'] as const,
} as const;

export const ALL_ASSETS = [
  ...ASSETS.FOREX,
  ...ASSETS.INDICES,
  ...ASSETS.METALS,
  ...ASSETS.CRYPTO,
] as const;

export type AssetSymbol = (typeof ALL_ASSETS)[number];

export const CHART_TIMEFRAMES = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
] as const;

export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number];

export const SLOW_SESSION_WINDOWS = ['TOKYO', 'LONDON', 'NY'] as const;
export type SlowSessionWindow = (typeof SLOW_SESSION_WINDOWS)[number];

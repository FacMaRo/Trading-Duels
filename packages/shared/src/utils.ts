import {
  ELO_K_FACTOR,
  MIN_RAISE_RATIO,
  PLATFORM_FEE_RATE,
  VIRTUAL_CAPITAL,
} from './constants';

/** Redondeo monetario a 2 decimales */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Redondeo de R a 4 decimales */
export function roundR(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function calcPlatformFee(pot: number): number {
  return roundMoney(pot * PLATFORM_FEE_RATE);
}

export function calcWinnerPrize(pot: number): number {
  return roundMoney(pot - calcPlatformFee(pot));
}

export function calcRiskAmount(riskPct: number, capital = VIRTUAL_CAPITAL): number {
  return roundMoney((riskPct / 100) * capital);
}

/**
 * Tamaño de posición en unidades a partir del riesgo y distancia al SL.
 * riskAmount / |entry - stopLoss|
 */
export function calcPositionSize(
  riskAmount: number,
  entryPrice: number,
  stopLoss: number,
): number {
  const distance = Math.abs(entryPrice - stopLoss);
  if (distance <= 0) return 0;
  return riskAmount / distance;
}

/**
 * R-múltiplo de un trade cerrado.
 * LONG:  (exit - entry) / (entry - stopLoss)
 * SHORT: (entry - exit) / (stopLoss - entry)
 * Limit no activada → 0R
 */
export function calcRMultiple(params: {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
}): number {
  const { side, entryPrice, exitPrice, stopLoss } = params;
  const riskDistance =
    side === 'LONG'
      ? entryPrice - stopLoss
      : stopLoss - entryPrice;

  if (riskDistance <= 0) {
    throw new Error('Stop loss inválido respecto al entry y side');
  }

  const pnlDistance =
    side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;

  return roundR(pnlDistance / riskDistance);
}

export function calcPnlFromR(rMultiple: number, riskAmount: number): number {
  return roundMoney(rMultiple * riskAmount);
}

/** Valida que la subida sea > 10% del stake actual */
export function isValidRaise(currentStake: number, newStake: number): boolean {
  if (newStake <= currentStake) return false;
  const minRequired = currentStake * (1 + MIN_RAISE_RATIO);
  // Debe ser estrictamente mayor al 10%
  return newStake > minRequired || Math.abs(newStake - minRequired) < 1e-9
    ? newStake >= minRequired + 0.01 || newStake > currentStake * (1 + MIN_RAISE_RATIO)
    : false;
}

/**
 * Regla: la subida debe ser mayor al 10% del stake actual.
 * newStake > currentStake * 1.10
 */
export function validateRaiseAmount(
  currentStake: number,
  newStake: number,
): { ok: true } | { ok: false; message: string; minStake: number } {
  const minStake = roundMoney(currentStake * (1 + MIN_RAISE_RATIO) + 0.01);
  // "mayor al 10%" → estrictamente > current * 1.1
  const threshold = currentStake * (1 + MIN_RAISE_RATIO);
  if (newStake <= threshold) {
    return {
      ok: false,
      message: `La subida debe ser mayor al 10% del stake actual (mín. > ${roundMoney(threshold)})`,
      minStake,
    };
  }
  return { ok: true };
}

/**
 * Desempate: mayor R gana; si empate en R, mayor profit absoluto.
 * Devuelve winner userId o null si empate total.
 */
export function resolveWinner(params: {
  playerAId: string;
  playerBId: string;
  aR: number;
  bR: number;
  aPnl: number;
  bPnl: number;
}): string | null {
  const { playerAId, playerBId, aR, bR, aPnl, bPnl } = params;
  if (aR > bR) return playerAId;
  if (bR > aR) return playerBId;
  if (aPnl > bPnl) return playerAId;
  if (bPnl > aPnl) return playerBId;
  return null;
}

/** Actualización ELO clásica (expected score) */
export function calcNewElo(
  ratingA: number,
  ratingB: number,
  scoreA: 0 | 0.5 | 1,
  k = ELO_K_FACTOR,
): { eloA: number; eloB: number } {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;
  const scoreB = (1 - scoreA) as 0 | 0.5 | 1;
  return {
    eloA: Math.round(ratingA + k * (scoreA - expectedA)),
    eloB: Math.round(ratingB + k * (scoreB - expectedB)),
  };
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function isAssetSymbol(value: string): boolean {
  const assets = [
    'EURUSD',
    'GBPUSD',
    'USDJPY',
    'AUDUSD',
    'USDCAD',
    'USDCHF',
    'NAS100',
    'US30',
    'SPX500',
    'XAUUSD',
    'BTCUSD',
    'ETHUSD',
  ];
  return assets.includes(value);
}

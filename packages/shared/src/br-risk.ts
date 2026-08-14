/**
 * Battle Royale fixed-size risk model.
 *
 * On open: freeze originalStopLoss, originalRiskAmount (riskAmount), positionSize.
 * SL edits change reservedRiskAmount proportionally to stop distance;
 * PnL always uses fixed size × price move (1R $ does not reset with new SL).
 */

import { BR_MAX_RISK_PCT, BR_VIRTUAL_CAPITAL } from './battle-royale';
import { calcPositionSize, roundMoney, roundR } from './utils';

export type BrSide = 'LONG' | 'SHORT';

export function brRiskAmountFromPct(
  riskPct: number,
  capital = BR_VIRTUAL_CAPITAL,
): number {
  return roundMoney((riskPct / 100) * capital);
}

export function brRiskPctFromAmount(
  amount: number,
  capital = BR_VIRTUAL_CAPITAL,
): number {
  if (!(capital > 0)) return 0;
  return Math.round((amount / capital) * 10000) / 100; // 2 decimal pct
}

/** Absolute price distance entry ↔ stop (valid SL side assumed). */
export function brStopDistance(
  side: BrSide,
  entryPrice: number,
  stopLoss: number,
): number {
  const d =
    side === 'LONG' ? entryPrice - stopLoss : stopLoss - entryPrice;
  return d > 0 ? d : Math.abs(entryPrice - stopLoss);
}

export function brFreezeOpenRisk(params: {
  side: BrSide;
  entryPrice: number;
  stopLoss: number;
  riskPct: number;
  capital?: number;
}): {
  originalRiskAmount: number;
  originalStopLoss: number;
  positionSize: number;
  reservedRiskAmount: number;
  riskPct: number;
} {
  const capital = params.capital ?? BR_VIRTUAL_CAPITAL;
  const originalRiskAmount = brRiskAmountFromPct(params.riskPct, capital);
  const originalStopLoss = params.stopLoss;
  const positionSize = calcPositionSize(
    originalRiskAmount,
    params.entryPrice,
    originalStopLoss,
  );
  return {
    originalRiskAmount,
    originalStopLoss,
    positionSize,
    reservedRiskAmount: originalRiskAmount,
    riskPct: params.riskPct,
  };
}

/**
 * Required $ reserved for a given SL with fixed size:
 * newRequired = originalRisk * (newDist / originalDist)
 */
export function brRequiredRiskForStop(params: {
  side: BrSide;
  entryPrice: number;
  originalStopLoss: number;
  originalRiskAmount: number;
  newStopLoss: number;
}): number {
  const origDist = brStopDistance(
    params.side,
    params.entryPrice,
    params.originalStopLoss,
  );
  const newDist = brStopDistance(
    params.side,
    params.entryPrice,
    params.newStopLoss,
  );
  if (!(origDist > 0)) return params.originalRiskAmount;
  return roundMoney(params.originalRiskAmount * (newDist / origDist));
}

export function brRemainingRiskAmount(params: {
  totalRiskUsedPct: number;
  maxRiskPct?: number;
  capital?: number;
}): number {
  const maxPct = params.maxRiskPct ?? BR_MAX_RISK_PCT;
  const capital = params.capital ?? BR_VIRTUAL_CAPITAL;
  const used = Math.max(0, params.totalRiskUsedPct);
  const leftPct = Math.max(0, maxPct - used);
  return brRiskAmountFromPct(leftPct, capital);
}

/** PnL $ with fixed position size (mark-to-market or realized). */
export function brPnlUsdFixedSize(params: {
  side: BrSide;
  entryPrice: number;
  exitPrice: number;
  positionSize: number;
}): number {
  const { side, entryPrice, exitPrice, positionSize } = params;
  if (!(positionSize > 0)) return 0;
  const raw =
    side === 'LONG'
      ? (exitPrice - entryPrice) * positionSize
      : (entryPrice - exitPrice) * positionSize;
  return roundMoney(raw);
}

/** Display R = pnl$ / originalRiskAmount (1R $ never resets with SL). */
export function brRFromPnl(
  pnlUsd: number,
  originalRiskAmount: number,
): number {
  if (!(originalRiskAmount > 1e-9)) return 0;
  return roundR(pnlUsd / originalRiskAmount);
}

export function scoreBrTradeFixedSize(params: {
  side: BrSide;
  entryPrice: number;
  exitPrice: number;
  positionSize: number;
  originalRiskAmount: number;
}): { pnl: number; rMultiple: number } {
  const pnl = brPnlUsdFixedSize(params);
  return {
    pnl,
    rMultiple: brRFromPnl(pnl, params.originalRiskAmount),
  };
}

/**
 * Validate SL widen against remaining match budget.
 * remainingBudget must exclude this trade's current reserved (caller passes free budget).
 */
export function brValidateSlRiskChange(params: {
  side: BrSide;
  entryPrice: number;
  originalStopLoss: number;
  originalRiskAmount: number;
  currentReserved: number;
  newStopLoss: number;
  /** Match risk left in $ besides this trade's current reserved */
  freeRiskBudget: number;
}):
  | {
      ok: true;
      newReserved: number;
      deltaReserved: number;
      tightened: boolean;
      widened: boolean;
    }
  | { ok: false; message: string } {
  const newReserved = brRequiredRiskForStop({
    side: params.side,
    entryPrice: params.entryPrice,
    originalStopLoss: params.originalStopLoss,
    originalRiskAmount: params.originalRiskAmount,
    newStopLoss: params.newStopLoss,
  });
  const delta = roundMoney(newReserved - params.currentReserved);
  if (delta > 1e-9 && delta > params.freeRiskBudget + 1e-9) {
    return {
      ok: false,
      message: 'Not enough risk left to widen SL',
    };
  }
  return {
    ok: true,
    newReserved,
    deltaReserved: delta,
    tightened: delta < -1e-9,
    widened: delta > 1e-9,
  };
}

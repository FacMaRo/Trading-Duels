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

/** Normalize side string from API / client */
export function normalizeBrSide(side: string): BrSide {
  return String(side).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
}

/**
 * OPEN trade SL edit: direction vs current mid only.
 * Entry is NOT a barrier — break-even / profit SL is allowed.
 * Example: LONG entry 100, mid 105, SL 102 → OK.
 */
export function validateOpenTradeStopLoss(
  side: BrSide | string,
  stopLoss: number,
  mid: number,
): { ok: true } | { ok: false; message: string } {
  const s = normalizeBrSide(String(side));
  if (!(mid > 0) || !Number.isFinite(mid)) {
    return {
      ok: false,
      message: 'No market price available to validate stop loss',
    };
  }
  if (!(stopLoss > 0) || !Number.isFinite(stopLoss)) {
    return { ok: false, message: 'Stop loss is required' };
  }
  // LONG: SL must be strictly below mid (may be above entry)
  if (s === 'LONG') {
    if (!(stopLoss < mid)) {
      return {
        ok: false,
        message: 'Stop loss must be below current price for LONG',
      };
    }
    return { ok: true };
  }
  // SHORT: SL must be strictly above mid (may be below entry)
  if (!(stopLoss > mid)) {
    return {
      ok: false,
      message: 'Stop loss must be above current price for SHORT',
    };
  }
  return { ok: true };
}

/** OPEN trade TP edit: vs current mid only. */
export function validateOpenTradeTakeProfit(
  side: BrSide | string,
  takeProfit: number,
  mid: number,
): { ok: true } | { ok: false; message: string } {
  const s = normalizeBrSide(String(side));
  if (!(mid > 0) || !Number.isFinite(mid)) {
    return {
      ok: false,
      message: 'No market price available to validate take profit',
    };
  }
  if (!(takeProfit > 0) || !Number.isFinite(takeProfit)) {
    return { ok: false, message: 'Invalid take profit' };
  }
  if (s === 'LONG') {
    if (!(takeProfit > mid)) {
      return {
        ok: false,
        message: 'Take profit must be above current price for LONG',
      };
    }
    return { ok: true };
  }
  if (!(takeProfit < mid)) {
    return {
      ok: false,
      message: 'Take profit must be below current price for SHORT',
    };
  }
  return { ok: true };
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

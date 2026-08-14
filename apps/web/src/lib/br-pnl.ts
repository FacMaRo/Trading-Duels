import { calcPnlFromR, calcRMultiple } from '@trading-duels/shared';

/**
 * Unrealized mark-to-market PnL in $ for an OPEN BR trade.
 * Uses the same R-multiple × riskAmount formula as server settlement
 * (scoreClosedTrade), with live mid as exit.
 */
export function unrealizedTradePnlUsd(params: {
  side: 'LONG' | 'SHORT' | string;
  entryPrice: number | null | undefined;
  stopLoss: number;
  riskAmount: number;
  mid: number;
}): number | null {
  const { entryPrice, stopLoss, riskAmount, mid } = params;
  if (
    entryPrice == null ||
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(mid) ||
    mid <= 0 ||
    !Number.isFinite(stopLoss) ||
    !Number.isFinite(riskAmount) ||
    riskAmount <= 0
  ) {
    return null;
  }
  const side = params.side === 'SHORT' ? 'SHORT' : 'LONG';
  try {
    const rMultiple = calcRMultiple({
      side,
      entryPrice,
      exitPrice: mid,
      stopLoss,
    });
    return calcPnlFromR(rMultiple, riskAmount);
  } catch {
    return null;
  }
}

/** Optional R-multiple for display next to live PnL */
export function unrealizedTradeR(params: {
  side: 'LONG' | 'SHORT' | string;
  entryPrice: number | null | undefined;
  stopLoss: number;
  mid: number;
}): number | null {
  const { entryPrice, stopLoss, mid } = params;
  if (
    entryPrice == null ||
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(mid) ||
    mid <= 0 ||
    !Number.isFinite(stopLoss)
  ) {
    return null;
  }
  const side = params.side === 'SHORT' ? 'SHORT' : 'LONG';
  try {
    return calcRMultiple({
      side,
      entryPrice,
      exitPrice: mid,
      stopLoss,
    });
  } catch {
    return null;
  }
}

import {
  brPnlUsdFixedSize,
  brRFromPnl,
  calcPositionSize,
} from '@trading-duels/shared';

/**
 * Unrealized mark-to-market PnL in $ for an OPEN BR trade.
 * Fixed position size × price move (1R $ = originalRiskAmount / riskAmount at open).
 * Current SL does NOT redefine 1R.
 */
export function unrealizedTradePnlUsd(params: {
  side: 'LONG' | 'SHORT' | string;
  entryPrice: number | null | undefined;
  /** @deprecated not used for $ PnL; kept for call-site compat */
  stopLoss?: number;
  /** Original risk $ at open (1R reference) */
  riskAmount: number;
  /** Fixed size; if missing, derived from originalStopLoss + riskAmount */
  positionSize?: number | null;
  originalStopLoss?: number | null;
  mid: number;
}): number | null {
  const { entryPrice, riskAmount, mid } = params;
  if (
    entryPrice == null ||
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(mid) ||
    mid <= 0 ||
    !Number.isFinite(riskAmount) ||
    riskAmount <= 0
  ) {
    return null;
  }
  const side = params.side === 'SHORT' ? 'SHORT' : 'LONG';
  let size = params.positionSize ?? 0;
  if (!(size > 0)) {
    const origSl =
      params.originalStopLoss != null && params.originalStopLoss > 0
        ? params.originalStopLoss
        : params.stopLoss;
    if (origSl == null || !(origSl > 0)) return null;
    size = calcPositionSize(riskAmount, entryPrice, origSl);
  }
  if (!(size > 0)) return null;
  return brPnlUsdFixedSize({
    side,
    entryPrice,
    exitPrice: mid,
    positionSize: size,
  });
}

/** Display R = pnl$ / originalRiskAmount (does not reset when SL moves) */
export function unrealizedTradeR(params: {
  side: 'LONG' | 'SHORT' | string;
  entryPrice: number | null | undefined;
  stopLoss?: number;
  riskAmount: number;
  positionSize?: number | null;
  originalStopLoss?: number | null;
  mid: number;
}): number | null {
  const pnl = unrealizedTradePnlUsd(params);
  if (pnl == null) return null;
  if (!(params.riskAmount > 0)) return null;
  return brRFromPnl(pnl, params.riskAmount);
}

/** Arena UI helpers */

export const MODE_MAX_RISK: Record<string, number> = {
  BLITZ: 3,
  NORMAL: 4,
  SLOW: 5,
};

export const MODE_MAX_TRADES: Record<string, number> = {
  BLITZ: 2,
  NORMAL: 3,
  SLOW: 5,
};

export const MODE_MAX_RAISES: Record<string, number> = {
  BLITZ: 2,
  NORMAL: 3,
  SLOW: 5,
};

export const ASSETS = [
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
] as const;

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h'] as const;

export type TradeUiStatus =
  | 'PENDING'
  | 'FILLED'
  | 'STOPPED'
  | 'TAKE_PROFIT'
  | 'CLOSED'
  | 'EXPIRED'
  | 'CANCELLED';

export function tradeUiStatus(trade: {
  status: string;
  closeReason?: string | null;
}): TradeUiStatus {
  if (trade.status === 'PENDING') return 'PENDING';
  if (trade.status === 'OPEN') return 'FILLED';
  if (trade.status === 'EXPIRED') return 'EXPIRED';
  if (trade.status === 'CANCELLED') return 'CANCELLED';
  if (trade.status === 'CLOSED') {
    if (trade.closeReason === 'SL') return 'STOPPED';
    if (trade.closeReason === 'TP') return 'TAKE_PROFIT';
    return 'CLOSED';
  }
  return 'CLOSED';
}

export function tradeStatusLabel(status: TradeUiStatus): string {
  const map: Record<TradeUiStatus, string> = {
    PENDING: 'Pending',
    FILLED: 'Open',
    STOPPED: 'Stopped',
    TAKE_PROFIT: 'Take Profit',
    CLOSED: 'Closed',
    EXPIRED: 'Expired 0R',
    CANCELLED: 'Cancelled',
  };
  return map[status];
}

export function phaseLabel(status: string): string {
  const map: Record<string, string> = {
    WAITING: 'Waiting',
    MATCHED: 'Matched — Ready',
    PREPARATION: 'Preparation',
    DEVELOPMENT: 'Live',
    SETTLING: 'Settling',
    COMPLETED: 'Completed',
    DRAW: 'Draw',
    CANCELLED: 'Cancelled',
  };
  return map[status] ?? status;
}

export function isUrgentMs(ms: number): boolean {
  return ms > 0 && ms <= 60_000;
}

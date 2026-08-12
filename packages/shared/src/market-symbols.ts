import type { AssetSymbol } from './constants';
import { ALL_ASSETS } from './constants';

/**
 * Mapeo de símbolos internos → Twelve Data.
 * Forex/metales/crypto usan notación con slash.
 * Índices usan tickers estándar de Twelve Data.
 */
export const TWELVE_DATA_SYMBOL_MAP: Record<AssetSymbol, string> = {
  EURUSD: 'EUR/USD',
  GBPUSD: 'GBP/USD',
  USDJPY: 'USD/JPY',
  AUDUSD: 'AUD/USD',
  USDCAD: 'USD/CAD',
  USDCHF: 'USD/CHF',
  NAS100: 'NDX', // NASDAQ-100
  US30: 'DJI', // Dow Jones Industrial Average
  SPX500: 'SPX', // S&P 500
  XAUUSD: 'XAU/USD',
  BTCUSD: 'BTC/USD',
  ETHUSD: 'ETH/USD',
};

/** Spread estimado en basis points cuando el feed no trae bid/ask */
export const DEFAULT_SPREAD_BPS: Record<AssetSymbol, number> = {
  EURUSD: 1.0,
  GBPUSD: 1.2,
  USDJPY: 1.0,
  AUDUSD: 1.5,
  USDCAD: 1.5,
  USDCHF: 1.5,
  NAS100: 3.0,
  US30: 3.0,
  SPX500: 2.0,
  XAUUSD: 2.0,
  BTCUSD: 5.0,
  ETHUSD: 8.0,
};

const REVERSE_MAP = new Map<string, AssetSymbol>(
  (Object.entries(TWELVE_DATA_SYMBOL_MAP) as [AssetSymbol, string][]).map(
    ([internal, external]) => [external.toUpperCase(), internal],
  ),
);

// También aceptar variantes sin slash
for (const asset of ALL_ASSETS) {
  REVERSE_MAP.set(asset.toUpperCase(), asset);
}

export function toTwelveDataSymbol(asset: AssetSymbol | string): string {
  const key = asset.toUpperCase() as AssetSymbol;
  return TWELVE_DATA_SYMBOL_MAP[key] ?? asset;
}

export function fromTwelveDataSymbol(symbol: string): AssetSymbol | null {
  const normalized = symbol.trim().toUpperCase();
  return REVERSE_MAP.get(normalized) ?? null;
}

export function isKnownAsset(value: string): value is AssetSymbol {
  return (ALL_ASSETS as readonly string[]).includes(value);
}

/** Intervalos Twelve Data REST time_series */
export const TIMEFRAME_TO_TD_INTERVAL: Record<string, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1day',
};

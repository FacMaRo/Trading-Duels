import { Logger } from '@nestjs/common';
import {
  TIMEFRAME_TO_TD_INTERVAL,
  toTwelveDataSymbol,
  type AssetSymbol,
} from '@trading-duels/shared';

export interface TdCandle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

const BASE_URL = 'https://api.twelvedata.com';

/**
 * Cliente REST de Twelve Data para time_series y price snapshot.
 */
export class TwelveDataRest {
  private readonly logger = new Logger(TwelveDataRest.name);

  constructor(private readonly apiKey: string) {}

  get hasKey(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchCandles(
    asset: AssetSymbol,
    timeframe: string,
    count = 120,
  ): Promise<TdCandle[]> {
    if (!this.apiKey) return [];

    const symbol = toTwelveDataSymbol(asset);
    const interval = TIMEFRAME_TO_TD_INTERVAL[timeframe] ?? '1min';
    const outputsize = Math.min(Math.max(count, 1), 500);

    const url = new URL(`${BASE_URL}/time_series`);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('outputsize', String(outputsize));
    url.searchParams.set('order', 'ASC');
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('apikey', this.apiKey);

    try {
      const res = await fetch(url.toString());
      const data = (await res.json()) as {
        status?: string;
        code?: number;
        message?: string;
        values?: Array<{
          datetime: string;
          open: string;
          high: string;
          low: string;
          close: string;
        }>;
      };

      if (data.status === 'error' || !data.values?.length) {
        this.logger.warn(
          `time_series ${symbol}: ${data.message ?? 'sin datos'}`,
        );
        return [];
      }

      return data.values.map((v) => {
        // datetime "YYYY-MM-DD HH:mm:ss" en UTC
        const ts = Math.floor(new Date(v.datetime.replace(' ', 'T') + 'Z').getTime() / 1000);
        return {
          time: ts,
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close),
        };
      }).filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close));
    } catch (err) {
      this.logger.error(
        `Error fetchCandles ${symbol}: ${err instanceof Error ? err.message : err}`,
      );
      return [];
    }
  }

  /** Precio actual REST (fallback / bootstrap) */
  async fetchPrice(asset: AssetSymbol): Promise<number | null> {
    if (!this.apiKey) return null;

    const symbol = toTwelveDataSymbol(asset);
    const url = new URL(`${BASE_URL}/price`);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('apikey', this.apiKey);

    try {
      const res = await fetch(url.toString());
      const data = (await res.json()) as { price?: string; message?: string };
      if (!data.price) {
        this.logger.warn(`price ${symbol}: ${data.message ?? 'sin precio'}`);
        return null;
      }
      const n = parseFloat(data.price);
      return Number.isFinite(n) ? n : null;
    } catch (err) {
      this.logger.error(
        `Error fetchPrice ${symbol}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /** Quote con bid/ask cuando esté disponible */
  async fetchQuote(asset: AssetSymbol): Promise<{
    mid: number;
    bid?: number;
    ask?: number;
  } | null> {
    if (!this.apiKey) return null;

    const symbol = toTwelveDataSymbol(asset);
    const url = new URL(`${BASE_URL}/quote`);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('apikey', this.apiKey);

    try {
      const res = await fetch(url.toString());
      const data = (await res.json()) as {
        close?: string;
        bid?: string;
        ask?: string;
        message?: string;
        status?: string;
      };
      if (data.status === 'error' || !data.close) {
        return null;
      }
      const mid = parseFloat(data.close);
      if (!Number.isFinite(mid)) return null;
      return {
        mid,
        bid: data.bid != null ? parseFloat(data.bid) : undefined,
        ask: data.ask != null ? parseFloat(data.ask) : undefined,
      };
    } catch {
      return null;
    }
  }
}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ALL_ASSETS,
  DEFAULT_SPREAD_BPS,
  fromTwelveDataSymbol,
  toTwelveDataSymbol,
  type AssetSymbol,
  type PriceTick,
} from '@trading-duels/shared';
import { TwelveDataClient, type TwelveDataPriceEvent } from './twelve-data.client';
import { TwelveDataRest } from './twelve-data.rest';

/** Precios base solo para fallback mock / bootstrap sin red */
const BASE_PRICES: Record<AssetSymbol, number> = {
  EURUSD: 1.085,
  GBPUSD: 1.265,
  USDJPY: 149.5,
  AUDUSD: 0.655,
  USDCAD: 1.36,
  USDCHF: 0.88,
  NAS100: 18_500,
  US30: 39_000,
  SPX500: 5_200,
  XAUUSD: 2_350,
  BTCUSD: 65_000,
  ETHUSD: 3_400,
};

export type PriceListener = (
  asset: AssetSymbol,
  tick: PriceTick & { ts: number },
) => void;

export type MarketMode = 'twelve_data' | 'mock';

export interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

@Injectable()
export class MarketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketService.name);

  private readonly prices = new Map<AssetSymbol, number>();
  private readonly bids = new Map<AssetSymbol, number>();
  private readonly asks = new Map<AssetSymbol, number>();
  private readonly lastTs = new Map<AssetSymbol, number>();
  private readonly listeners = new Set<PriceListener>();

  /**
   * Refcount de demanda por activo interno.
   * Fuentes: duelos activos (trades) + viewers de chart en socket.
   */
  private readonly demand = new Map<AssetSymbol, number>();

  private client: TwelveDataClient | null = null;
  private rest: TwelveDataRest | null = null;
  private mockTimer: NodeJS.Timeout | null = null;
  private mode: MarketMode = 'mock';
  private bootstrapDone = false;

  /**
   * Persistent mock 1m OHLC history per asset.
   * All higher timeframes are aggregated from this single series so charts
   * stay coherent when switching intervals (1m → 5m → 1m).
   */
  private readonly mock1mBars = new Map<AssetSymbol, CandleBar[]>();
  private static readonly MOCK_1M_MAX = 50_000; // ~35 days
  private static readonly MOCK_1M_SEED = 20_000; // ~14 days bootstrap

  constructor(private readonly config: ConfigService) {}

  get marketMode(): MarketMode {
    return this.mode;
  }

  get hasLiveFeed(): boolean {
    return this.mode === 'twelve_data' && (this.client?.isConnected ?? false);
  }

  onModuleInit() {
    for (const asset of ALL_ASSETS) {
      this.prices.set(asset, BASE_PRICES[asset]);
    }

    const apiKey =
      this.config.get<string>('TWELVE_DATA_API_KEY')?.trim() ||
      process.env.TWELVE_DATA_API_KEY?.trim() ||
      '';

    if (apiKey) {
      this.mode = 'twelve_data';
      this.rest = new TwelveDataRest(apiKey);
      this.client = new TwelveDataClient(apiKey);
      this.client.setHandlers({
        onPrice: (ev) => this.onTwelveDataPrice(ev),
        onStatus: (ev) => {
          if (ev.event && ev.event !== 'heartbeat') {
            this.logger.debug(`TD status: ${ev.event} ${ev.status ?? ''}`);
          }
        },
      });
      this.client.connect();
      void this.bootstrapQuotes();
      this.logger.log(
        'Market feed: Twelve Data (WS). Set TWELVE_DATA_API_KEY to change key.',
      );
    } else {
      this.mode = 'mock';
      this.logger.warn(
        'TWELVE_DATA_API_KEY no configurada — usando mock random walk. ' +
          'Obtén una key gratis en https://twelvedata.com/apikey',
      );
      this.mockTimer = setInterval(() => this.tickMockAll(), 500);
    }
  }

  onModuleDestroy() {
    if (this.mockTimer) clearInterval(this.mockTimer);
    this.client?.disconnect();
  }

  // ─── Listeners (motor de duelos + gateway) ───────────────────────────────

  subscribe(listener: PriceListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ─── Demanda de símbolos (subscribe/unsubscribe) ─────────────────────────

  /** Incrementa demanda de un activo (duelo, chart viewer, etc.) */
  retainAsset(asset: AssetSymbol | string) {
    if (!this.isAsset(asset)) return;
    const a = asset as AssetSymbol;
    const next = (this.demand.get(a) ?? 0) + 1;
    this.demand.set(a, next);
    if (next === 1) {
      this.syncLiveSubscriptions();
      // Bootstrap inmediato del precio si no hay tick reciente
      void this.ensurePrice(a);
    }
  }

  /** Decrementa demanda */
  releaseAsset(asset: AssetSymbol | string) {
    if (!this.isAsset(asset)) return;
    const a = asset as AssetSymbol;
    const next = Math.max(0, (this.demand.get(a) ?? 0) - 1);
    if (next === 0) this.demand.delete(a);
    else this.demand.set(a, next);
    this.syncLiveSubscriptions();
  }

  /**
   * Retiene un set de activos (p.ej. al entrar a un duelo).
   * Devuelve función de cleanup.
   */
  retainAssets(assets: Array<AssetSymbol | string>) {
    const unique = [
      ...new Set(assets.filter((a) => this.isAsset(a)) as AssetSymbol[]),
    ];
    for (const a of unique) this.retainAsset(a);
    return () => {
      for (const a of unique) this.releaseAsset(a);
    };
  }

  /**
   * Asegura suscripción a todos los activos de la plataforma
   * (útil en MVP con pocos símbolos y plan con créditos suficientes).
   * Por defecto solo suscribe bajo demanda.
   */
  retainAllAssets() {
    for (const a of ALL_ASSETS) this.retainAsset(a);
  }

  getActiveAssets(): AssetSymbol[] {
    return [...this.demand.keys()];
  }

  private syncLiveSubscriptions() {
    if (!this.client || this.mode !== 'twelve_data') return;
    const tdSymbols = this.getActiveAssets().map((a) => toTwelveDataSymbol(a));
    this.client.syncSubscriptions(tdSymbols);
  }

  // ─── Lectura de precios ──────────────────────────────────────────────────

  getTick(asset: AssetSymbol): PriceTick & { ts: number; asset: AssetSymbol } {
    const mid = this.prices.get(asset) ?? BASE_PRICES[asset];
    let bid = this.bids.get(asset);
    let ask = this.asks.get(asset);

    if (bid == null || ask == null || !Number.isFinite(bid) || !Number.isFinite(ask)) {
      const half = this.spreadHalf(asset, mid);
      bid = mid - half;
      ask = mid + half;
    }

    return {
      asset,
      bid,
      ask,
      mid,
      ts: this.lastTs.get(asset) ?? Date.now(),
    };
  }

  getAllTicks() {
    return ALL_ASSETS.map((a) => this.getTick(a));
  }

  getStatus() {
    return {
      mode: this.mode,
      connected: this.hasLiveFeed,
      activeAssets: this.getActiveAssets(),
      subscribedTd: this.client?.subscribedSymbols ?? [],
      bootstrapDone: this.bootstrapDone,
    };
  }

  async getCandles(
    asset: AssetSymbol,
    timeframe: string,
    count = 120,
  ): Promise<CandleBar[]> {
    // Real feed: REST time_series per interval (do not mix with mock walk)
    if (this.mode === 'twelve_data' && this.rest?.hasKey) {
      const candles = await this.rest.fetchCandles(asset, timeframe, count);
      if (candles.length) {
        const tick = this.getTick(asset);
        const last = candles[candles.length - 1];
        if (last && tick.mid > 0) {
          last.close = tick.mid;
          last.high = Math.max(last.high, tick.mid);
          last.low = Math.min(last.low, tick.mid);
        }
        return candles;
      }
      // REST empty (rate limit / error): fall through to persistent mock series
      this.logger.debug(
        `getCandles ${asset} ${timeframe}: REST empty — using persistent mock series`,
      );
    }

    // Mock (or REST fallback): aggregate from one persistent 1m series
    return this.candlesFromPersistentSeries(asset, timeframe, count);
  }

  // ─── Twelve Data handlers ────────────────────────────────────────────────

  private onTwelveDataPrice(ev: TwelveDataPriceEvent) {
    const asset = fromTwelveDataSymbol(ev.symbol);
    if (!asset) {
      // Algunos feeds devuelven "EUR/USD" ya mapeable; si no, ignorar
      this.logger.debug(`Símbolo TD no mapeado: ${ev.symbol}`);
      return;
    }

    const mid = ev.price;
    if (!Number.isFinite(mid) || mid <= 0) return;

    this.prices.set(asset, mid);
    this.lastTs.set(
      asset,
      ev.timestamp > 1e12 ? ev.timestamp : ev.timestamp * 1000,
    );

    if (ev.bid != null && ev.ask != null && ev.bid > 0 && ev.ask > 0) {
      this.bids.set(asset, ev.bid);
      this.asks.set(asset, ev.ask);
    } else {
      const half = this.spreadHalf(asset, mid);
      this.bids.set(asset, mid - half);
      this.asks.set(asset, mid + half);
    }

    this.emitTick(asset);
  }

  private emitTick(asset: AssetSymbol) {
    const tick = this.getTick(asset);
    for (const listener of this.listeners) {
      try {
        listener(asset, tick);
      } catch (err) {
        this.logger.warn(
          `Price listener error: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private async bootstrapQuotes() {
    if (!this.rest) return;
    // Bootstrap en batch suave para no saturar free tier
    for (const asset of ALL_ASSETS) {
      try {
        const quote = await this.rest.fetchQuote(asset);
        if (quote) {
          this.prices.set(asset, quote.mid);
          if (quote.bid && quote.ask) {
            this.bids.set(asset, quote.bid);
            this.asks.set(asset, quote.ask);
          }
          this.lastTs.set(asset, Date.now());
        } else {
          const price = await this.rest.fetchPrice(asset);
          if (price) {
            this.prices.set(asset, price);
            this.lastTs.set(asset, Date.now());
          }
        }
      } catch {
        /* keep base */
      }
      // Pequeña pausa entre requests (free tier ~8 credits/min)
      await sleep(200);
    }
    this.bootstrapDone = true;
    this.logger.log('Bootstrap de precios Twelve Data completado');
  }

  private async ensurePrice(asset: AssetSymbol) {
    if (!this.rest) return;
    const age = Date.now() - (this.lastTs.get(asset) ?? 0);
    if (age < 30_000) return;
    const price = await this.rest.fetchPrice(asset);
    if (price) {
      this.prices.set(asset, price);
      this.lastTs.set(asset, Date.now());
      this.emitTick(asset);
    }
  }

  // ─── Mock fallback (persistent series) ───────────────────────────────────

  private tickMockAll() {
    // Solo tickear activos con demanda, o todos si no hay demanda (dev UX)
    const targets =
      this.demand.size > 0 ? this.getActiveAssets() : [...ALL_ASSETS];

    const now = Date.now();
    for (const asset of targets) {
      this.ensureMock1mHistory(asset);
      const current = this.prices.get(asset) ?? BASE_PRICES[asset];
      const vol = current * 0.00015;
      const next = Math.max(
        current * 0.5,
        current + (Math.random() - 0.5) * 2 * vol,
      );
      this.prices.set(asset, next);
      this.lastTs.set(asset, now);
      const half = this.spreadHalf(asset, next);
      this.bids.set(asset, next - half);
      this.asks.set(asset, next + half);
      this.appendMock1mTick(asset, next, now);
      this.emitTick(asset);
    }
  }

  /**
   * Seed a stable 1m history once per asset (deterministic walk from base).
   * Subsequent live ticks only extend/update the last bar.
   */
  private ensureMock1mHistory(asset: AssetSymbol) {
    if (this.mock1mBars.has(asset)) return;

    const count = MarketService.MOCK_1M_SEED;
    const nowSec = Math.floor(Date.now() / 1000);
    const aligned = nowSec - (nowSec % 60);
    const rng = mulberry32(hashString(asset));
    let price = BASE_PRICES[asset] ?? 1;
    const bars: CandleBar[] = [];

    for (let i = count - 1; i >= 0; i--) {
      const open = price;
      const vol = price * 0.0008;
      // Slight mean-reversion + noise for more realistic structure
      const drift = (BASE_PRICES[asset] - price) * 0.00005;
      const change = drift + (rng() - 0.5) * 2 * vol;
      const close = Math.max(price * 0.5, open + change);
      const wick = vol * (0.15 + rng() * 0.45);
      const high = Math.max(open, close) + wick * rng();
      const low = Math.min(open, close) - wick * rng();
      bars.push({
        time: aligned - i * 60,
        open,
        high,
        low,
        close,
      });
      price = close;
    }

    // Sync live mid to end of seeded history so ticks continue smoothly
    const live = this.prices.get(asset);
    if (live != null && bars.length) {
      const last = bars[bars.length - 1];
      last.close = live;
      last.high = Math.max(last.high, live);
      last.low = Math.min(last.low, live);
    } else if (bars.length) {
      this.prices.set(asset, bars[bars.length - 1].close);
    }

    this.mock1mBars.set(asset, bars);
  }

  /** Fold a live mid into the current 1m OHLC bar (or open a new minute bar). */
  private appendMock1mTick(asset: AssetSymbol, mid: number, tsMs: number) {
    this.ensureMock1mHistory(asset);
    const bars = this.mock1mBars.get(asset)!;
    const sec = Math.floor(tsMs / 1000);
    const barTime = sec - (sec % 60);
    const last = bars[bars.length - 1];

    if (last && last.time === barTime) {
      last.close = mid;
      last.high = Math.max(last.high, mid);
      last.low = Math.min(last.low, mid);
      return;
    }

    // Gap fill: flat bars if process slept / timer stalled
    if (last && last.time < barTime - 60) {
      let t = last.time + 60;
      const fillPx = last.close;
      while (t < barTime) {
        bars.push({
          time: t,
          open: fillPx,
          high: fillPx,
          low: fillPx,
          close: fillPx,
        });
        t += 60;
      }
    }

    const open = last?.close ?? mid;
    bars.push({
      time: barTime,
      open,
      high: Math.max(open, mid),
      low: Math.min(open, mid),
      close: mid,
    });

    if (bars.length > MarketService.MOCK_1M_MAX) {
      bars.splice(0, bars.length - MarketService.MOCK_1M_MAX);
    }
  }

  /**
   * Build candles for any TF by resampling the persistent 1m series.
   * Same TF requested twice → same history (plus any new live updates).
   */
  private candlesFromPersistentSeries(
    asset: AssetSymbol,
    timeframe: string,
    count: number,
  ): CandleBar[] {
    this.ensureMock1mHistory(asset);
    const mid = this.prices.get(asset) ?? BASE_PRICES[asset];
    this.appendMock1mTick(asset, mid, Date.now());

    const bars1m = this.mock1mBars.get(asset)!;
    const tfSec = this.timeframeToSeconds(timeframe);
    const take = Math.min(Math.max(count, 1), 500);

    let series: CandleBar[];
    if (tfSec <= 60) {
      series = bars1m;
    } else {
      series = aggregateOhlc(bars1m, tfSec);
    }

    const slice = series.slice(-take).map((c) => ({ ...c }));
    // Align last bar close to live mid
    if (slice.length && mid > 0) {
      const last = slice[slice.length - 1];
      last.close = mid;
      last.high = Math.max(last.high, mid);
      last.low = Math.min(last.low, mid);
    }
    return slice;
  }

  private spreadHalf(asset: AssetSymbol, mid: number): number {
    const bps = DEFAULT_SPREAD_BPS[asset] ?? 2;
    return mid * (bps / 10_000) * 0.5;
  }

  private timeframeToSeconds(tf: string): number {
    const map: Record<string, number> = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '30m': 1800,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400,
    };
    return map[tf] ?? 60;
  }

  private isAsset(value: string): value is AssetSymbol {
    return (ALL_ASSETS as readonly string[]).includes(value);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Aggregate 1m (or finer) OHLC bars into larger buckets */
function aggregateOhlc(bars: CandleBar[], tfSec: number): CandleBar[] {
  if (tfSec <= 0 || bars.length === 0) return [];
  const out: CandleBar[] = [];
  for (const bar of bars) {
    const bucket = bar.time - (bar.time % tfSec);
    const last = out[out.length - 1];
    if (!last || last.time !== bucket) {
      out.push({
        time: bucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
    } else {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
    }
  }
  return out;
}

/** Deterministic PRNG for stable seed history per asset */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

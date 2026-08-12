'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type CandlestickData,
  type UTCTimestamp,
  ColorType,
  LineStyle,
} from 'lightweight-charts';
import { marketApi } from '@/lib/api';
import { ensureDuelsSocketConnected } from '@/lib/socket';

/** Niveles de un trade abierto/pending para dibujar en el chart */
export interface ChartTradeLevels {
  id: string;
  asset: string;
  side: 'LONG' | 'SHORT' | string;
  status: string;
  entryPrice: number | null;
  stopLoss: number;
  takeProfit: number | null;
  /**
   * Etiqueta corta del dueño (ej. "Yo", "alice").
   * Se usa en el título de cada línea para distinguir trades.
   */
  label?: string;
}

interface PriceChartProps {
  asset: string;
  timeframe: string;
  /** Trades abiertos/pending (cualquier jugador); se filtran por asset */
  trades?: ChartTradeLevels[];
  /** Altura fija opcional; si no, llena el contenedor (min 280) */
  className?: string;
}

const COLORS = {
  entry: '#38bdf8',
  stopLoss: '#ef4444',
  takeProfit: '#22c55e',
} as const;

function timeframeSeconds(tf: string): number {
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

function isActiveTrade(status: string): boolean {
  return status === 'OPEN' || status === 'PENDING';
}

function sideShort(side: string): string {
  return side === 'SHORT' ? 'S' : 'L';
}

/**
 * Tag legible y corto para el eje de precio.
 * Ej: "Yo L", "alice S#2"
 */
function tradeTag(
  trade: ChartTradeLevels,
  indexAmongActive: number,
  totalActive: number,
): string {
  const owner = (trade.label ?? sideShort(trade.side)).slice(0, 8);
  const side = sideShort(trade.side);
  if (totalActive > 1) {
    return `${owner} ${side}#${indexAmongActive + 1}`;
  }
  return `${owner} ${side}`;
}

function clearPriceLines(
  series: ISeriesApi<'Candlestick'>,
  lines: IPriceLine[],
): void {
  for (const line of lines) {
    try {
      series.removePriceLine(line);
    } catch {
      /* series puede estar ya destruida */
    }
  }
}

function createTradePriceLines(
  series: ISeriesApi<'Candlestick'>,
  trade: ChartTradeLevels,
  tag: string,
): IPriceLine[] {
  const lines: IPriceLine[] = [];
  const pending = trade.status === 'PENDING';

  if (
    trade.entryPrice != null &&
    Number.isFinite(trade.entryPrice) &&
    trade.entryPrice > 0
  ) {
    lines.push(
      series.createPriceLine({
        price: trade.entryPrice,
        color: COLORS.entry,
        lineWidth: 2,
        lineStyle: pending ? LineStyle.Dotted : LineStyle.Solid,
        axisLabelVisible: true,
        title: `${tag} Entry`,
      }),
    );
  }

  if (Number.isFinite(trade.stopLoss) && trade.stopLoss > 0) {
    lines.push(
      series.createPriceLine({
        price: trade.stopLoss,
        color: COLORS.stopLoss,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${tag} SL`,
      }),
    );
  }

  if (
    trade.takeProfit != null &&
    Number.isFinite(trade.takeProfit) &&
    trade.takeProfit > 0
  ) {
    lines.push(
      series.createPriceLine({
        price: trade.takeProfit,
        color: COLORS.takeProfit,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${tag} TP`,
      }),
    );
  }

  return lines;
}

export function PriceChart({
  asset,
  timeframe,
  trades,
  className,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lastBarRef = useRef<CandlestickData | null>(null);
  const assetRef = useRef(asset);
  const tfRef = useRef(timeframe);
  const lastPriceEl = useRef<HTMLSpanElement>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const tradesRef = useRef(trades);

  assetRef.current = asset;
  tfRef.current = timeframe;
  tradesRef.current = trades;

  const syncTradeLines = () => {
    const series = seriesRef.current;
    if (!series) return;

    clearPriceLines(series, priceLinesRef.current);
    priceLinesRef.current = [];

    const currentAsset = assetRef.current;
    const active = (tradesRef.current ?? []).filter(
      (t) => t.asset === currentAsset && isActiveTrade(t.status),
    );

    const next: IPriceLine[] = [];
    active.forEach((trade, i) => {
      const tag = tradeTag(trade, i, active.length);
      next.push(...createTradePriceLines(series, trade, tag));
    });
    priceLinesRef.current = next;
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const el = containerRef.current;
    // Lightweight Charts: solo hex (#RRGGBB / #RRGGBBAA)
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#7d8b9a',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#151b22' },
        horzLines: { color: '#151b22' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#2f6fed40', width: 1, style: 2 },
        horzLine: { color: '#2f6fed40', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#1a222c',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: '#1a222c',
        timeVisible: true,
        secondsVisible: false,
      },
      width: el.clientWidth,
      height: Math.max(el.clientHeight, 280),
    });

    const series = chart.addCandlestickSeries({
      upColor: '#2f9d6a',
      downColor: '#c94444',
      borderUpColor: '#2f9d6a',
      borderDownColor: '#c94444',
      wickUpColor: '#278a5b',
      wickDownColor: '#b03a3a',
    });

    chartRef.current = chart;
    seriesRef.current = series;
    syncTradeLines();

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      chartRef.current.applyOptions({
        width: clientWidth,
        height: Math.max(clientHeight, 280),
      });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      priceLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lastBarRef.current = null;
    };
    // Chart se monta una sola vez; sync de trades va en otro effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    lastBarRef.current = null;

    marketApi
      .candles(asset, timeframe, 180)
      .then((candles) => {
        if (cancelled || !seriesRef.current) return;
        const data: CandlestickData[] = candles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        seriesRef.current.setData(data);
        if (data.length) {
          lastBarRef.current = data[data.length - 1];
          if (lastPriceEl.current) {
            lastPriceEl.current.textContent = formatPx(
              data[data.length - 1].close,
            );
          }
        }
        chartRef.current?.timeScale().fitContent();
        // Re-aplicar líneas tras setData (cambio de asset/tf)
        syncTradeLines();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, timeframe]);

  // Tiempo real: open / close / expire / update de SL-TP
  useEffect(() => {
    syncTradeLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, asset]);

  useEffect(() => {
    const socket = ensureDuelsSocketConnected();

    const subscribe = () => {
      socket.emit('market:subscribe', { asset });
    };

    if (socket.connected) subscribe();
    socket.on('connect', subscribe);

    const onTick = (tick: {
      asset: string;
      mid: number;
      bid: number;
      ask: number;
      ts: number;
    }) => {
      if (tick.asset !== assetRef.current || !seriesRef.current) return;
      if (!Number.isFinite(tick.mid) || tick.mid <= 0) return;

      if (lastPriceEl.current) {
        lastPriceEl.current.textContent = formatPx(tick.mid);
      }

      const tfSec = timeframeSeconds(tfRef.current);
      const tickSec = Math.floor(tick.ts / 1000);
      const barTime = (tickSec - (tickSec % tfSec)) as UTCTimestamp;

      const prev = lastBarRef.current;
      let bar: CandlestickData;

      if (prev && (prev.time as number) === barTime) {
        bar = {
          time: barTime,
          open: prev.open,
          high: Math.max(prev.high, tick.mid),
          low: Math.min(prev.low, tick.mid),
          close: tick.mid,
        };
      } else {
        bar = {
          time: barTime,
          open: tick.mid,
          high: tick.mid,
          low: tick.mid,
          close: tick.mid,
        };
      }

      try {
        seriesRef.current.update(bar);
        lastBarRef.current = bar;
      } catch {
        /* ignore */
      }
    };

    socket.on('price:tick', onTick);

    return () => {
      socket.off('connect', subscribe);
      socket.off('price:tick', onTick);
      socket.emit('market:unsubscribe', { asset });
    };
  }, [asset]);

  return (
    <div className={className ?? 'relative h-full w-full min-h-[280px]'}>
      <div className="pointer-events-none absolute left-3 top-2 z-10 flex items-center gap-2">
        <span className="rounded bg-black/40 px-2 py-0.5 font-mono text-xs font-semibold text-foreground backdrop-blur-sm">
          {asset}
        </span>
        <span
          ref={lastPriceEl}
          className="rounded bg-black/40 px-2 py-0.5 font-mono text-xs text-primary backdrop-blur-sm"
        >
          —
        </span>
      </div>
      <div ref={containerRef} className="h-full w-full min-h-[280px]" />
    </div>
  );
}

function formatPx(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 10) return n.toFixed(3);
  return n.toFixed(5);
}

'use client';

import { useEffect, useRef, useState } from 'react';
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
import {
  isStopLossValid,
  isTakeProfitValid,
  validateOpenTradeStopLoss,
  validateOpenTradeTakeProfit,
} from '@trading-duels/shared';
import { cn } from '@/lib/utils';

/** Levels for an open/pending trade drawn on the chart */
export interface ChartTradeLevels {
  id: string;
  asset: string;
  side: 'LONG' | 'SHORT' | string;
  status: string;
  entryPrice: number | null;
  stopLoss: number;
  takeProfit: number | null;
  /** Short owner tag (e.g. "Me") */
  label?: string;
  /** When true and parent provides onLevelsCommit, SL/TP lines are draggable */
  draggable?: boolean;
}

export type LevelDragCommit = {
  tradeId: string;
  stopLoss: number;
  takeProfit: number | null;
  previous: { stopLoss: number; takeProfit: number | null };
};

interface PriceChartProps {
  asset: string;
  timeframe: string;
  /** Active trades (open/pending); filtered by asset */
  trades?: ChartTradeLevels[];
  className?: string;
  /**
   * Called on pointer release after a valid SL/TP drag.
   * Parent should call updateTradeLevels and throw/reject on failure
   * so the chart can revert.
   */
  onLevelsCommit?: (args: LevelDragCommit) => Promise<void>;
  /** Optional live mid for open-trade SL/TP market-side validation */
  liveMid?: number | null;
  /** Called when drag ends with invalid level (line already reverted) */
  onLevelsInvalid?: (message: string) => void;
}

const COLORS = {
  entry: '#38bdf8',
  stopLoss: '#ef4444',
  takeProfit: '#22c55e',
} as const;

const HIT_PX = 10;

type LineKind = 'entry' | 'sl' | 'tp';

type LineMeta = {
  line: IPriceLine;
  tradeId: string;
  kind: LineKind;
  price: number;
  trade: ChartTradeLevels;
  draggable: boolean;
  tag: string;
};

type DragState = {
  meta: LineMeta;
  startPrice: number;
  currentPrice: number;
  /** Full levels at drag start (for rollback) */
  previous: { stopLoss: number; takeProfit: number | null };
};

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
      /* series may already be destroyed */
    }
  }
}

function formatPx(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 10) return n.toFixed(3);
  return n.toFixed(5);
}

/**
 * Edit SL/TP validation.
 * OPEN: mid only — entry is never a barrier (profit lock OK).
 * PENDING: planned entry only.
 * Never returns "entry" errors for OPEN trades.
 */
function validateLevel(
  trade: ChartTradeLevels,
  kind: 'sl' | 'tp',
  price: number,
  liveMid?: number | null,
  lastClose?: number | null,
): { ok: true } | { ok: false; message: string } {
  const side = String(trade.side).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const status = String(trade.status ?? '').toUpperCase();
  const isPending = status === 'PENDING';
  // Any non-pending active trade is treated as OPEN for SL edit (profit lock)
  const isOpen = !isPending;
  const entry = trade.entryPrice;
  if (!(price > 0) || !Number.isFinite(price)) {
    return { ok: false, message: 'Invalid price' };
  }

  if (isOpen) {
    const mid =
      liveMid != null && liveMid > 0
        ? liveMid
        : lastClose != null && lastClose > 0
          ? lastClose
          : null;
    if (mid == null) {
      return {
        ok: false,
        message: 'No market price available to validate levels',
      };
    }
    // ONLY mid-based helpers — never isStopLossValid(entry)
    if (kind === 'sl') {
      return validateOpenTradeStopLoss(side, price, mid);
    }
    return validateOpenTradeTakeProfit(side, price, mid);
  }

  // PENDING only: vs entry
  if (entry == null || !(entry > 0)) {
    return { ok: false, message: 'Trade has no entry price' };
  }
  if (kind === 'sl') {
    if (!isStopLossValid(side, entry, price)) {
      return {
        ok: false,
        message:
          side === 'LONG'
            ? 'On LONG, stop loss must be below the entry price'
            : 'On SHORT, stop loss must be above the entry price',
      };
    }
  } else if (!isTakeProfitValid(side, entry, price)) {
    return {
      ok: false,
      message:
        side === 'LONG'
          ? 'On LONG, take profit must be above the entry price'
          : 'On SHORT, take profit must be below the entry price',
    };
  }
  return { ok: true };
}

export function PriceChart({
  asset,
  timeframe,
  trades,
  className,
  onLevelsCommit,
  liveMid,
  onLevelsInvalid,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lastBarRef = useRef<CandlestickData | null>(null);
  const assetRef = useRef(asset);
  const tfRef = useRef(timeframe);
  const lastPriceEl = useRef<HTMLSpanElement>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lineMetaRef = useRef<LineMeta[]>([]);
  const tradesRef = useRef(trades);
  const dragRef = useRef<DragState | null>(null);
  const liveMidRef = useRef(liveMid);
  const onLevelsCommitRef = useRef(onLevelsCommit);
  const onLevelsInvalidRef = useRef(onLevelsInvalid);
  const [dragPreview, setDragPreview] = useState<{
    y: number;
    price: number;
    kind: 'sl' | 'tp';
  } | null>(null);
  const [cursor, setCursor] = useState<'default' | 'ns-resize' | 'grabbing'>(
    'default',
  );

  assetRef.current = asset;
  tfRef.current = timeframe;
  tradesRef.current = trades;
  liveMidRef.current = liveMid;
  onLevelsCommitRef.current = onLevelsCommit;
  onLevelsInvalidRef.current = onLevelsInvalid;

  const syncTradeLines = () => {
    const series = seriesRef.current;
    if (!series) return;
    // Don't rebuild lines mid-drag (would steal the drag handle)
    if (dragRef.current) return;

    clearPriceLines(series, priceLinesRef.current);
    priceLinesRef.current = [];
    lineMetaRef.current = [];

    const currentAsset = assetRef.current;
    const active = (tradesRef.current ?? []).filter(
      (t) => t.asset === currentAsset && isActiveTrade(t.status),
    );

    const nextLines: IPriceLine[] = [];
    const nextMeta: LineMeta[] = [];
    const canDrag = !!onLevelsCommitRef.current;

    active.forEach((trade, i) => {
      const tag = tradeTag(trade, i, active.length);
      const pending = trade.status === 'PENDING';
      const draggable = !!(canDrag && trade.draggable);

      if (
        trade.entryPrice != null &&
        Number.isFinite(trade.entryPrice) &&
        trade.entryPrice > 0
      ) {
        const line = series.createPriceLine({
          price: trade.entryPrice,
          color: COLORS.entry,
          lineWidth: 2,
          lineStyle: pending ? LineStyle.Dotted : LineStyle.Solid,
          axisLabelVisible: true,
          title: `${tag} Entry`,
        });
        nextLines.push(line);
        nextMeta.push({
          line,
          tradeId: trade.id,
          kind: 'entry',
          price: trade.entryPrice,
          trade,
          draggable: false,
          tag,
        });
      }

      if (Number.isFinite(trade.stopLoss) && trade.stopLoss > 0) {
        const line = series.createPriceLine({
          price: trade.stopLoss,
          color: COLORS.stopLoss,
          lineWidth: draggable ? 2 : 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${tag} SL${draggable ? ' ⋮' : ''}`,
        });
        nextLines.push(line);
        nextMeta.push({
          line,
          tradeId: trade.id,
          kind: 'sl',
          price: trade.stopLoss,
          trade,
          draggable,
          tag,
        });
      }

      if (
        trade.takeProfit != null &&
        Number.isFinite(trade.takeProfit) &&
        trade.takeProfit > 0
      ) {
        const line = series.createPriceLine({
          price: trade.takeProfit,
          color: COLORS.takeProfit,
          lineWidth: draggable ? 2 : 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${tag} TP${draggable ? ' ⋮' : ''}`,
        });
        nextLines.push(line);
        nextMeta.push({
          line,
          tradeId: trade.id,
          kind: 'tp',
          price: trade.takeProfit,
          trade,
          draggable,
          tag,
        });
      }
    });

    priceLinesRef.current = nextLines;
    lineMetaRef.current = nextMeta;
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const el = containerRef.current;
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

    // ── Drag SL / TP ─────────────────────────────────────────────────────
    const yToLocal = (clientY: number) => {
      const rect = el.getBoundingClientRect();
      return clientY - rect.top;
    };

    const findHit = (localY: number): LineMeta | null => {
      const s = seriesRef.current;
      if (!s) return null;
      let best: LineMeta | null = null;
      let bestDist = HIT_PX;
      for (const m of lineMetaRef.current) {
        if (!m.draggable || m.kind === 'entry') continue;
        const y = s.priceToCoordinate(m.price);
        if (y == null) continue;
        const d = Math.abs(y - localY);
        if (d <= bestDist) {
          bestDist = d;
          best = m;
        }
      }
      return best;
    };

    const setChartInteraction = (enabled: boolean) => {
      chart.applyOptions({
        handleScroll: enabled,
        handleScale: enabled,
      });
    };

    const onPointerDown = (ev: PointerEvent) => {
      if (!onLevelsCommitRef.current) return;
      // Only primary button / touch
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      const localY = yToLocal(ev.clientY);
      const hit = findHit(localY);
      if (!hit || (hit.kind !== 'sl' && hit.kind !== 'tp')) return;

      ev.preventDefault();
      ev.stopPropagation();
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }

      const previous = {
        stopLoss: hit.trade.stopLoss,
        takeProfit: hit.trade.takeProfit,
      };
      dragRef.current = {
        meta: hit,
        startPrice: hit.price,
        currentPrice: hit.price,
        previous,
      };
      setChartInteraction(false);
      setCursor('grabbing');
      setDragPreview({
        y: localY,
        price: hit.price,
        kind: hit.kind,
      });
      // Emphasize active line
      try {
        hit.line.applyOptions({
          lineWidth: 3,
          lineStyle: LineStyle.Solid,
        });
      } catch {
        /* ignore */
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      const s = seriesRef.current;
      if (!s) return;
      const localY = yToLocal(ev.clientY);
      const drag = dragRef.current;

      if (!drag) {
        // Hover cursor over draggable lines
        if (onLevelsCommitRef.current) {
          const hit = findHit(localY);
          setCursor(hit ? 'ns-resize' : 'default');
        }
        return;
      }

      const price = s.coordinateToPrice(localY);
      if (price == null || !Number.isFinite(price) || price <= 0) return;

      drag.currentPrice = price;
      drag.meta.price = price;
      try {
        drag.meta.line.applyOptions({ price });
      } catch {
        /* ignore */
      }
      setDragPreview({
        y: localY,
        price,
        kind: drag.meta.kind as 'sl' | 'tp',
      });
    };

    const finishDrag = async (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setChartInteraction(true);
      setCursor('default');
      setDragPreview(null);

      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }

      const kind = drag.meta.kind as 'sl' | 'tp';
      const newPrice = drag.currentPrice;
      const trade = drag.meta.trade;

      // Restore line style from solid drag preview
      try {
        drag.meta.line.applyOptions({
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          price: newPrice,
        });
      } catch {
        /* ignore */
      }

      const midFallback =
        liveMidRef.current ??
        (lastBarRef.current?.close != null && lastBarRef.current.close > 0
          ? lastBarRef.current.close
          : null);
      const check = validateLevel(
        trade,
        kind,
        newPrice,
        midFallback,
        lastBarRef.current?.close ?? null,
      );
      if (!check.ok) {
        // Revert line
        try {
          drag.meta.line.applyOptions({ price: drag.startPrice });
        } catch {
          /* ignore */
        }
        drag.meta.price = drag.startPrice;
        onLevelsInvalidRef.current?.(check.message);
        return;
      }

      // No meaningful change
      if (Math.abs(newPrice - drag.startPrice) < 1e-12) {
        return;
      }

      const stopLoss = kind === 'sl' ? newPrice : trade.stopLoss;
      const takeProfit =
        kind === 'tp' ? newPrice : trade.takeProfit;

      const commit = onLevelsCommitRef.current;
      if (!commit) {
        try {
          drag.meta.line.applyOptions({ price: drag.startPrice });
        } catch {
          /* ignore */
        }
        return;
      }

      try {
        await commit({
          tradeId: trade.id,
          stopLoss,
          takeProfit,
          previous: drag.previous,
        });
        // Parent will refresh trades → syncTradeLines
      } catch {
        // Revert on failure
        try {
          drag.meta.line.applyOptions({ price: drag.startPrice });
        } catch {
          /* ignore */
        }
        drag.meta.price = drag.startPrice;
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (dragRef.current) void finishDrag(ev);
    };

    const onPointerCancel = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      try {
        drag.meta.line.applyOptions({
          price: drag.startPrice,
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
        });
      } catch {
        /* ignore */
      }
      drag.meta.price = drag.startPrice;
      dragRef.current = null;
      setChartInteraction(true);
      setCursor('default');
      setDragPreview(null);
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('lostpointercapture', onPointerCancel);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('lostpointercapture', onPointerCancel);
      ro.disconnect();
      priceLinesRef.current = [];
      lineMetaRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lastBarRef.current = null;
    };
    // Chart mounts once; trade sync is a separate effect
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
        syncTradeLines();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, timeframe]);

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
    <div
      className={cn(
        className ?? 'relative h-full w-full min-h-[280px]',
        cursor === 'ns-resize' && 'cursor-ns-resize',
        cursor === 'grabbing' && 'cursor-grabbing',
      )}
    >
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
        {onLevelsCommit && (
          <span className="hidden rounded bg-black/30 px-1.5 py-0.5 text-[9px] text-muted-foreground backdrop-blur-sm sm:inline">
            Drag SL / TP
          </span>
        )}
      </div>

      {dragPreview && (
        <div
          className={cn(
            'pointer-events-none absolute right-14 z-20 -translate-y-1/2 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold shadow-sm backdrop-blur-sm',
            dragPreview.kind === 'sl'
              ? 'border-destructive/40 bg-destructive/20 text-destructive'
              : 'border-success/40 bg-success/20 text-success',
          )}
          style={{ top: dragPreview.y }}
        >
          {dragPreview.kind === 'sl' ? 'SL' : 'TP'} {formatPx(dragPreview.price)}
        </div>
      )}

      <div
        ref={containerRef}
        className="h-full w-full min-h-[280px] touch-none"
      />
    </div>
  );
}

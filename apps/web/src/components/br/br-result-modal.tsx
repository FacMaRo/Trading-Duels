'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Crosshair,
  Medal,
  Swords,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BR_STAKES, zoneForRank, type BrPrizeZone } from '@trading-duels/shared';
import { cn, formatUsd } from '@/lib/utils';
import { COPY } from '@/lib/copy';
import type { BrPrizeStructureDto } from '@/lib/api';

export interface BrResultModalProps {
  open: boolean;
  rank: number;
  playerCount: number;
  totalPnl: number;
  prizeAmount: number | null;
  stake: number;
  asset: string;
  isDemo?: boolean;
  tradesUsed: number;
  maxTrades: number;
  bestTradePnl: number | null;
  worstTradePnl: number | null;
  top5CutoffPnl: number | null;
  /** PnL at last refund or last prize cutoff for near-miss */
  zoneCutoffPnl?: number | null;
  prizeStructure?: BrPrizeStructureDto | null;
  zone?: BrPrizeZone | null;
  /** e.g. "LONG +$42.10" */
  bestTradeLabel?: string | null;
  availableBalance: number;
  onClose: () => void;
  onPlayAgain: (stake: number) => void;
  onLobby: (stake: number) => void;
  onPlayReal?: () => void;
}

export function BrResultModal({
  open,
  rank,
  playerCount,
  totalPnl,
  prizeAmount,
  stake,
  asset,
  isDemo,
  tradesUsed,
  maxTrades,
  bestTradePnl,
  worstTradePnl,
  top5CutoffPnl,
  zoneCutoffPnl,
  prizeStructure,
  zone: zoneProp,
  bestTradeLabel,
  availableBalance,
  onClose,
  onPlayAgain,
  onLobby,
  onPlayReal,
}: BrResultModalProps) {
  const [selectedStake, setSelectedStake] = useState(stake > 0 ? stake : 5);
  const [showStakeEdit, setShowStakeEdit] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const zone: BrPrizeZone =
    zoneProp ??
    (prizeStructure
      ? zoneForRank(rank, prizeStructure)
      : rank <= 5
        ? 'PRIZE'
        : 'OUT');

  const prize = prizeAmount != null && prizeAmount > 0 ? prizeAmount : 0;
  const isWinner = rank === 1;
  const isPrize = zone === 'PRIZE';
  const isRefund = zone === 'REFUND';
  const isHighlight = isPrize || isRefund;

  useEffect(() => {
    if (open) {
      setSelectedStake(stake > 0 ? stake : 5);
      setShowStakeEdit(false);
      setShowDetail(false);
    }
  }, [open, stake]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const canAfford = isDemo || availableBalance + 1e-9 >= selectedStake;

  const maxAffordable = useMemo(() => {
    const floor = Math.floor(availableBalance * 100) / 100;
    return Math.max(0, floor);
  }, [availableBalance]);

  const suggestedStake = useMemo(() => {
    if (canAfford) return selectedStake;
    const presets = [...BR_STAKES].filter((p) => p <= maxAffordable);
    if (presets.length) return presets[presets.length - 1];
    return 0;
  }, [canAfford, selectedStake, maxAffordable]);

  const nearMiss = useMemo(() => {
    if (zone !== 'OUT' || !prizeStructure) return null;
    const cutoff = zoneCutoffPnl ?? top5CutoffPnl;
    if (cutoff == null) return null;
    const gap = cutoff - totalPnl;
    if (gap <= 0) return null;
    const gapStr = formatUsd(gap);
    if (prizeStructure.refundFrom != null && rank > prizeStructure.refundTo!) {
      return COPY.result.nearMissRefund(rank, gapStr);
    }
    if (rank > prizeStructure.strongCount) {
      return COPY.result.nearMissPrize(rank, gapStr);
    }
    return null;
  }, [zone, prizeStructure, zoneCutoffPnl, top5CutoffPnl, totalPnl, rank]);

  const copy = useMemo(() => {
    if (isWinner) {
      return {
        headline: COPY.result.won,
        sub: COPY.result.wonSub(playerCount),
        cta: COPY.result.playAgain,
      };
    }
    if (isPrize) {
      return {
        headline: COPY.result.topN(rank),
        sub: COPY.result.topSub(playerCount),
        cta: COPY.result.playAgain,
      };
    }
    if (isRefund) {
      return {
        headline: COPY.result.finishedRank(rank),
        sub: COPY.result.refundSub,
        cta: COPY.result.playAgain,
      };
    }
    return {
      headline: COPY.result.finishedRank(rank),
      sub: nearMiss ?? COPY.result.outSub(playerCount),
      cta: COPY.result.playAgain,
    };
  }, [isWinner, isPrize, isRefund, rank, playerCount, nearMiss]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="br-result-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-fade-in"
        aria-label={COPY.result.close}
        onClick={onClose}
      />

      <div
        className={cn(
          'relative z-10 flex max-h-[min(88vh,560px)] w-full max-w-[22rem] flex-col overflow-hidden rounded-xl border shadow-2xl animate-result-pop sm:max-w-sm',
          isPrize && 'border-success/40 bg-card',
          isRefund && 'border-sky-500/35 bg-card',
          !isHighlight && 'border-border bg-card',
        )}
      >
        <div
          className={cn(
            'h-1.5 w-full',
            isWinner && 'bg-success',
            isPrize && !isWinner && 'bg-primary',
            isRefund && 'bg-sky-400',
            !isHighlight && 'bg-muted-foreground/30',
          )}
        />

        <div
          className={cn(
            'pointer-events-none absolute -top-28 left-1/2 h-52 w-80 -translate-x-1/2 rounded-full blur-3xl',
            isPrize ? 'bg-success/25' : isRefund ? 'bg-sky-400/20' : 'bg-primary/12',
          )}
        />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 pb-2 pt-5 sm:px-4 sm:pt-6">
          <div className="shrink-0 space-y-1.5 text-center">
            <div
              className={cn(
                'mx-auto flex h-9 w-9 items-center justify-center rounded-lg border',
                isPrize
                  ? 'border-success/40 bg-success/15 text-success'
                  : isRefund
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                    : 'border-primary/30 bg-primary/10 text-primary',
              )}
            >
              {isHighlight ? (
                <Trophy className="h-4 w-4" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
            </div>

            <p className="label-caps text-muted-foreground">
              {isDemo ? COPY.arena.demo : 'Battle Royale'} · {asset}
              {isDemo
                ? ` · ${COPY.result.virtualStake}`
                : stake > 0
                  ? ` · ${formatUsd(stake)}`
                  : ''}
            </p>

            <h2
              id="br-result-title"
              className={cn(
                'text-xl font-black tracking-tight sm:text-2xl',
                isPrize ? 'text-success' : 'text-foreground',
              )}
            >
              {copy.headline}
            </h2>
            <p className="text-[11px] text-muted-foreground sm:text-xs">{copy.sub}</p>
            <p
              className={cn(
                'inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                isPrize && 'border-success/35 bg-success/15 text-success',
                isRefund && 'border-sky-500/35 bg-sky-500/15 text-sky-200',
                !isHighlight &&
                  'border-border bg-secondary/40 text-muted-foreground',
              )}
            >
              {isPrize
                ? COPY.arena.zonePrize
                : isRefund
                  ? COPY.arena.zoneRefund
                  : COPY.arena.zoneOut}
            </p>
          </div>

          {/* Dominant money line */}
          <div
            className={cn(
              'mt-2.5 shrink-0 rounded-md border px-3 py-2 text-center',
              prize > 0 && isPrize && 'border-success/35 bg-success/10',
              prize > 0 && isRefund && 'border-sky-500/35 bg-sky-500/10',
              prize <= 0 && 'border-border bg-secondary/30',
            )}
          >
            <p className="label-caps mb-0.5 text-muted-foreground">
              {COPY.result.payout}
            </p>
            <p
              className={cn(
                'mono-num text-xl font-black tracking-tight sm:text-2xl',
                prize > 0 ? 'text-success' : 'text-muted-foreground',
              )}
            >
              {prize > 0 ? `+${formatUsd(prize)}` : COPY.result.noPayout}
            </p>
            {isDemo && prize > 0 && (
              <p className="mt-0.5 text-[11px] font-medium text-foreground/90">
                {isRefund
                  ? COPY.result.virtualRefund(formatUsd(prize))
                  : COPY.result.virtualPrize(formatUsd(prize))}
              </p>
            )}
          </div>

          <div className="mt-2.5 grid shrink-0 grid-cols-2 gap-1.5">
            <Stat
              label={COPY.result.position}
              value={`#${rank}`}
              tone={isPrize ? 'up' : 'neutral'}
            />
            <Stat
              label={COPY.result.profit}
              value={`${totalPnl >= 0 ? '+' : ''}${formatUsd(totalPnl)}`}
              tone={totalPnl > 0 ? 'up' : totalPnl < 0 ? 'down' : 'neutral'}
            />
          </div>

          {nearMiss && (
            <div className="mt-2 shrink-0 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-center text-xs font-medium text-warning">
              {nearMiss}
            </div>
          )}

          {bestTradeLabel && (
            <p className="mt-1.5 shrink-0 text-center text-[10px] text-muted-foreground">
              {COPY.result.bestTrade}:{' '}
              <span className="mono-num font-semibold text-foreground">
                {bestTradeLabel}
              </span>
            </p>
          )}

          {isDemo && (isPrize || isRefund) && prize > 0 && (
            <div className="mt-2 shrink-0 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-center text-xs">
              <p className="font-semibold text-primary">
                {COPY.result.wouldHavePaid(formatUsd(prize))}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="mt-2 w-full shrink-0 rounded-md border border-border bg-secondary/25 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            {showDetail ? COPY.result.hideDetail : COPY.result.showDetail}
          </button>

          {showDetail && (
            <div className="mt-1.5 grid shrink-0 grid-cols-2 gap-1.5 animate-slide-up sm:grid-cols-4">
              <MiniStat
                icon={<Medal className="h-3 w-3" />}
                label={COPY.result.rank}
                value={`#${rank}/${playerCount}`}
              />
              <MiniStat
                icon={<Swords className="h-3 w-3" />}
                label={COPY.result.trades}
                value={`${tradesUsed}/${maxTrades}`}
              />
              <MiniStat
                icon={<TrendingUp className="h-3 w-3 text-success" />}
                label={COPY.result.best}
                value={
                  bestTradePnl != null
                    ? `${bestTradePnl >= 0 ? '+' : ''}${formatUsd(bestTradePnl)}`
                    : '—'
                }
              />
              <MiniStat
                icon={<TrendingDown className="h-3 w-3 text-destructive" />}
                label={COPY.result.worst}
                value={
                  worstTradePnl != null
                    ? `${worstTradePnl >= 0 ? '+' : ''}${formatUsd(worstTradePnl)}`
                    : '—'
                }
              />
            </div>
          )}

          {showStakeEdit && !isDemo && (
            <div className="mt-2 shrink-0 space-y-2 rounded-md border border-border bg-secondary/30 p-3 animate-slide-up">
              <p className="label-caps">{COPY.result.nextStake}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {BR_STAKES.map((p) => {
                  const ok = p <= availableBalance + 1e-9;
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={!ok}
                      onClick={() => setSelectedStake(p)}
                      className={cn(
                        'h-9 rounded-md border font-mono text-sm font-semibold transition-colors',
                        selectedStake === p
                          ? 'border-primary bg-primary text-primary-foreground'
                          : ok
                            ? 'border-border text-muted-foreground hover:bg-secondary'
                            : 'cursor-not-allowed border-border/40 text-muted-foreground/40',
                      )}
                    >
                      ${p}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {COPY.result.available}{' '}
                  <span className="mono-num font-medium text-foreground">
                    {formatUsd(availableBalance)}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setShowStakeEdit(false)}
                >
                  {COPY.result.done}
                </button>
              </div>
            </div>
          )}

          {!canAfford && !isDemo && (
            <div className="mt-2 shrink-0 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
              <p className="font-medium text-warning">
                {COPY.result.insufficient(formatUsd(selectedStake))}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {suggestedStake >= 1
                  ? COPY.result.canPlay(formatUsd(suggestedStake))
                  : COPY.result.depositHint}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestedStake >= 1 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8"
                    onClick={() => {
                      setSelectedStake(
                        suggestedStake as (typeof BR_STAKES)[number],
                      );
                      setShowStakeEdit(false);
                    }}
                  >
                    {COPY.result.useStake(`$${suggestedStake}`)}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-8" asChild>
                  <Link href="/wallet">
                    <Wallet className="h-3.5 w-3.5" />
                    {COPY.result.deposit}
                  </Link>
                </Button>
              </div>
            </div>
          )}
          </div>

          {/* Sticky CTA footer — always visible on 1366×768 */}
          <div className="shrink-0 space-y-1.5 border-t border-border bg-card/95 px-3.5 py-2.5 backdrop-blur-sm sm:px-4">
            {isDemo ? (
              <>
                <Button
                  size="lg"
                  className={cn(
                    'h-10 w-full text-sm font-bold tracking-wide',
                    isHighlight
                      ? 'bg-success hover:bg-success/90 shadow-glow-success'
                      : 'shadow-glow',
                  )}
                  onClick={() => onPlayAgain(0)}
                >
                  <Swords className="h-4 w-4" />
                  {COPY.result.playAgain}
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-9 w-full text-xs font-semibold"
                  onClick={() => onPlayReal?.() ?? onLobby(1)}
                >
                  {COPY.result.playReal}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="lg"
                  className={cn(
                    'h-10 w-full text-sm font-bold tracking-wide',
                    isPrize
                      ? 'bg-success hover:bg-success/90 shadow-glow-success'
                      : 'shadow-glow',
                  )}
                  disabled={!canAfford}
                  onClick={() => onPlayAgain(selectedStake)}
                >
                  <Swords className="h-4 w-4" />
                  {copy.cta}
                  <span className="mono-num opacity-90">
                    · {formatUsd(selectedStake)}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Button>

                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    variant="secondary"
                    className="h-9 text-xs"
                    onClick={() => setShowStakeEdit((v) => !v)}
                  >
                    {COPY.result.changeStake}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-9 text-xs"
                    onClick={() => onLobby(selectedStake)}
                  >
                    {COPY.result.backLobby}
                  </Button>
                </div>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-1 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Crosshair className="h-3 w-3" />
              {COPY.result.closeRanking}
            </button>
          </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: string;
  tone: 'up' | 'down' | 'neutral';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-md border border-border bg-secondary/25 px-2.5 py-2 text-center',
        className,
      )}
    >
      <p className="label-caps mb-0.5 !text-[9px]">{label}</p>
      <p
        className={cn(
          'mono-num text-lg font-bold leading-none',
          tone === 'up' && 'text-success',
          tone === 'down' && 'text-destructive',
          tone === 'neutral' && 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-secondary/20 px-2 py-2 text-center">
      <div className="mb-0.5 flex items-center justify-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <p className="mono-num text-xs font-semibold">{value}</p>
    </div>
  );
}

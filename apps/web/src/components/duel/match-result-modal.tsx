'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Crosshair,
  Minus,
  Swords,
  Trophy,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { STAKE_PRESETS } from '@/lib/lobby';
import { cn, formatR, formatUsd } from '@/lib/utils';

export type MatchOutcome = 'win' | 'loss' | 'draw';

export interface MatchResultModalProps {
  open: boolean;
  outcome: MatchOutcome;
  /** Player R-multiple */
  myR: number;
  /** Virtual trading PnL */
  myPnl: number;
  /** Cash stake played */
  stake: number;
  /** Gross winner prize (pot - fee) */
  winnerPrize: number;
  opponentUsername: string;
  mode: string;
  asset?: string | null;
  availableBalance: number;
  onClose: () => void;
  /** Queue again with selected stake (auto search) */
  onPlayAgain: (stake: number) => void;
  /** Prefill lobby without auto-search */
  onChangeStake: (stake: number) => void;
}

/**
 * End-of-match modal — high hierarchy, dominant CTA "PLAY AGAIN".
 * Players only (not spectators).
 */
export function MatchResultModal({
  open,
  outcome,
  myR,
  myPnl,
  stake,
  winnerPrize,
  opponentUsername,
  mode,
  asset,
  availableBalance,
  onClose,
  onPlayAgain,
  onChangeStake,
}: MatchResultModalProps) {
  const [selectedStake, setSelectedStake] = useState(stake);
  const [showStakeEdit, setShowStakeEdit] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedStake(stake);
      setShowStakeEdit(false);
    }
  }, [open, stake]);

  // Block background scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const cashDelta = useMemo(() => {
    if (outcome === 'win') return Math.max(0, winnerPrize - stake);
    if (outcome === 'loss') return -stake;
    return 0;
  }, [outcome, winnerPrize, stake]);

  const canAffordSelected = availableBalance + 1e-9 >= selectedStake;
  const maxAffordable = useMemo(() => {
    const floor = Math.floor(availableBalance * 100) / 100;
    return Math.max(0, floor);
  }, [availableBalance]);

  const suggestedStake = useMemo(() => {
    if (canAffordSelected) return selectedStake;
    const presets = [...STAKE_PRESETS].filter((p) => p <= maxAffordable);
    if (presets.length) return presets[presets.length - 1];
    if (maxAffordable >= 1) return Math.max(1, Math.floor(maxAffordable));
    return 0;
  }, [canAffordSelected, selectedStake, maxAffordable]);

  if (!open) return null;

  const copy = copyFor(outcome);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-result-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-sm animate-fade-in"
        aria-label="Close"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={cn(
          'relative z-10 w-full max-w-lg overflow-hidden rounded-xl border shadow-2xl animate-result-pop',
          outcome === 'win' && 'border-success/40 bg-card',
          outcome === 'loss' && 'border-border bg-card',
          outcome === 'draw' && 'border-border bg-card',
        )}
      >
        {/* Top accent bar */}
        <div
          className={cn(
            'h-1 w-full',
            outcome === 'win' && 'bg-success',
            outcome === 'loss' && 'bg-primary',
            outcome === 'draw' && 'bg-muted-foreground/40',
          )}
        />

        {/* Ambient glow */}
        <div
          className={cn(
            'pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full blur-3xl',
            outcome === 'win' && 'bg-success/20',
            outcome === 'loss' && 'bg-primary/15',
            outcome === 'draw' && 'bg-secondary',
          )}
        />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Close modal"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative space-y-6 px-5 pb-6 pt-8 sm:px-8 sm:pb-8 sm:pt-10">
          {/* Icon + headline */}
          <div className="text-center">
            <div
              className={cn(
                'mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border',
                outcome === 'win' &&
                  'border-success/40 bg-success/15 text-success',
                outcome === 'loss' &&
                  'border-primary/35 bg-primary/10 text-primary',
                outcome === 'draw' &&
                  'border-border bg-secondary text-muted-foreground',
              )}
            >
              {outcome === 'win' && <Trophy className="h-8 w-8" />}
              {outcome === 'loss' && <Zap className="h-8 w-8" />}
              {outcome === 'draw' && <Minus className="h-8 w-8" />}
            </div>

            <p className="label-caps mb-2 text-muted-foreground">
              {mode}
              {asset ? ` · ${asset}` : ''}
            </p>

            <h2
              id="match-result-title"
              className={cn(
                'text-4xl font-black tracking-tight sm:text-5xl',
                outcome === 'win' && 'text-success',
                outcome === 'loss' && 'text-foreground',
                outcome === 'draw' && 'text-foreground',
              )}
            >
              {copy.headline}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              {copy.subline(opponentUsername)}
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <StatBlock
              label={
                outcome === 'win'
                  ? 'Profit'
                  : outcome === 'loss'
                    ? 'Loss'
                    : 'Result $'
              }
              value={
                cashDelta === 0
                  ? formatUsd(0)
                  : `${cashDelta > 0 ? '+' : ''}${formatUsd(cashDelta)}`
              }
              tone={
                cashDelta > 0 ? 'up' : cashDelta < 0 ? 'down' : 'neutral'
              }
              large
            />
            <StatBlock
              label="R-multiple"
              value={formatR(myR)}
              tone={myR > 0 ? 'up' : myR < 0 ? 'down' : 'neutral'}
              large
            />
            <StatBlock
              label="Trade PnL"
              value={`${myPnl >= 0 ? '+' : ''}${formatUsd(myPnl)}`}
              tone={myPnl > 0 ? 'up' : myPnl < 0 ? 'down' : 'neutral'}
            />
            <StatBlock
              label="Stake played"
              value={formatUsd(stake)}
              tone="neutral"
            />
          </div>

          {/* Stake edit */}
          {showStakeEdit && (
            <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-4 animate-slide-up">
              <p className="label-caps">Choose stake for next match</p>
              <div className="flex flex-wrap gap-1.5">
                {STAKE_PRESETS.map((p) => {
                  const ok = p <= availableBalance + 1e-9;
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={!ok}
                      onClick={() => setSelectedStake(p)}
                      className={cn(
                        'min-w-[3rem] rounded-md border px-2.5 py-1.5 font-mono text-xs font-semibold transition-colors',
                        selectedStake === p
                          ? 'border-primary bg-primary text-primary-foreground'
                          : ok
                            ? 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
                            : 'cursor-not-allowed border-border/50 text-muted-foreground/40',
                      )}
                    >
                      ${p}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Available{' '}
                  <span className="mono-num font-medium text-foreground">
                    {formatUsd(availableBalance)}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setShowStakeEdit(false)}
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Insufficient balance warning */}
          {!canAffordSelected && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
              <p className="font-medium text-warning">
                Insufficient balance for {formatUsd(selectedStake)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {suggestedStake >= 1
                  ? `You can play up to ${formatUsd(suggestedStake)} with your current balance.`
                  : 'Deposit to compete again.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestedStake >= 1 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setSelectedStake(suggestedStake);
                      setShowStakeEdit(false);
                    }}
                  >
                    Use {formatUsd(suggestedStake)}
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild>
                  <Link href="/wallet">
                    <Wallet className="h-3.5 w-3.5" />
                    Deposit
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* Primary CTA — dominates */}
          <div className="space-y-2.5">
            <Button
              size="lg"
              className={cn(
                'h-14 w-full text-base font-bold tracking-wide sm:h-16 sm:text-lg',
                outcome === 'win' &&
                  'bg-success hover:bg-success/90 shadow-glow-success',
                outcome === 'loss' && 'shadow-glow',
                outcome === 'draw' && 'shadow-glow',
              )}
              disabled={!canAffordSelected}
              onClick={() => onPlayAgain(selectedStake)}
            >
              <Swords className="h-5 w-5" />
              {copy.cta}
              <span className="mono-num opacity-90">
                · {formatUsd(selectedStake)}
              </span>
              <ArrowRight className="h-5 w-5" />
            </Button>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                className="h-11"
                onClick={() => setShowStakeEdit((v) => !v)}
              >
                Change stake
              </Button>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => onChangeStake(selectedStake)}
              >
                Back to Lobby
              </Button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Crosshair className="h-3 w-3" />
              Close and view details
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBlock({
  label,
  value,
  tone,
  large,
}: {
  label: string;
  value: string;
  tone: 'up' | 'down' | 'neutral';
  large?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/25 px-3 py-3 text-center sm:px-4">
      <p className="label-caps mb-1">{label}</p>
      <p
        className={cn(
          'mono-num font-bold leading-none',
          large ? 'text-2xl sm:text-3xl' : 'text-base sm:text-lg',
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

function copyFor(outcome: MatchOutcome) {
  if (outcome === 'win') {
    return {
      headline: 'YOU WON',
      subline: (rival: string) => `You beat @${rival}. One more.`,
      cta: 'PLAY AGAIN',
    };
  }
  if (outcome === 'loss') {
    return {
      headline: 'CLOSE',
      subline: (rival: string) =>
        `You lost to @${rival}. Rematch is one click away.`,
      cta: 'REMATCH',
    };
  }
  return {
    headline: 'DRAW',
    subline: (rival: string) =>
      `Draw with @${rival}. Stakes refunded. Settle the series.`,
    cta: 'PLAY AGAIN',
  };
}

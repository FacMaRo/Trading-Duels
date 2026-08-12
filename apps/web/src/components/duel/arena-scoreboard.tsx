'use client';

import { cn, formatR, formatUsd } from '@/lib/utils';
import type { PlayerState } from '@/lib/api';
import { UserLink } from '@/components/ui/user-link';

interface ArenaScoreboardProps {
  me: PlayerState | null;
  opponent: PlayerState | null;
  myUserId?: string;
  isFinished?: boolean;
  isDraw?: boolean;
  iWon?: boolean;
}

export function ArenaScoreboard({
  me,
  opponent,
  isFinished,
  isDraw,
  iWon,
}: ArenaScoreboardProps) {
  const leading =
    me &&
    opponent &&
    (me.totalR > opponent.totalR ||
      (me.totalR === opponent.totalR && me.totalPnl > opponent.totalPnl));

  const deltaR = me && opponent ? me.totalR - opponent.totalR : 0;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 sm:gap-3">
      <PlayerScore
        label="YOU"
        player={me}
        side="left"
        leading={!!leading && !isFinished}
        highlight
      />

      <div className="flex flex-col items-center justify-center px-0.5 sm:px-2">
        <div className="flex h-full min-h-[80px] flex-col items-center justify-center gap-1 rounded-md border border-border bg-secondary/30 px-3 py-2.5 sm:min-h-[96px] sm:px-5">
          <span className="label-caps">vs</span>
          {me && opponent && (
            <span
              className={cn(
                'mono-num text-base font-semibold sm:text-lg',
                deltaR > 0
                  ? 'text-success'
                  : deltaR < 0
                    ? 'text-destructive'
                    : 'text-muted-foreground',
              )}
            >
              {deltaR > 0 ? '+' : ''}
              {deltaR.toFixed(2)}R
            </span>
          )}
          {isFinished && (
            <span
              className={cn(
                'mt-0.5 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                isDraw
                  ? 'bg-muted text-muted-foreground'
                  : iWon
                    ? 'bg-success/15 text-success'
                    : 'bg-destructive/15 text-destructive',
              )}
            >
              {isDraw ? 'Draw' : iWon ? 'Victory' : 'Defeat'}
            </span>
          )}
        </div>
      </div>

      <PlayerScore
        label="OPPONENT"
        player={opponent}
        side="right"
        leading={!!opponent && !!me && !leading && !isFinished}
      />
    </div>
  );
}

function PlayerScore({
  label,
  player,
  side,
  leading,
  highlight,
}: {
  label: string;
  player: PlayerState | null;
  side: 'left' | 'right';
  leading?: boolean;
  highlight?: boolean;
}) {
  const r = player?.totalR ?? 0;
  const pnl = player?.totalPnl ?? 0;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border bg-card px-3 py-3 sm:px-4 sm:py-3.5',
        highlight ? 'border-primary/30' : 'border-border',
        leading && 'border-success/40',
      )}
    >
      {leading && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-success" />
      )}
      <div
        className={cn(
          'flex items-start justify-between gap-3',
          side === 'right' && 'flex-row-reverse text-right',
        )}
      >
        <div className="min-w-0">
          <p className="label-caps">{label}</p>
          {player?.username ? (
            <UserLink
              username={player.username}
              withAt={false}
              className="mt-0.5 block truncate text-sm font-semibold sm:text-[15px]"
            />
          ) : (
            <p className="mt-0.5 truncate text-sm font-semibold">—</p>
          )}
          {player?.elo != null && (
            <p className="mono-num text-[11px] text-muted-foreground">
              ELO {player.elo}
            </p>
          )}
        </div>
        <div className={cn(side === 'right' && 'text-right')}>
          <p
            className={cn(
              'mono-num text-3xl font-bold leading-none sm:text-4xl md:text-[2.75rem]',
              r > 0
                ? 'text-success'
                : r < 0
                  ? 'text-destructive'
                  : 'text-foreground',
            )}
          >
            {formatR(r)}
          </p>
          <p
            className={cn(
              'mt-1.5 mono-num text-xs sm:text-sm',
              pnl > 0
                ? 'text-success'
                : pnl < 0
                  ? 'text-destructive'
                  : 'text-muted-foreground',
            )}
          >
            {formatUsd(pnl)}
          </p>
        </div>
      </div>
      {player && (
        <div
          className={cn(
            'mt-2.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground',
            side === 'right' && 'justify-end',
          )}
        >
          <span className="mono-num">Stake {formatUsd(player.stake)}</span>
          <span>
            {player.tradeCount} trades · {player.totalRiskUsedPct.toFixed(1)}%
            risk
          </span>
          {player.openTrades > 0 && (
            <span className="text-primary">{player.openTrades} open</span>
          )}
        </div>
      )}
    </div>
  );
}

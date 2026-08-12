'use client';

import { ArrowUpRight, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, formatCountdown, formatUsd } from '@/lib/utils';

interface RaiseAlertProps {
  pendingRaise: {
    id: string;
    fromUserId: string;
    toUserId: string;
    previousStake: number;
    proposedStake: number;
    expiresAt: string;
  };
  myUserId: string;
  now: number;
  busy?: boolean;
  onAccept: () => void;
  onReject: () => void;
  myUsername?: string;
  fromUsername?: string;
}

export function RaiseAlert({
  pendingRaise,
  myUserId,
  now,
  busy,
  onAccept,
  onReject,
  fromUsername,
}: RaiseAlertProps) {
  const isTarget = pendingRaise.toUserId === myUserId;
  const ms = Math.max(0, new Date(pendingRaise.expiresAt).getTime() - now);
  const pctUp =
    ((pendingRaise.proposedStake - pendingRaise.previousStake) /
      pendingRaise.previousStake) *
    100;
  const urgent = ms <= 15_000;

  return (
    <div
      role="alert"
      className={cn(
        'relative z-40 rounded-md border px-4 py-4 sm:px-5',
        isTarget
          ? urgent
            ? 'border-destructive/40 bg-destructive/8'
            : 'border-warning/35 bg-warning/8'
          : 'border-border bg-secondary/30',
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
              isTarget
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-border bg-card text-muted-foreground',
            )}
          >
            {isTarget ? (
              <ArrowUpRight className="h-4 w-4" />
            ) : (
              <Clock className="h-4 w-4" />
            )}
          </div>
          <div>
            <p className="label-caps text-muted-foreground">
              {isTarget
                ? 'Opponent stake raise'
                : 'Raise sent — awaiting response'}
            </p>
            <p className="mono-num mt-1 text-xl font-bold sm:text-2xl">
              {formatUsd(pendingRaise.previousStake)}
              <span className="mx-2 text-muted-foreground">→</span>
              {formatUsd(pendingRaise.proposedStake)}
              <span className="ml-2 text-sm font-semibold text-muted-foreground">
                (+{pctUp.toFixed(0)}%)
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {fromUsername ? `From @${fromUsername} · ` : ''}
              Potential pot {formatUsd(pendingRaise.proposedStake * 2)} ·{' '}
              <span
                className={cn(
                  'mono-num font-semibold',
                  urgent ? 'text-destructive' : 'text-foreground',
                )}
              >
                {formatCountdown(ms)}
              </span>
            </p>
          </div>
        </div>

        {isTarget ? (
          <div className="flex shrink-0 gap-2">
            <Button
              size="lg"
              variant="success"
              className="flex-1 sm:flex-none"
              disabled={busy || ms <= 0}
              onClick={onAccept}
            >
              Accept
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="flex-1 sm:flex-none"
              disabled={busy || ms <= 0}
              onClick={onReject}
            >
              Reject
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-card px-4 py-2 text-center">
            <p className="mono-num text-xl font-bold">{formatCountdown(ms)}</p>
            <p className="label-caps mt-0.5">Waiting for opponent</p>
          </div>
        )}
      </div>
    </div>
  );
}

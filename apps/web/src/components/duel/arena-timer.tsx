'use client';

import { cn, formatCountdown } from '@/lib/utils';
import { isUrgentMs, phaseLabel } from '@/lib/arena';

interface ArenaTimerProps {
  phaseMs: number;
  status: string;
  className?: string;
}

export function ArenaTimer({ phaseMs, status, className }: ArenaTimerProps) {
  const active = status === 'PREPARATION' || status === 'DEVELOPMENT';
  const urgent = active && isUrgentMs(phaseMs);
  const critical = active && phaseMs > 0 && phaseMs <= 15_000;

  return (
    <div
      className={cn(
        'flex min-w-[132px] flex-col items-center justify-center rounded-md border px-4 py-2 sm:min-w-[168px]',
        active
          ? critical
            ? 'border-destructive/50 bg-destructive/10'
            : urgent
              ? 'border-warning/40 bg-warning/10'
              : 'border-border bg-secondary/40'
          : 'border-border bg-secondary/30',
        className,
      )}
    >
      <span className="label-caps">{phaseLabel(status)}</span>
      <span
        className={cn(
          'mono-num text-3xl font-bold tracking-tight sm:text-4xl md:text-[2.75rem]',
          !active && 'text-2xl text-muted-foreground sm:text-3xl',
          active && !urgent && 'text-foreground',
          urgent && !critical && 'text-warning timer-urgent',
          critical && 'text-destructive timer-urgent',
        )}
      >
        {active
          ? formatCountdown(phaseMs)
          : status === 'MATCHED'
            ? 'READY'
            : '—'}
      </span>
    </div>
  );
}

'use client';

import { Trophy } from 'lucide-react';
import { cn, formatUsd } from '@/lib/utils';
import type { BrPrizeStructureDto } from '@/lib/api';

interface PrizeBreakdownCardProps {
  structure: BrPrizeStructureDto;
  className?: string;
  compact?: boolean;
  /** When true, stake is virtual (demo) */
  virtual?: boolean;
}

/** Clear pre-match prize rules — updates as lobby size changes */
export function PrizeBreakdownCard({
  structure,
  className,
  compact,
  virtual,
}: PrizeBreakdownCardProps) {
  const refundLabel =
    structure.refundFrom != null && structure.refundTo != null
      ? structure.refundFrom === structure.refundTo
        ? `#${structure.refundFrom}`
        : `#${structure.refundFrom}–${structure.refundTo}`
      : null;

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-secondary/20 px-3 py-2.5',
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Trophy className="h-3.5 w-3.5 text-primary" />
        <p className="label-caps !text-[9px] text-primary">Prize breakdown</p>
      </div>
      <p className="text-xs text-foreground">
        Players:{' '}
        <span className="mono-num font-semibold">{structure.playerCount}</span>
        {structure.stake > 0 && (
          <>
            {' '}
            · Stake{' '}
            <span className="mono-num font-semibold">
              {formatUsd(structure.stake)}
            </span>
            {virtual && (
              <span className="text-muted-foreground"> (virtual)</span>
            )}
          </>
        )}
      </p>
      <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
        <li className="flex items-start gap-1.5">
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
          <span>
            <span className="font-medium text-success/90">
              {structure.prizeLine}
            </span>
            {!compact && structure.strongPool > 0 && (
              <span className="text-muted-foreground">
                {' '}
                · pool {formatUsd(structure.strongPool)}
              </span>
            )}
          </span>
        </li>
        {refundLabel && (
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
            <span>
              <span className="font-medium text-sky-300/90">
                {structure.refundLine}
              </span>
              {!compact && structure.stake > 0 && (
                <span>
                  {' '}
                  ({formatUsd(structure.stake)} each)
                </span>
              )}
            </span>
          </li>
        )}
        {!refundLabel && (
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
            <span>{structure.refundLine}</span>
          </li>
        )}
      </ul>
      <p className="mt-1.5 text-[10px] text-muted-foreground/80">
        {structure.footer}
        {structure.prizePool > 0 && (
          <> · Prize pool {formatUsd(structure.prizePool)} (after 10% fee)</>
        )}
      </p>
    </div>
  );
}

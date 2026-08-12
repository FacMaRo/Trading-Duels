'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, formatR, formatUsd } from '@/lib/utils';
import {
  tradeStatusLabel,
  tradeUiStatus,
  type TradeUiStatus,
} from '@/lib/arena';

export interface ArenaTrade {
  id: string;
  userId: string;
  asset: string;
  side: 'LONG' | 'SHORT' | string;
  orderType: string;
  status: string;
  entryPrice: number | null;
  exitPrice: number | null;
  stopLoss: number;
  takeProfit: number | null;
  riskPct: number;
  riskAmount: number;
  rMultiple: number | null;
  pnl: number | null;
  closeReason?: string | null;
}

interface TradeListProps {
  trades: ArenaTrade[];
  myUserId: string;
  onClose?: (tradeId: string) => void;
  onCancel?: (tradeId: string) => void;
  busy?: boolean;
}

const STATUS_STYLE: Record<TradeUiStatus, string> = {
  PENDING: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  FILLED: 'bg-primary/15 text-primary border-primary/30',
  STOPPED: 'bg-destructive/15 text-destructive border-destructive/30',
  TAKE_PROFIT: 'bg-success/15 text-success border-success/30',
  CLOSED: 'bg-muted text-muted-foreground border-border',
  EXPIRED: 'bg-muted text-muted-foreground border-border',
  CANCELLED: 'bg-muted/50 text-muted-foreground/70 border-border/50',
};

export function TradeList({
  trades,
  myUserId,
  onClose,
  onCancel,
  busy,
}: TradeListProps) {
  const mine = trades
    .filter((t) => t.userId === myUserId)
    .slice()
    .sort((a, b) => {
      const order = (s: string) =>
        s === 'OPEN' || s === 'PENDING' ? 0 : s === 'CLOSED' ? 1 : 2;
      return order(a.status) - order(b.status);
    });

  if (mine.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-secondary/20 px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">No trades yet</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Open a position with the form
        </p>
      </div>
    );
  }

  return (
    <ul className="flex max-h-[280px] flex-col gap-1.5 overflow-y-auto pr-0.5 lg:max-h-none lg:flex-1">
      {mine.map((t) => {
        const ui = tradeUiStatus(t);
        const live = t.status === 'OPEN' || t.status === 'PENDING';
        const r = t.rMultiple;
        const pnl = t.pnl;

        return (
          <li
            key={t.id}
            className={cn(
              'rounded-lg border bg-card/80 px-2.5 py-2 transition-colors',
              live ? 'border-border' : 'border-border/50 opacity-80',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs font-semibold">
                    {t.asset}
                  </span>
                  <span
                    className={cn(
                      'rounded px-1 py-px text-[10px] font-bold',
                      t.side === 'LONG'
                        ? 'bg-success/15 text-success'
                        : 'bg-destructive/15 text-destructive',
                    )}
                  >
                    {t.side}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t.orderType}
                  </span>
                  <span
                    className={cn(
                      'rounded border px-1.5 py-px text-[10px] font-semibold',
                      STATUS_STYLE[ui],
                    )}
                  >
                    {tradeStatusLabel(ui)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {t.entryPrice != null
                    ? `@ ${formatPrice(t.entryPrice)}`
                    : 'limit…'}
                  {' · '}SL {formatPrice(t.stopLoss)}
                  {t.takeProfit != null && ` · TP ${formatPrice(t.takeProfit)}`}
                  {' · '}
                  {t.riskPct}%
                </p>
              </div>

              <div className="flex shrink-0 items-start gap-1">
                <div className="text-right">
                  {r != null ? (
                    <p
                      className={cn(
                        'font-mono text-sm font-bold tabular-nums',
                        r > 0
                          ? 'text-success'
                          : r < 0
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                      )}
                    >
                      {formatR(r)}
                    </p>
                  ) : (
                    <p className="font-mono text-sm text-muted-foreground">—</p>
                  )}
                  {pnl != null && (
                    <p
                      className={cn(
                        'font-mono text-[10px] tabular-nums',
                        pnl > 0
                          ? 'text-success/80'
                          : pnl < 0
                            ? 'text-destructive/80'
                            : 'text-muted-foreground',
                      )}
                    >
                      {formatUsd(pnl)}
                    </p>
                  )}
                </div>
                {t.status === 'OPEN' && onClose && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    title="Close at market"
                    onClick={() => onClose(t.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
                {t.status === 'PENDING' && onCancel && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    title="Cancel limit"
                    onClick={() => onCancel(t.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function formatPrice(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 10) return n.toFixed(3);
  return n.toFixed(5);
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, Radio, Swords } from 'lucide-react';
import { duelsApi, type LiveDuelCardDto } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatR, formatUsd } from '@/lib/utils';

export function LiveDuelsSection() {
  const [duels, setDuels] = useState<LiveDuelCardDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    duelsApi
      .listLive()
      .then(setDuels)
      .catch(() => setDuels([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 12_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <section className="rounded-lg border border-border bg-card shadow-panel">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/50 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Live matches
            </h2>
            <p className="text-xs text-muted-foreground">
              Spectate and bet P2P · 10% fee on matched bets only
            </p>
          </div>
        </div>
        <Badge variant="outline" className="mono-num">
          {duels.length}
        </Badge>
      </div>

      <div className="p-4">
        {loading && duels.length === 0 ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-[72px] animate-pulse rounded-md bg-secondary/40"
              />
            ))}
          </div>
        ) : duels.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-md border border-border bg-secondary/40">
              <Swords className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium">No live matches</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              When matches are active you can spectate and bet from here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {duels.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-3 rounded-md border border-border bg-secondary/20 p-3.5 transition-colors hover:bg-secondary/35 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-medium">
                      {d.mode}
                    </Badge>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
                      <Radio className="h-3 w-3" />
                      LIVE
                    </span>
                    {d.primaryAsset && (
                      <span className="font-mono text-xs font-medium text-foreground">
                        {d.primaryAsset}
                      </span>
                    )}
                    {d.openBets > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {d.openBets} offer{d.openBets > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium">
                    @{d.playerA.username}
                    <span
                      className={cn(
                        'ml-1.5 mono-num text-xs',
                        d.playerA.totalR > 0
                          ? 'text-success'
                          : d.playerA.totalR < 0
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                      )}
                    >
                      {formatR(d.playerA.totalR)}
                    </span>
                    <span className="mx-2 text-muted-foreground/60">vs</span>
                    {d.playerB ? (
                      <>
                        @{d.playerB.username}
                        <span
                          className={cn(
                            'ml-1.5 mono-num text-xs',
                            d.playerB.totalR > 0
                              ? 'text-success'
                              : d.playerB.totalR < 0
                                ? 'text-destructive'
                                : 'text-muted-foreground',
                          )}
                        >
                          {formatR(d.playerB.totalR)}
                        </span>
                      </>
                    ) : (
                      '…'
                    )}
                  </p>
                  <p className="mt-0.5 mono-num text-[11px] text-muted-foreground">
                    Pot {formatUsd(d.pot)}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <Link href={`/duel/${d.id}?spectate=1`}>
                    <Eye className="h-3.5 w-3.5" />
                    Spectate
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

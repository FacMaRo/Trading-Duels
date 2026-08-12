'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock, Inbox, Swords, Trash2 } from 'lucide-react';
import type { ChallengeDto } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn, formatCountdown, formatUsd } from '@/lib/utils';
import { LOBBY_MODES, modeMeta, type LobbyMode } from '@/lib/lobby';

interface ChallengeListProps {
  challenges: ChallengeDto[];
  loading?: boolean;
  busy?: boolean;
  acceptingId?: string | null;
  onAccept: (id: string) => void;
  onCancelMine: (id: string) => void;
  onCreateClick?: () => void;
}

export function ChallengeList({
  challenges,
  loading,
  busy,
  acceptingId,
  onAccept,
  onCancelMine,
}: ChallengeListProps) {
  const [filterMode, setFilterMode] = useState<LobbyMode | 'ALL'>('ALL');
  const [stakeMin, setStakeMin] = useState('');
  const [stakeMax, setStakeMax] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const min = stakeMin ? Number(stakeMin) : null;
    const max = stakeMax ? Number(stakeMax) : null;
    return challenges.filter((c) => {
      if (filterMode !== 'ALL' && c.mode !== filterMode) return false;
      if (min != null && !Number.isNaN(min) && c.stake < min) return false;
      if (max != null && !Number.isNaN(max) && c.stake > max) return false;
      if (c.expiresAt && new Date(c.expiresAt).getTime() <= now) return false;
      return true;
    });
  }, [challenges, filterMode, stakeMin, stakeMax, now]);

  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card shadow-panel">
      <div className="border-b border-border p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label-caps mb-1.5">Open challenges</p>
            <h2 className="text-xl font-semibold tracking-tight">
              Open challenges
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              No ELO or opponent identity until you accept.
            </p>
          </div>
          <Badge variant="outline" className="mono-num">
            {filtered.length}
          </Badge>
        </div>

        {/* Filters */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-1">
            <FilterChip
              active={filterMode === 'ALL'}
              onClick={() => setFilterMode('ALL')}
            >
              All
            </FilterChip>
            {LOBBY_MODES.map((m) => (
              <FilterChip
                key={m.id}
                active={filterMode === m.id}
                onClick={() => setFilterMode(m.id)}
              >
                {m.label}
              </FilterChip>
            ))}
          </div>
          <div className="flex items-center gap-1.5 sm:ml-auto">
            <span className="text-[10px] uppercase text-muted-foreground">
              Stake
            </span>
            <input
              type="number"
              placeholder="Min"
              value={stakeMin}
              onChange={(e) => setStakeMin(e.target.value)}
              className="h-8 w-16 rounded-md border border-input bg-background px-2 font-mono text-xs"
            />
            <span className="text-muted-foreground">–</span>
            <input
              type="number"
              placeholder="Max"
              value={stakeMax}
              onChange={(e) => setStakeMax(e.target.value)}
              className="h-8 w-16 rounded-md border border-input bg-background px-2 font-mono text-xs"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4">
        {loading && challenges.length === 0 ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[72px] animate-pulse rounded-xl bg-secondary/40"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyChallenges hasAny={challenges.length > 0} />
        ) : (
          <ul className="space-y-2">
            {filtered.map((c) => {
              const meta = modeMeta(c.mode);
              const msLeft = c.expiresAt
                ? Math.max(0, new Date(c.expiresAt).getTime() - now)
                : null;
              const urgent = msLeft != null && msLeft < 5 * 60 * 1000;

              return (
                <li
                  key={c.id}
                  className={cn(
                    'flex flex-col gap-3 rounded-md border p-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between',
                    c.isMine
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border bg-secondary/15 hover:bg-secondary/30',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'rounded-md border px-2 py-0.5 text-xs font-medium',
                          meta.ring,
                          meta.accent,
                        )}
                      >
                        {c.mode}
                      </span>
                      <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary">
                        {c.asset}
                      </span>
                      {c.isMine && (
                        <Badge variant="outline" className="text-[10px]">
                          Your challenge
                        </Badge>
                      )}
                      {c.sessionWindow && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {c.sessionWindow}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="font-mono text-xl font-bold tabular-nums">
                        {formatUsd(c.stake)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Anonymous opponent · ELO hidden
                      </p>
                    </div>
                    {msLeft != null && (
                      <p
                        className={cn(
                          'mt-1 flex items-center gap-1 font-mono text-[11px]',
                          urgent
                            ? 'text-amber-300'
                            : 'text-muted-foreground',
                        )}
                      >
                        <Clock className="h-3 w-3" />
                        {msLeft <= 0
                          ? 'Expired'
                          : `Expires in ${formatCountdown(msLeft)}`}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {c.isMine ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => onCancelMine(c.id)}
                        className="text-muted-foreground"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        className="min-w-[120px] font-bold"
                        disabled={busy || acceptingId === c.id}
                        onClick={() => onAccept(c.id)}
                      >
                        {acceptingId === c.id ? (
                          'Joining…'
                        ) : (
                          <>
                            <Swords className="h-4 w-4" />
                            Accept
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function EmptyChallenges({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-md border border-border bg-secondary/40">
        <Inbox className="h-5 w-5 text-muted-foreground/50" />
      </div>
      <p className="text-sm font-medium">
        {hasAny
          ? 'No challenges match these filters'
          : 'No open challenges'}
      </p>
      <p className="mt-1.5 max-w-xs text-xs text-muted-foreground">
        {hasAny
          ? 'Try another mode or stake range.'
          : 'Use “Find opponent” or publish an anonymous challenge to enter the arena.'}
      </p>
      {!hasAny && (
        <p className="mt-3 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground">
          Next: mode + stake → Find opponent
        </p>
      )}
    </div>
  );
}

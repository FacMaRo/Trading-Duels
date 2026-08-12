'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Crown, Medal, Trophy } from 'lucide-react';
import { leaderboardApi, type LeaderboardEntryDto } from '@/lib/api';
import { RankBadge } from '@/components/leaderboard/rank-badge';
import { UserLink } from '@/components/ui/user-link';
import { PremiumBadge } from '@/components/ui/premium-badge';
import { cn, formatUsd } from '@/lib/utils';
import { RANK_TONE_STYLES, toneForTier } from '@/lib/ranks';
import { COPY } from '@/lib/copy';

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Single BR leaderboard (GLOBAL ELO + BR career metrics)
      const data = await leaderboardApi.get('GLOBAL', 50, 0);
      setEntries(data.entries);
      setTotal(data.total);
      setGeneratedAt(data.generatedAt);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : COPY.leaderboard.loadError,
      );
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const top3 = entries.slice(0, 3);
  const tableRows = entries.length > 3 ? entries.slice(3) : entries;
  const showPodium = entries.length >= 3;

  return (
    <div className="space-y-8 pb-20 md:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <Trophy className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">
              {COPY.leaderboard.eyebrow}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {COPY.leaderboard.title}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {COPY.leaderboard.subtitle}
          </p>
        </div>
        {generatedAt && (
          <p className="font-mono text-[11px] text-muted-foreground">
            {COPY.leaderboard.updated(new Date(generatedAt).toLocaleString())}
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-20 text-sm text-muted-foreground">
          {COPY.leaderboard.loading}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
          <Trophy className="h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-semibold">{COPY.leaderboard.emptyTitle}</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {COPY.leaderboard.emptyHint}
          </p>
          <a
            href="/lobby"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-glow"
          >
            {COPY.leaderboard.goLobby}
          </a>
        </div>
      ) : (
        <>
          {showPodium && (
            <div className="grid gap-3 sm:grid-cols-3">
              {[top3[1], top3[0], top3[2]].map((entry) =>
                entry ? (
                  <TopCard
                    key={entry.userId}
                    entry={entry}
                    place={entry.rank}
                    featured={entry.rank === 1}
                    className={cn(
                      entry.rank === 1 && 'sm:order-2 sm:-mt-2',
                      entry.rank === 2 && 'sm:order-1',
                      entry.rank === 3 && 'sm:order-3',
                    )}
                  />
                ) : null,
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {COPY.leaderboard.showing(total, entries.length)}
                {showPodium && COPY.leaderboard.tableFrom4}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">#</th>
                    <th className="px-4 py-2.5 font-semibold">
                      {COPY.leaderboard.player}
                    </th>
                    <th className="px-4 py-2.5 font-semibold">
                      {COPY.leaderboard.rank}
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-right">ELO</th>
                    <th className="px-4 py-2.5 font-semibold text-right">
                      {COPY.leaderboard.brMatches}
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-right">
                      {COPY.leaderboard.top5Pct}
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-right">
                      {COPY.leaderboard.avgFinish}
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-right">
                      {COPY.leaderboard.prizeWon}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((e) => (
                    <tr
                      key={e.userId}
                      className="border-b border-border/60 transition-colors hover:bg-accent/30"
                    >
                      <td className="px-4 py-3 font-mono text-muted-foreground">
                        {e.rank}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground">
                            {e.username.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <UserLink
                                username={e.username}
                                className="block truncate"
                              />
                              {e.isPremium && (
                                <PremiumBadge showLabel={false} />
                              )}
                            </div>
                            {e.displayName && (
                              <p className="truncate text-[11px] text-muted-foreground">
                                {e.displayName}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <RankBadge
                          tierId={e.rankTier}
                          label={e.rankLabel}
                        />
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                        {e.elo}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                        {e.brMatches ?? 0}
                        {(e.brWins ?? 0) > 0 && (
                          <span className="ml-1 text-[10px] text-muted-foreground/70">
                            ({e.brWins}×#1)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                        {e.brTop5Rate != null ? `${e.brTop5Rate}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                        {e.brAvgRank != null ? `#${e.brAvgRank}` : '—'}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-3 text-right font-mono tabular-nums',
                          (e.brPrizeTotal ?? 0) > 0 && 'text-success',
                        )}
                      >
                        {(e.brPrizeTotal ?? 0) > 0
                          ? formatUsd(e.brPrizeTotal ?? 0)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TopCard({
  entry,
  place,
  featured,
  className,
}: {
  entry: LeaderboardEntryDto;
  place: number;
  featured?: boolean;
  className?: string;
}) {
  const tone = toneForTier(entry.rankTier);
  const styles = RANK_TONE_STYLES[tone];
  const Icon = place === 1 ? Crown : place === 2 ? Medal : Trophy;
  const placeColor =
    place === 1
      ? 'text-amber-300'
      : place === 2
        ? 'text-slate-300'
        : 'text-orange-400';

  return (
    <Link
      href={`/profile/${encodeURIComponent(entry.username)}`}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:border-primary/40',
        featured
          ? 'border-amber-400/40 shadow-[0_0_40px_-12px_hsl(45_90%_50%/0.35)]'
          : 'border-border',
        className,
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 bg-gradient-to-b opacity-80',
          styles.bg,
        )}
      />
      <div className="relative">
        <div className="mb-3 flex items-center justify-between">
          <span
            className={cn(
              'flex items-center gap-1.5 text-xs font-bold',
              placeColor,
            )}
          >
            <Icon className="h-4 w-4" />#{place}
          </span>
          <RankBadge tierId={entry.rankTier} label={entry.rankLabel} />
        </div>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold ring-2',
              styles.ring,
              'bg-secondary',
            )}
          >
            {entry.username.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1 truncate font-semibold group-hover:text-primary">
              @{entry.username}
              {entry.isPremium && <PremiumBadge showLabel={false} />}
            </p>
            <p className="font-mono text-2xl font-bold tabular-nums">
              {entry.elo}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ELO
              </span>
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
          <span>{entry.brMatches ?? 0} BR</span>
          <span>
            {entry.brTop5Rate != null ? `${entry.brTop5Rate}% T5` : '— T5'}
          </span>
          <span
            className={cn((entry.brPrizeTotal ?? 0) > 0 && 'text-success')}
          >
            {(entry.brPrizeTotal ?? 0) > 0
              ? formatUsd(entry.brPrizeTotal ?? 0)
              : '— $'}
          </span>
        </div>
      </div>
    </Link>
  );
}

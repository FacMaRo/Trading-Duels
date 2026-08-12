'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Crown, History } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import {
  brApi,
  premiumApi,
  type BrHistoryResponse,
  type BrStatsResponse,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PremiumBadge } from '@/components/ui/premium-badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn, formatUsd } from '@/lib/utils';
import { COPY } from '@/lib/copy';

export default function StatsPage() {
  const { user, refreshMe, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<BrStatsResponse | null>(null);
  const [history, setHistory] = useState<BrHistoryResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const [s, h] = await Promise.all([brApi.stats(), brApi.history()]);
      setStats(s);
      setHistory(h);
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.common.error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && user) void load();
    if (!authLoading && !user) setLoading(false);
  }, [authLoading, user, load]);

  if (authLoading || loading) {
    return (
      <div className="flex justify-center py-24 text-sm text-muted-foreground">
        {COPY.stats.loading}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <p className="text-muted-foreground">{COPY.stats.signIn}</p>
        <Button asChild>
          <Link href="/login?next=/stats">{COPY.nav.signIn}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-20 md:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label-caps mb-1 flex items-center gap-1.5">
            <BarChart3 className="h-3 w-3" />
            Battle Royale
          </p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {COPY.stats.title}
            {user.isPremium && <PremiumBadge size="md" />}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {COPY.stats.subtitle}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await premiumApi.set(!user.isPremium);
            await refreshMe();
            await load();
          }}
        >
          <Crown className="h-3.5 w-3.5" />
          {user.isPremium
            ? COPY.stats.removePremium
            : COPY.stats.activatePremium}
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Free + Pro shared basics */}
      {stats && stats.games === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 px-5 py-10 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 font-semibold">{COPY.stats.emptyTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {COPY.stats.emptyHint}
          </p>
          <Button asChild className="mt-4" size="sm">
            <Link href="/lobby">{COPY.stats.goLobby}</Link>
          </Button>
        </div>
      )}

      {stats && stats.games > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label={COPY.stats.matches} value={String(stats.games)} />
          <StatCard label={COPY.stats.wins} value={String(stats.wins)} />
          <StatCard
            label={COPY.stats.top5}
            value={`${stats.top5} (${stats.top5Rate}%)`}
          />
          <StatCard
            label={COPY.stats.prizes}
            value={formatUsd(stats.totalPrize)}
            highlight
          />
          <StatCard
            label={COPY.stats.avgProfit}
            value={formatUsd(stats.avgPnl)}
          />
          <StatCard
            label={COPY.stats.avgRank}
            value={stats.avgRank ? `#${stats.avgRank}` : '—'}
          />
        </div>
      )}

      {/* Premium analytics — only after some matches, empty panels still structured */}
      {stats?.advanced && stats.games > 0 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {COPY.stats.advanced}
                <PremiumBadge />
              </CardTitle>
              <CardDescription>
                {COPY.stats.advancedDesc(
                  formatUsd(stats.advanced.totalPnl),
                  stats.advanced.bestFinish ?? '—',
                  stats.advanced.bestTop5Streak,
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Mini
                  label={COPY.stats.totalPnl}
                  value={formatUsd(stats.advanced.totalPnl)}
                />
                <Mini
                  label={COPY.stats.bestFinish}
                  value={
                    stats.advanced.bestFinish != null
                      ? `#${stats.advanced.bestFinish}`
                      : '—'
                  }
                />
                <Mini
                  label={COPY.stats.top5Streak}
                  value={String(stats.advanced.bestTop5Streak)}
                />
                <Mini
                  label={COPY.stats.profitFactor}
                  value={
                    stats.advanced.profitFactor != null
                      ? String(stats.advanced.profitFactor)
                      : '—'
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {COPY.stats.assetBreakdown}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats.advanced.byAsset.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {COPY.stats.noAssetYet}
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {stats.advanced.byAsset.map((a) => (
                    <div
                      key={a.asset}
                      className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-sm"
                    >
                      <p className="font-mono font-semibold">{a.asset}</p>
                      <p className="text-xs text-muted-foreground">
                        {COPY.stats.assetLine(
                          a.games,
                          a.top5,
                          formatUsd(a.avgPnl),
                        )}
                      </p>
                      {a.prizeTotal != null && a.prizeTotal > 0 && (
                        <p className="mt-0.5 text-xs text-success">
                          {formatUsd(a.prizeTotal)} prizes
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {COPY.stats.stakeBreakdown}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!stats.advanced.byStake?.length ? (
                <p className="text-sm text-muted-foreground">
                  {COPY.stats.noStakeYet}
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  {stats.advanced.byStake.map((s) => (
                    <div
                      key={s.stake}
                      className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-sm"
                    >
                      <p className="font-mono font-semibold">
                        {formatUsd(s.stake)} stake
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.games} matches · {s.top5} top 5
                      </p>
                      <p className="text-xs text-muted-foreground">
                        avg {formatUsd(s.avgPnl)} · prizes{' '}
                        {formatUsd(s.prizeTotal)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {COPY.stats.recentForm}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!stats.advanced.recentForm?.length ? (
                <p className="text-sm text-muted-foreground">
                  {COPY.stats.noFormYet}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {stats.advanced.recentForm.map((f, i) => (
                    <li
                      key={`${f.asset}-${i}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {f.asset} · {formatUsd(f.stake)}
                      </span>
                      <span className="mono-num font-semibold">
                        #{f.rank ?? '—'}
                      </span>
                      <span
                        className={cn(
                          'mono-num text-xs font-semibold',
                          f.pnl > 0
                            ? 'text-success'
                            : f.pnl < 0
                              ? 'text-destructive'
                              : 'text-muted-foreground',
                        )}
                      >
                        {f.pnl >= 0 ? '+' : ''}
                        {formatUsd(f.pnl)}
                      </span>
                      {f.prize > 0 && (
                        <span className="mono-num text-xs text-success">
                          +{formatUsd(f.prize)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {stats && !stats.advanced && (
        <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] to-transparent p-4 sm:p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Crown className="h-4 w-4 text-amber-300" />
            {COPY.stats.unlockTitle}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {stats.upgradeHint ?? COPY.stats.unlockHint}
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <li>· Full match history (not just last 10)</li>
            <li>· Total prize $, Top 5 rate & streak, best/avg finish</li>
            <li>· Avg profit $ · asset & stake-tier breakdowns</li>
            <li>· Recent form (last 10) · profit factor</li>
            <li>· Queue priority, chat, free $1 entry/week</li>
          </ul>
          <Button
            size="sm"
            className="mt-3 border border-amber-500/30 bg-amber-500/15 font-semibold text-amber-100 hover:bg-amber-500/25"
            onClick={async () => {
              await premiumApi.set(true);
              await refreshMe();
              await load();
            }}
          >
            {COPY.stats.activatePremium}
          </Button>
        </div>
      )}

      {history && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              {COPY.stats.history}
              {history.truncated && (
                <span className="text-xs font-normal text-muted-foreground">
                  {COPY.stats.lastN(history.limit)}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {history.matches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {COPY.stats.noMatches}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {history.matches.map((m) => (
                  <li
                    key={m.matchId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                  >
                    <div>
                      <Link
                        href={`/br/${m.matchId}`}
                        className="font-mono font-semibold hover:text-primary"
                      >
                        {m.asset}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatUsd(m.stake)} · {m.playerCount}p
                      </span>
                    </div>
                    <div className="mono-num text-xs sm:text-sm">
                      <span className="text-muted-foreground">
                        #{m.rank ?? '—'}
                      </span>
                      <span
                        className={cn(
                          'ml-2 font-semibold',
                          m.totalPnl > 0
                            ? 'text-success'
                            : m.totalPnl < 0
                              ? 'text-destructive'
                              : '',
                        )}
                      >
                        {formatUsd(m.totalPnl)}
                      </span>
                      {m.prizeAmount > 0 && (
                        <span className="ml-2 text-success">
                          +{formatUsd(m.prizeAmount)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn('mono-num text-xl', highlight && 'text-success')}
        >
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mono-num mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

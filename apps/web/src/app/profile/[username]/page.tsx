'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  Swords,
  Target,
  Trophy,
  TrendingUp,
} from 'lucide-react';
import { profileApi, type PublicProfileDto } from '@/lib/api';
import { useAuth } from '@/components/providers/auth-provider';
import { RankBadge } from '@/components/leaderboard/rank-badge';
import { UserLink } from '@/components/ui/user-link';
import { Badge } from '@/components/ui/badge';
import { PremiumBadge } from '@/components/ui/premium-badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn, formatR, formatUsd } from '@/lib/utils';
import { RANK_TONE_STYLES, toneForTier } from '@/lib/ranks';
import { COPY } from '@/lib/copy';

export default function ProfilePage() {
  const params = useParams();
  const username = decodeURIComponent(params.username as string);
  const { user: me } = useAuth();
  const [profile, setProfile] = useState<PublicProfileDto | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await profileApi.byUsername(username);
      setProfile(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : COPY.profile.notFound,
      );
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-sm text-muted-foreground">
        {COPY.profile.loading}
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-destructive">{error || COPY.profile.notFound}</p>
        <Button variant="outline" asChild>
          <Link href="/leaderboard">{COPY.profile.viewLeaderboard}</Link>
        </Button>
      </div>
    );
  }

  const tone = toneForTier(profile.rankTier);
  const styles = RANK_TONE_STYLES[tone];
  const isSelf = me?.id === profile.id;

  return (
    <div className="space-y-8 pb-20 md:pb-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/leaderboard" title="Leaderboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {COPY.profile.publicProfile}
        </p>
      </div>

      {/* Hero */}
      <section
        className={cn(
          'relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-8',
          'border-border',
        )}
      >
        <div
          className={cn(
            'pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90',
            styles.bg,
          )}
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-xl font-bold ring-2 sm:h-20 sm:w-20 sm:text-2xl',
                styles.ring,
                'bg-secondary',
              )}
            >
              {profile.username.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  @{profile.username}
                </h1>
                {profile.isPremium && <PremiumBadge size="md" />}
                {isSelf && (
                  <Badge variant="outline" className="text-[10px]">
                    {COPY.profile.you}
                  </Badge>
                )}
              </div>
              {profile.displayName && (
                <p className="text-muted-foreground">{profile.displayName}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <RankBadge
                  tierId={profile.rankTier}
                  label={profile.rankLabel}
                  size="md"
                />
                {profile.globalRank != null && (
                  <span className="font-mono text-xs text-muted-foreground">
                    Global #{profile.globalRank}
                  </span>
                )}
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3" />
                {COPY.profile.memberSince}{' '}
                {new Date(profile.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              ELO
            </p>
            <p className="font-mono text-4xl font-bold tabular-nums sm:text-5xl">
              {profile.elo}
            </p>
            {profile.nextRankLabel && profile.nextRankElo != null && (
              <div className="mt-2 sm:ml-auto sm:max-w-[200px]">
                <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>→ {profile.nextRankLabel}</span>
                  <span>{profile.nextRankElo}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: `${Math.round(profile.rankProgress * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Stats grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Trophy className="h-4 w-4 text-amber-400" />}
          label="Winrate"
          value={`${profile.winrate}%`}
          sub={`${profile.wins}W / ${profile.losses}L / ${profile.draws}D`}
        />
        <StatCard
          icon={<Swords className="h-4 w-4 text-primary" />}
          label={COPY.profile.matches}
          value={String(profile.games)}
          sub={COPY.profile.completed}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-success" />}
          label="ELO"
          value={String(profile.elo)}
          sub={COPY.profile.competitiveRating}
        />
        <StatCard
          icon={<Target className="h-4 w-4 text-violet-400" />}
          label={COPY.profile.rank}
          value={profile.rankLabel}
          sub={
            profile.globalRank != null
              ? COPY.profile.position(profile.globalRank)
              : COPY.profile.noRank
          }
        />
      </div>

      {/* By mode */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {COPY.profile.byMode}
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {profile.byMode.map((m) => (
            <Card key={m.mode}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{m.mode}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {m.games} games
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 font-mono text-sm">
                <p>
                  <span className="text-muted-foreground">WR </span>
                  <span className="font-semibold">{m.winrate}%</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.wins}W / {m.losses}L / {m.draws}D
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Recent history */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {COPY.profile.recentHistory}
        </h2>
        {profile.recentDuels.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {COPY.profile.noDuels}
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {profile.recentDuels.map((d) => (
                <li key={d.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/20">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <ResultBadge result={d.result} />
                      <Badge variant="outline" className="text-[10px]">
                        {d.mode}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        vs{' '}
                        {d.opponentUsername ? (
                          <UserLink username={d.opponentUsername} />
                        ) : (
                          '—'
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-xs">
                      <span
                        className={cn(
                          'tabular-nums',
                          d.myR != null && d.myR > 0 && 'text-success',
                          d.myR != null && d.myR < 0 && 'text-destructive',
                          d.myR == null && 'text-muted-foreground',
                        )}
                      >
                        {d.myR != null ? formatR(d.myR) : '—'}
                      </span>
                      <span className="text-muted-foreground">
                        {formatUsd(d.pot)}
                      </span>
                      <span className="hidden text-muted-foreground sm:inline">
                        {new Date(
                          d.completedAt ?? d.createdAt,
                        ).toLocaleDateString()}
                      </span>
                      {(d.result === 'WIN' ||
                        d.result === 'LOSS' ||
                        d.result === 'DRAW' ||
                        d.result === 'ONGOING') &&
                        isSelf && (
                          <Link
                            href={`/duel/${d.id}`}
                            className="text-primary hover:underline"
                          >
                            {COPY.profile.view}
                          </Link>
                        )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="flex justify-center gap-2">
        <Button variant="outline" asChild>
          <Link href="/leaderboard">Leaderboard</Link>
        </Button>
        <Button asChild>
          <Link href="/lobby">{COPY.profile.findMatch}</Link>
        </Button>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              'mt-1 font-mono text-2xl font-semibold tabular-nums',
              valueClass,
            )}
          >
            {value}
          </p>
          {sub && (
            <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
          )}
        </div>
        <div className="rounded-md bg-secondary p-2">{icon}</div>
      </CardContent>
    </Card>
  );
}

function ResultBadge({
  result,
}: {
  result: PublicProfileDto['recentDuels'][0]['result'];
}) {
  const map: Record<string, { label: string; className: string }> = {
    WIN: {
      label: 'W',
      className: 'bg-success/15 text-success border-success/30',
    },
    LOSS: {
      label: 'L',
      className: 'bg-destructive/15 text-destructive border-destructive/30',
    },
    DRAW: {
      label: 'D',
      className: 'bg-muted text-muted-foreground border-border',
    },
    CANCELLED: {
      label: '—',
      className: 'bg-muted/50 text-muted-foreground/60 border-border/50',
    },
    ONGOING: {
      label: '…',
      className: 'bg-primary/15 text-primary border-primary/30',
    },
  };
  const s = map[result] ?? map.ONGOING;
  return (
    <span
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded border text-[10px] font-bold',
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}

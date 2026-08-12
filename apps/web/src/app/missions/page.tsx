'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Gift,
  Lock,
  PauseCircle,
  Sparkles,
  Swords,
  Target,
  Timer,
} from 'lucide-react';
import {
  missionsApi,
  type MissionUiStatus,
  type MissionViewDto,
  type MissionsOverviewDto,
} from '@/lib/api';
import { useAuth } from '@/components/providers/auth-provider';
import { isNewPlayer } from '@/lib/onboarding';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { AUTH_REASONS, buildLoginUrl } from '@/lib/auth-redirect';
import { COPY } from '@/lib/copy';

export default function MissionsPage() {
  const { user, refreshWallet } = useAuth();
  const requireAuth = useRequireAuth();
  const [data, setData] = useState<MissionsOverviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const overview = await missionsApi.overview();
      setData(overview);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : COPY.missions.loadError,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reload on sign-in for real progress
  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function claim(m: MissionViewDto) {
    if (!requireAuth('mission')) return;
    if (!m.canClaim) return;
    setClaiming(m.type);
    setToast(null);
    try {
      const res = await missionsApi.claim(m.type);
      setToast({ ok: true, text: res.message });
      await refreshWallet();
      await load();
    } catch (err) {
      setToast({
        ok: false,
        text:
          err instanceof Error ? err.message : COPY.missions.claimError,
      });
    } finally {
      setClaiming(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex justify-center py-24 text-sm text-muted-foreground">
        {COPY.missions.loading}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" onClick={load}>
          {COPY.missions.retry}
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const small = data.missions.filter((m) => m.category === 'SMALL');
  const big = data.missions.filter((m) => m.category === 'BIG');
  const capPct = Math.min(100, data.smallDailyUtilizationPct ?? 0);

  return (
    <div className="space-y-8 pb-20 md:pb-8">
      <div>
        <div className="mb-2 flex items-center gap-2 text-primary">
          <Target className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-[0.2em]">
            {COPY.missions.eyebrow}
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {COPY.missions.title}
        </h1>
        <p className="mt-1 text-muted-foreground">{COPY.missions.subtitle}</p>
      </div>

      {!user && (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-primary">
              {COPY.missions.publicCatalog}
            </p>
            <p className="text-sm text-muted-foreground">
              {COPY.missions.publicCatalogHint}
            </p>
          </div>
          <Button asChild className="shrink-0 font-semibold shadow-glow">
            <Link href={buildLoginUrl('/missions', AUTH_REASONS.mission)}>
              {COPY.missions.signIn}
            </Link>
          </Button>
        </div>
      )}

      {user && isNewPlayer(user) && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
              <Swords className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">{COPY.missions.activateOnWin}</p>
              <p className="text-sm text-muted-foreground">
                {COPY.missions.activateHint}
              </p>
            </div>
          </div>
          <Button asChild className="shrink-0 font-semibold shadow-glow">
            <Link href="/lobby">{COPY.missions.playNow}</Link>
          </Button>
        </div>
      )}

      {toast && (
        <div
          className={cn(
            'flex items-start gap-3 rounded-xl border px-4 py-3 animate-slide-up',
            toast.ok
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {toast.ok ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          ) : (
            <Lock className="mt-0.5 h-5 w-5 shrink-0" />
          )}
          <div className="flex-1">
            <p className="text-sm font-medium">{toast.text}</p>
          </div>
          <button
            type="button"
            className="text-xs underline opacity-70"
            onClick={() => setToast(null)}
          >
            {COPY.missions.close}
          </button>
        </div>
      )}

      {/* Reward availability — no fee-pool accounting */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          className={cn(
            !data.smallMissionsActive && 'border-amber-500/40',
          )}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gift className="h-4 w-4 text-primary" />
              {COPY.missions.smallDailyCap}
            </CardTitle>
            <CardDescription>{COPY.missions.smallDailyCapDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end justify-between">
              <Badge
                variant={data.smallMissionsActive ? 'success' : 'muted'}
              >
                {data.smallMissionsActive
                  ? COPY.missions.rewardStatusOpen
                  : COPY.missions.rewardStatusPaused}
              </Badge>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  capPct >= 100 ? 'bg-amber-500' : 'bg-primary',
                )}
                style={{ width: `${capPct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {data.smallMissionsActive
                ? COPY.missions.active
                : COPY.missions.capReached}
            </p>
            {!data.smallMissionsActive && (
              <p className="flex items-center gap-1.5 text-xs text-amber-300">
                <PauseCircle className="h-3.5 w-3.5" />
                {COPY.missions.capReached}
              </p>
            )}
          </CardContent>
        </Card>

        <Card
          className={cn(
            !data.pool.canFundMonthly && 'border-amber-500/40',
          )}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-amber-300" />
              {COPY.missions.missionPool}
            </CardTitle>
            <CardDescription>
              {COPY.missions.poolDesc(
                data.pool.monthlyMinReward,
                data.pool.monthlyMaxReward,
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Badge
              variant={data.pool.canFundMonthly ? 'success' : 'muted'}
            >
              {data.pool.canFundMonthly
                ? COPY.missions.canFundBig
                : COPY.missions.insufficientFunds}
            </Badge>
            <p className="text-xs text-muted-foreground">
              {data.pool.canFundMonthly
                ? COPY.missions.rewardStatusOpen
                : COPY.missions.monthlyUnlockHint}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Small missions */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {COPY.missions.smallMissions}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {small.map((m) => (
            <MissionCard
              key={m.type}
              mission={m}
              claiming={claiming === m.type}
              onClaim={() => claim(m)}
            />
          ))}
        </div>
      </section>

      {/* Big mission */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {COPY.missions.bigMission}
        </h2>
        <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
          {big.map((m) => (
            <MissionCard
              key={m.type}
              mission={m}
              claiming={claiming === m.type}
              onClaim={() => claim(m)}
              featured
            />
          ))}
        </div>
      </section>

      <p className="text-center font-mono text-[11px] text-muted-foreground">
        {COPY.missions.updated(new Date(data.generatedAt).toLocaleString())}
      </p>
    </div>
  );
}

function MissionCard({
  mission: m,
  claiming,
  onClaim,
  featured,
}: {
  mission: MissionViewDto;
  claiming: boolean;
  onClaim: () => void;
  featured?: boolean;
}) {
  const statusStyle = statusStyles(m.status);

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-colors',
        featured && 'border-amber-400/30',
        m.status === 'CLAIMABLE' && 'border-success/40 shadow-glow-success',
        m.status === 'PAUSED_DAILY_CAP' || m.status === 'PAUSED_POOL'
          ? 'opacity-90'
          : '',
      )}
    >
      {m.status === 'CLAIMABLE' && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-success/5 to-transparent" />
      )}
      <CardHeader className="relative pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{m.title}</CardTitle>
            <CardDescription className="mt-1 text-xs leading-relaxed">
              {m.description}
            </CardDescription>
          </div>
          <Badge className={cn('shrink-0 border', statusStyle.badge)}>
            {statusStyle.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="relative space-y-4">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {COPY.missions.progress}
            </p>
            <p className="font-mono text-2xl font-bold tabular-nums">
              {m.progress}
              <span className="text-base text-muted-foreground">
                /{m.target}
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {COPY.missions.reward}
            </p>
            <p
              className={cn(
                'font-mono text-xl font-bold',
                featured ? 'text-amber-300' : 'text-success',
              )}
            >
              {m.rewardLabel}
            </p>
          </div>
        </div>

        <div className="space-y-1">
          <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                m.status === 'CLAIMED'
                  ? 'bg-muted-foreground/40'
                  : m.status === 'CLAIMABLE'
                    ? 'bg-success'
                    : featured
                      ? 'bg-amber-400'
                      : 'bg-primary',
              )}
              style={{ width: `${m.progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{m.periodLabel}</span>
            <span className="font-mono">{m.progressPct}%</span>
          </div>
        </div>

        {m.statusMessage && (
          <p
            className={cn(
              'flex items-start gap-1.5 text-xs',
              statusStyle.message,
            )}
          >
            {m.status === 'COOLDOWN' && (
              <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            {(m.status === 'PAUSED_DAILY_CAP' || m.status === 'PAUSED_POOL') && (
              <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            {m.statusMessage}
          </p>
        )}

        {m.cooldownEndsAt && (
          <p className="font-mono text-[10px] text-muted-foreground">
            {COPY.missions.cooldownUntil(
              new Date(m.cooldownEndsAt).toLocaleString(),
            )}
          </p>
        )}

        <Button
          className={cn(
            'w-full font-semibold',
            m.canClaim && 'bg-success hover:bg-success/90',
          )}
          disabled={!m.canClaim || claiming}
          onClick={onClaim}
        >
          {claiming
            ? COPY.missions.claiming
            : m.canClaim
              ? COPY.missions.claim(m.rewardLabel)
              : m.status === 'CLAIMED'
                ? COPY.missions.claimed
                : m.status === 'PAUSED_DAILY_CAP' || m.status === 'PAUSED_POOL'
                  ? COPY.missions.pausedLabel
                  : m.status === 'COOLDOWN'
                    ? COPY.missions.onCooldown
                    : COPY.missions.remainingCount(
                        Math.max(0, m.target - m.progress),
                      )}
        </Button>
      </CardContent>
    </Card>
  );
}

function statusStyles(status: MissionUiStatus): {
  label: string;
  badge: string;
  message: string;
} {
  switch (status) {
    case 'CLAIMABLE':
      return {
        label: COPY.missions.statusClaimable,
        badge: 'border-success/40 bg-success/15 text-success',
        message: 'text-success',
      };
    case 'CLAIMED':
      return {
        label: COPY.missions.statusClaimed,
        badge: 'border-border bg-muted text-muted-foreground',
        message: 'text-muted-foreground',
      };
    case 'PAUSED_DAILY_CAP':
    case 'PAUSED_POOL':
      return {
        label: COPY.missions.statusPaused,
        badge: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
        message: 'text-amber-300',
      };
    case 'COOLDOWN':
      return {
        label: COPY.missions.statusCooldown,
        badge: 'border-primary/30 bg-primary/10 text-primary',
        message: 'text-primary',
      };
    default:
      return {
        label: COPY.missions.statusInProgress,
        badge: 'border-border bg-secondary text-muted-foreground',
        message: 'text-muted-foreground',
      };
  }
}

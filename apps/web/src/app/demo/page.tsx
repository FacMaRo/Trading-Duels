'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Radar, Users, X, Zap } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { brApi, type BrQueueSnapshot } from '@/lib/api';
import { ensureBrSocketConnected } from '@/lib/socket';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BR_ASSETS, type BrAsset } from '@trading-duels/shared';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/copy';
import { PrizeBreakdownCard } from '@/components/br/prize-breakdown-card';

type Step = 'nick' | 'asset' | 'queue';

export default function DemoPage() {
  const { user, startDemo, loading: authLoading } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>('nick');
  const [nickname, setNickname] = useState('');
  const [asset, setAsset] = useState<BrAsset>('EURUSD');
  const [queue, setQueue] = useState<BrQueueSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (user) setStep((s) => (s === 'nick' ? 'asset' : s));
  }, [user, authLoading]);

  useEffect(() => {
    if (!user) return;
    brApi
      .me()
      .then((snap) => {
        if (!snap) return;
        if (snap.phase === 'queue' && snap.isDemo) {
          setQueue(snap);
          setStep('queue');
        }
        if (
          snap.phase === 'match' &&
          snap.isDemo &&
          (snap.status === 'LIVE' || snap.status === 'SETTLING')
        ) {
          router.push(`/br/${snap.matchId}`);
        }
      })
      .catch(() => {});
  }, [user, router]);

  // Live queue updates via Socket.IO
  useEffect(() => {
    if (!user) return;
    const socket = ensureBrSocketConnected();
    const onYou = (p: { matchId: string }) => {
      if (p?.matchId) router.push(`/br/${p.matchId}`);
    };
    const onQ = (snap: BrQueueSnapshot) => {
      if (!snap?.matchId) return;
      setQueue((prev) => {
        // Prefer updates for our current queue match
        if (prev && prev.matchId === snap.matchId) {
          return {
            ...prev,
            ...snap,
            phase: 'queue',
            isDemo: snap.isDemo ?? prev.isDemo ?? true,
          };
        }
        // Accept first demo snapshot if we are waiting without local state
        if (!prev && (snap.isDemo || snap.demoBotsEnabled)) {
          return { ...snap, phase: 'queue' as const };
        }
        return prev;
      });
    };
    const onStarted = (p: { matchId: string; userId?: string }) => {
      if (p?.userId && p.userId !== user.id) return;
      if (p?.matchId) router.push(`/br/${p.matchId}`);
    };
    socket.on('br:you_started', onYou);
    socket.on('br:match_started', onStarted);
    socket.on('br:queue_update', onQ);
    socket.on('br:queue', onQ);
    return () => {
      socket.off('br:you_started', onYou);
      socket.off('br:match_started', onStarted);
      socket.off('br:queue_update', onQ);
      socket.off('br:queue', onQ);
    };
  }, [user, router]);

  // Polling fallback while finding match (if WS is down / flaky in production)
  useEffect(() => {
    if (step !== 'queue' || !user) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const snap = await brApi.me();
        if (cancelled || !snap) return;
        if (snap.phase === 'queue') {
          setQueue((prev) => {
            if (prev && prev.matchId !== snap.matchId) return prev;
            return snap;
          });
        } else if (
          snap.phase === 'match' &&
          (snap.status === 'LIVE' ||
            snap.status === 'SETTLING' ||
            snap.status === 'COUNTDOWN')
        ) {
          router.push(`/br/${snap.matchId}`);
        }
      } catch {
        /* ignore transient poll errors */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [step, user, router]);

  async function submitNick() {
    setError('');
    setBusy(true);
    try {
      if (!user) await startDemo(nickname);
      setStep('asset');
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.common.error);
    } finally {
      setBusy(false);
    }
  }

  const joinDemo = useCallback(async () => {
    setError('');
    setBusy(true);
    try {
      if (!user) await startDemo(nickname || 'Trader');
      // Ensure WS is up before bots start filling so we receive br:queue_update
      ensureBrSocketConnected();
      const snap = await brApi.joinDemoQueue({ asset });
      setQueue(snap);
      setStep('queue');
      if (snap.status === 'LIVE') router.push(`/br/${snap.matchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.common.error);
    } finally {
      setBusy(false);
    }
  }, [user, startDemo, nickname, asset, router]);

  const leave = useCallback(async () => {
    setBusy(true);
    try {
      await brApi.leaveQueue();
      setQueue(null);
      setStep('asset');
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.common.error);
    } finally {
      setBusy(false);
    }
  }, []);

  const countdownMs = queue?.countdownEndsAt
    ? Math.max(0, new Date(queue.countdownEndsAt).getTime() - now)
    : null;

  if (authLoading) {
    return (
      <div className="flex justify-center py-24 text-sm text-muted-foreground">
        {COPY.demo.loading}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-8 pb-24 pt-4 md:pb-10">
      <div className="text-center">
        <span className="inline-flex rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
          {COPY.demo.badge}
        </span>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          {step === 'nick' && COPY.demo.nickTitle}
          {step === 'asset' && COPY.demo.assetTitle}
          {step === 'queue' && COPY.demo.queueTitle}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {step === 'nick' && COPY.demo.nickHint}
          {step === 'asset' && COPY.demo.assetHint}
          {step === 'queue' && COPY.demo.queueHint}
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
          {error}
        </p>
      )}

      {step === 'nick' && (
        <section className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-panel">
          <div>
            <label className="label-caps mb-2 block">{COPY.demo.nickLabel}</label>
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={COPY.demo.nickPlaceholder}
              maxLength={16}
              className="h-12 text-center text-base"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitNick();
              }}
              autoFocus
            />
          </div>
          <Button
            size="lg"
            className="h-14 w-full text-base font-bold"
            disabled={busy || nickname.trim().length < 2}
            onClick={() => void submitNick()}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              COPY.demo.continue
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/" className="hover:text-foreground hover:underline">
              {COPY.demo.back}
            </Link>
          </p>
        </section>
      )}

      {step === 'asset' && (
        <section className="space-y-5 rounded-lg border border-border bg-card p-5 shadow-panel">
          <div>
            <p className="label-caps mb-2">{COPY.lobby.asset}</p>
            <div className="grid grid-cols-2 gap-2">
              {BR_ASSETS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAsset(a)}
                  className={cn(
                    'h-12 rounded-md border font-mono text-sm font-semibold transition-colors',
                    asset === a
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <Button
            size="lg"
            className="h-14 w-full text-base font-bold"
            disabled={busy}
            onClick={() => void joinDemo()}
          >
            {busy ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {COPY.demo.entering}
              </>
            ) : (
              <>
                <Radar className="h-5 w-5" />
                {COPY.demo.findMatch} · {asset}
              </>
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            <button
              type="button"
              className="hover:text-foreground hover:underline"
              onClick={() => setStep('nick')}
            >
              Change nickname
            </button>
          </p>
        </section>
      )}

      {step === 'queue' && queue && (
        <section className="rounded-lg border border-primary/30 bg-card p-5 shadow-panel">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <p className="label-caps mb-1 flex items-center gap-1.5 text-primary">
                <Zap className="h-3 w-3" />
                {COPY.demo.queueBadge}
              </p>
              <h2 className="font-mono text-xl font-semibold">{queue.asset}</h2>
            </div>
            <div className="text-right">
              <p className="mono-num text-2xl font-bold tabular-nums">
                {queue.playerCount}
                <span className="text-base text-muted-foreground">
                  /{queue.maxPlayers}
                </span>
              </p>
              <p className="label-caps">{COPY.demo.players}</p>
            </div>
          </div>

          <div className="mb-4 h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{
                width: `${Math.min(100, (queue.playerCount / queue.maxPlayers) * 100)}%`,
              }}
            />
          </div>

          {queue.playerCount < queue.minPlayers && (
            <div className="mb-4 rounded-md border border-border bg-secondary/30 px-3 py-2.5 text-sm">
              {COPY.demo.waitingMin(
                queue.minPlayers,
                queue.minPlayers - queue.playerCount,
              )}
            </div>
          )}

          {queue.status === 'COUNTDOWN' && countdownMs != null && (
            <div className="mb-4 rounded-md border border-primary/30 bg-primary/10 px-4 py-4 text-center">
              <p className="label-caps text-primary">{COPY.demo.startsIn}</p>
              <p className="mono-num text-4xl font-bold tabular-nums text-primary">
                {formatCd(countdownMs)}
              </p>
            </div>
          )}

          {queue.prizeStructure && (
            <PrizeBreakdownCard
              structure={queue.prizeStructure}
              className="mb-4"
              compact
              virtual
            />
          )}

          <div className="mb-4 space-y-1.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground/90">
              {COPY.demo.demoStakeLine}
            </p>
            <div className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {COPY.demo.noMoney}
            </div>
            {(queue.demoBotsEnabled || queue.isDemo) && (
              <p className="text-[11px] text-muted-foreground/80">
                {COPY.demo.botsHint}
              </p>
            )}
          </div>

          <Button
            variant="outline"
            className="w-full"
            size="lg"
            disabled={busy}
            onClick={() => void leave()}
          >
            <X className="h-4 w-4" />
            {COPY.demo.cancel}
          </Button>
        </section>
      )}

      <p className="text-center text-xs text-muted-foreground">
        <Link
          href="/register?next=/lobby"
          className="text-primary hover:underline"
        >
          {COPY.demo.wantReal}
        </Link>
      </p>
    </div>
  );
}

function formatCd(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

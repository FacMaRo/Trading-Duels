'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Radar, Ticket, Users, X, Zap } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import {
  brApi,
  premiumApi,
  type BrFreeEntryStatus,
  type BrQueueSnapshot,
} from '@/lib/api';
import { ensureBrSocketConnected } from '@/lib/socket';
import { Button } from '@/components/ui/button';
import { PremiumBadge } from '@/components/ui/premium-badge';
import { PremiumUpsellCard } from '@/components/br/premium-upsell-card';
import { useRequireAuth } from '@/hooks/use-require-auth';
import {
  BR_ASSETS,
  BR_FREE_ENTRY_STAKE,
  BR_STAKES,
  isBrAsset,
  isBrStake,
  type BrAsset,
  type BrStake,
} from '@trading-duels/shared';
import { cn, formatUsd } from '@/lib/utils';
import { PrizeBreakdownCard } from '@/components/br/prize-breakdown-card';
import { COPY } from '@/lib/copy';

export default function LobbyPage() {
  const { user, wallet, refreshWallet, refreshMe } = useAuth();
  const requireAuth = useRequireAuth();
  const router = useRouter();
  const search = useSearchParams();

  const initialStake = (() => {
    const n = Number(search.get('stake'));
    return isBrStake(n) ? n : 5;
  })();
  const initialAsset = (() => {
    const a = (search.get('asset') || 'EURUSD').toUpperCase();
    return isBrAsset(a) ? a : 'EURUSD';
  })();
  const autoJoin = search.get('auto') === '1';

  const [stake, setStake] = useState<BrStake>(initialStake);
  const [asset, setAsset] = useState<BrAsset>(initialAsset);
  const [queue, setQueue] = useState<BrQueueSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [freeEntry, setFreeEntry] = useState<BrFreeEntryStatus | null>(null);
  const autoStarted = useRef(false);

  const available = wallet?.availableBalance ?? 0;
  const canUseFreeEntry =
    !!user?.isPremium &&
    !!freeEntry?.available &&
    stake === BR_FREE_ENTRY_STAKE;
  const creditCountForStake =
    freeEntry?.credits?.availableByStake?.[String(stake)] ?? 0;
  const canUseFreeEntryCredit = !!user && creditCountForStake > 0;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  const loadFreeEntry = useCallback(async () => {
    if (!user) {
      setFreeEntry(null);
      return;
    }
    try {
      setFreeEntry(await brApi.freeEntry());
    } catch {
      setFreeEntry(null);
    }
  }, [user]);

  // Restore active queue / match + free entry
  useEffect(() => {
    if (!user) return;
    void loadFreeEntry();
    brApi
      .me()
      .then((snap) => {
        if (!snap) return;
        if (snap.phase === 'queue') setQueue(snap);
        if (
          snap.phase === 'match' &&
          (snap.status === 'LIVE' || snap.status === 'SETTLING')
        ) {
          router.push(`/br/${snap.matchId}`);
        }
      })
      .catch(() => {});
  }, [user, router, loadFreeEntry]);

  // Socket: queue updates + start
  useEffect(() => {
    if (!user) return;
    const socket = ensureBrSocketConnected();

    const onQueue = (snap: BrQueueSnapshot) => {
      setQueue((prev) => {
        if (prev && prev.matchId === snap.matchId) return snap;
        // If we had no queue but the update is our match (post join)
        if (!prev && snap.players?.some(() => true)) return snap;
        return prev;
      });
    };
    const onYouStarted = (p: { matchId: string }) => {
      refreshWallet();
      router.push(`/br/${p.matchId}`);
    };
    const onStarted = (p: { matchId: string; userId?: string }) => {
      if (p.userId && p.userId !== user.id) return;
      if (p.matchId) {
        refreshWallet();
        router.push(`/br/${p.matchId}`);
      }
    };

    socket.on('br:queue_update', onQueue);
    socket.on('br:queue', onQueue);
    socket.on('br:match_started', onStarted);
    socket.on('br:you_started', onYouStarted);

    return () => {
      socket.off('br:queue_update', onQueue);
      socket.off('br:queue', onQueue);
      socket.off('br:match_started', onStarted);
      socket.off('br:you_started', onYouStarted);
    };
  }, [user, router, refreshWallet]);

  const join = useCallback(
    async (opts?: { useFreeEntry?: boolean; useFreeEntryCredit?: boolean }) => {
      if (!requireAuth('matchmaking')) return;
      setError('');
      setBusy(true);
      try {
        const snap = await brApi.joinQueue({
          stake,
          asset,
          useFreeEntry: !!opts?.useFreeEntry,
          useFreeEntryCredit: !!opts?.useFreeEntryCredit,
        });
        setQueue(snap);
        await refreshWallet();
        await loadFreeEntry();
        if (snap.status === 'LIVE') {
          router.push(`/br/${snap.matchId}`);
        }
        // Clear ?auto=1
        if (typeof window !== 'undefined' && autoJoin) {
          const url = new URL(window.location.href);
          url.searchParams.delete('auto');
          window.history.replaceState({}, '', url.pathname + url.search);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : COPY.lobby.joinError,
        );
      } finally {
        setBusy(false);
      }
    },
    [requireAuth, stake, asset, refreshWallet, router, autoJoin, loadFreeEntry],
  );

  // Re-queue from end-of-match modal: /lobby?stake=&asset=&auto=1
  useEffect(() => {
    if (!autoJoin || !user || autoStarted.current || busy || queue) return;
    const canAfford =
      stake <= available + 1e-9 ||
      canUseFreeEntryCredit ||
      canUseFreeEntry;
    if (!canAfford) {
      setError(COPY.lobby.insufficient(stake));
      autoStarted.current = true;
      return;
    }
    autoStarted.current = true;
    // Prefer credit when no cash, else paid join
    if (stake > available + 1e-9 && canUseFreeEntryCredit) {
      void join({ useFreeEntryCredit: true });
    } else if (stake > available + 1e-9 && canUseFreeEntry) {
      void join({ useFreeEntry: true });
    } else {
      void join();
    }
  }, [
    autoJoin,
    user,
    busy,
    queue,
    stake,
    available,
    join,
    canUseFreeEntryCredit,
    canUseFreeEntry,
  ]);

  const leave = useCallback(async () => {
    setBusy(true);
    try {
      await brApi.leaveQueue();
      setQueue(null);
      await refreshWallet();
      await loadFreeEntry();
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.lobby.leaveError);
    } finally {
      setBusy(false);
    }
  }, [refreshWallet, loadFreeEntry]);

  const countdownMs = queue?.countdownEndsAt
    ? Math.max(0, new Date(queue.countdownEndsAt).getTime() - now)
    : null;

  const inQueue = !!queue;

  return (
    <div className="mx-auto max-w-xl space-y-8 pb-24 md:pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="label-caps mb-1.5 text-primary">{COPY.lobby.eyebrow}</p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {COPY.lobby.title}
            {user?.isPremium && <PremiumBadge size="md" />}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {COPY.lobby.subtitle}
          </p>
          {user?.isPremium && (
            <p className="mt-1 text-xs text-amber-200/80">
              {COPY.lobby.premiumPerks}
            </p>
          )}
        </div>
        {user?.isPremium && (
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0 text-xs"
            onClick={async () => {
              await premiumApi.set(false);
              await refreshMe();
              await loadFreeEntry();
            }}
          >
            {COPY.lobby.deactivatePremium}
          </Button>
        )}
      </div>

      {!user && (
        <div className="rounded-md border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
          {COPY.lobby.guestNote}
        </div>
      )}

      {user && !user.isPremium && (
        <PremiumUpsellCard
          busy={busy}
          onActivate={async () => {
            setBusy(true);
            try {
              await premiumApi.set(true);
              await refreshMe();
              await loadFreeEntry();
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {user?.isPremium && freeEntry && (
        <div
          className={cn(
            'flex flex-col gap-2 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
            freeEntry.available
              ? 'border-amber-500/30 bg-amber-500/5'
              : 'border-border bg-secondary/25',
          )}
        >
          <div className="flex items-start gap-2 text-sm">
            <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div>
              {freeEntry.available ? (
                <>
                  <p className="font-medium text-foreground">
                    {COPY.lobby.freeEntryAvailable}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {COPY.lobby.freeEntryAvailableHint(freeEntry.weekKey)}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-foreground">
                    {COPY.lobby.freeEntryUsed}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {COPY.lobby.freeEntryNext(freeEntry.daysUntilNext)}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {user && freeEntry?.credits && Object.keys(freeEntry.credits.availableByStake).length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-success/30 bg-success/5 px-4 py-3 text-sm">
          <div className="flex items-start gap-2">
            <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div>
              <p className="font-medium text-foreground">
                {COPY.lobby.freeCreditsTitle}
              </p>
              <p className="text-xs text-muted-foreground">
                {COPY.lobby.freeCreditsHint(
                  Object.entries(freeEntry.credits.availableByStake)
                    .map(([s, n]) =>
                      COPY.lobby.freeCreditForStake(n as number, s),
                    )
                    .join(' · '),
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {inQueue && queue ? (
        <QueuePanel
          queue={queue}
          countdownMs={countdownMs}
          busy={busy}
          onLeave={leave}
        />
      ) : (
        <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
          <div className="space-y-6">
            <div>
              <p className="label-caps mb-2">{COPY.lobby.stake}</p>
              <div className="grid grid-cols-3 gap-2">
                {BR_STAKES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStake(s)}
                    className={cn(
                      'h-12 rounded-md border font-mono text-base font-semibold transition-colors',
                      stake === s
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:bg-secondary',
                    )}
                  >
                    ${s}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {COPY.lobby.available} {formatUsd(available)}
              </p>
            </div>

            <div>
              <p className="label-caps mb-2">{COPY.lobby.asset}</p>
              <div className="grid grid-cols-2 gap-2">
                {BR_ASSETS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAsset(a)}
                    className={cn(
                      'h-11 rounded-md border font-mono text-sm font-semibold transition-colors',
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

            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="space-y-2">
              <Button
                size="lg"
                className="h-14 w-full text-base font-bold"
                disabled={
                  busy ||
                  (user != null &&
                    available < stake &&
                    !canUseFreeEntry &&
                    !canUseFreeEntryCredit)
                }
                onClick={() => void join()}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {COPY.lobby.joining}
                  </>
                ) : (
                  <>
                    <Radar className="h-5 w-5" />
                    {COPY.lobby.findMatch} · {asset} · {formatUsd(stake)}
                  </>
                )}
              </Button>

              {canUseFreeEntryCredit && (
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 w-full border-success/35 font-semibold text-success hover:bg-success/10"
                  disabled={busy}
                  onClick={() => void join({ useFreeEntryCredit: true })}
                >
                  <Ticket className="h-4 w-4" />
                  {COPY.lobby.useCreditEntry(String(stake))} · {asset}
                  {creditCountForStake > 1 ? ` (${creditCountForStake})` : ''}
                </Button>
              )}

              {canUseFreeEntry && (
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 w-full border-amber-500/35 font-semibold text-amber-100 hover:bg-amber-500/10"
                  disabled={busy}
                  onClick={() => void join({ useFreeEntry: true })}
                >
                  <Ticket className="h-4 w-4" />
                  {COPY.lobby.useFreeEntry} · {asset}
                </Button>
              )}

              {user?.isPremium &&
                freeEntry?.available &&
                stake !== BR_FREE_ENTRY_STAKE && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    {COPY.lobby.freeEntryOnlyStake1}
                  </p>
                )}
            </div>

            <ul className="space-y-1 text-xs text-muted-foreground">
              {COPY.lobby.rules.map((rule) => (
                <li key={rule}>· {rule}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

function QueuePanel({
  queue,
  countdownMs,
  busy,
  onLeave,
}: {
  queue: BrQueueSnapshot;
  countdownMs: number | null;
  busy: boolean;
  onLeave: () => void;
}) {
  const pct = Math.min(100, (queue.playerCount / queue.maxPlayers) * 100);
  const waitingMin = queue.playerCount < queue.minPlayers;
  const inCountdown = queue.status === 'COUNTDOWN';

  return (
    <section className="rounded-lg border border-primary/30 bg-card p-5 shadow-panel sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="label-caps mb-1 flex items-center gap-1.5 text-primary">
            <Zap className="h-3 w-3" />
            {COPY.lobby.inQueue}
          </p>
          <h2 className="text-xl font-semibold">
            {queue.asset} · {formatUsd(queue.stake)}
          </h2>
        </div>
        <div className="text-right">
          <p className="count-tick text-2xl font-bold">
            {queue.playerCount}
            <span className="text-base text-muted-foreground">
              /{queue.maxPlayers}
            </span>
          </p>
          <p className="label-caps">{COPY.lobby.players}</p>
        </div>
      </div>

      <div className="mb-4 h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            inCountdown ? 'bg-primary' : 'bg-primary/60',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {waitingMin && (
        <div className="mb-4 rounded-md border border-border bg-secondary/30 px-4 py-3 text-sm">
          <p className="font-medium">{COPY.lobby.waitingMin(queue.minPlayers)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {COPY.lobby.waitingMinHint(queue.minPlayers - queue.playerCount)}
          </p>
        </div>
      )}

      {inCountdown && countdownMs != null && (
        <div className="mb-4 rounded-md border border-primary/30 bg-primary/10 px-4 py-4 text-center">
          <p className="label-caps mb-1 text-primary">{COPY.lobby.matchStartsIn}</p>
          <p className="count-tick text-4xl font-bold text-primary">
            {formatCd(countdownMs)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {COPY.lobby.canStillJoin(queue.maxPlayers)}
          </p>
        </div>
      )}

      {queue.prizeStructure && (
        <PrizeBreakdownCard
          structure={queue.prizeStructure}
          className="mb-4"
        />
      )}

      <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {COPY.lobby.prizePool}{' '}
          {formatUsd(
            queue.prizeStructure?.prizePool ?? queue.prizePool,
          )}
        </span>
        <span>
          {COPY.lobby.pot}{' '}
          {formatUsd(queue.prizeStructure?.pot ?? queue.pot)}
        </span>
      </div>

      {(queue.premiumCount ?? 0) > 0 && (
        <p className="mb-2 text-[11px] text-amber-200/70">
          {COPY.lobby.premiumInQueue(queue.premiumCount ?? 0)}
        </p>
      )}

      {queue.players?.length > 0 && (
        <div className="mb-4 max-h-32 overflow-y-auto rounded-md border border-border bg-secondary/20 p-2">
          <div className="flex flex-wrap gap-1.5">
            {queue.players.map((p) => (
              <span
                key={p.username + p.joinedAt}
                className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-[11px] font-medium"
              >
                @{p.username}
                {p.isPremium && <PremiumBadge showLabel={false} />}
              </span>
            ))}
          </div>
        </div>
      )}

      <Button
        variant="outline"
        className="w-full"
        size="lg"
        disabled={busy}
        onClick={onLeave}
      >
        <X className="h-4 w-4" />
        {COPY.lobby.cancelQueue}
      </Button>
    </section>
  );
}

function formatCd(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

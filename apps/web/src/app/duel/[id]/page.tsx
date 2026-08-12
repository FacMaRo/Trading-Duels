'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Eye, Swords } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import {
  duelsApi,
  type ArenaTradeDto,
  type DuelSnapshot,
} from '@/lib/api';
import { ensureDuelsSocketConnected } from '@/lib/socket';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { AUTH_REASONS, buildLoginUrl } from '@/lib/auth-redirect';
import { PriceChart } from '@/components/duel/price-chart';
import { TradeForm } from '@/components/duel/trade-form';
import { TradeList } from '@/components/duel/trade-list';
import { ArenaTimer } from '@/components/duel/arena-timer';
import { ArenaScoreboard } from '@/components/duel/arena-scoreboard';
import { RaiseAlert } from '@/components/duel/raise-alert';
import { RaisePanel } from '@/components/duel/raise-panel';
import { DuelChat } from '@/components/duel/duel-chat';
import { SpectatorBetsPanel } from '@/components/duel/spectator-bets-panel';
import {
  MatchResultModal,
  type MatchOutcome,
} from '@/components/duel/match-result-modal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  MODE_MAX_RISK,
  MODE_MAX_TRADES,
  TIMEFRAMES,
  phaseLabel,
} from '@/lib/arena';
import { cn, formatUsd } from '@/lib/utils';

export default function DuelArenaPage() {
  const params = useParams();
  const search = useSearchParams();
  const id = params.id as string;
  const { user, wallet, refreshWallet, loading: authLoading } = useAuth();
  const requireAuth = useRequireAuth();
  const router = useRouter();

  const [duel, setDuel] = useState<DuelSnapshot | null>(null);
  const [trades, setTrades] = useState<ArenaTradeDto[]>([]);
  const [error, setError] = useState('');
  const [asset, setAsset] = useState('EURUSD');
  const [tf, setTf] = useState<string>('1m');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [resultModalSeen, setResultModalSeen] = useState(false);

  const applySnapshot = useCallback((snap: DuelSnapshot) => {
    setDuel(snap);
    if (snap.trades) setTrades(snap.trades);
    // Activo siempre fijo en el duelo (definido al match / challenge)
    if (snap.primaryAsset) {
      setAsset(snap.primaryAsset);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const snap = await duelsApi.get(id);
      applySnapshot(snap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  }, [id, applySnapshot]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    const socket = ensureDuelsSocketConnected();

    // Espectador o jugador: el backend decide el rol en el snapshot
    // Visitantes sin cuenta siempre como espectador
    if (!user || search.get('spectate') === '1') {
      socket.emit('duel:spectate', { duelId: id });
    } else {
      socket.emit('duel:subscribe', { duelId: id });
    }

    const onState = (snap: DuelSnapshot) => applySnapshot(snap);
    const onFinished = () => {
      load();
      refreshWallet();
    };
    const onError = (p: { message: string }) => setError(p.message);
    const onTrade = (t: ArenaTradeDto) => {
      setTrades((prev) => {
        const idx = prev.findIndex((x) => x.id === t.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = t;
          return next;
        }
        return [...prev, t];
      });
    };
    const onTick = (tick: { asset: string; mid: number }) => {
      if (tick.asset === asset) setLivePrice(tick.mid);
    };

    socket.on('duel:state', onState);
    socket.on('duel:finished', onFinished);
    socket.on('duel:phase', () => load());
    socket.on('duel:error', onError);
    socket.on('duel:raise', () => load());
    socket.on('duel:raise_result', () => {
      load();
      refreshWallet();
    });
    socket.on('duel:trade', onTrade);
    socket.on('duel:trade_update', onTrade);
    socket.on('price:tick', onTick);

    return () => {
      socket.emit('duel:unsubscribe', { duelId: id });
      socket.off('duel:state', onState);
      socket.off('duel:finished', onFinished);
      socket.off('duel:error', onError);
      socket.off('duel:trade', onTrade);
      socket.off('duel:trade_update', onTrade);
      socket.off('price:tick', onTick);
    };
  }, [id, load, refreshWallet, applySnapshot, asset, search, user, authLoading]);

  const isPlayer = useMemo(() => {
    if (!duel || !user) return false;
    return (
      duel.playerA.userId === user.id ||
      duel.playerB?.userId === user.id
    );
  }, [duel, user]);

  // Visitante o no participante → modo espectador (solo lectura + apuestas con login)
  const spectatorMode =
    !user ||
    (!!duel &&
      (duel.viewerRole === 'SPECTATOR' || (!isPlayer && !!duel.playerB)));

  const me = useMemo(() => {
    if (!duel || !user) return null;
    if (spectatorMode) return duel.playerA;
    if (duel.playerA.userId === user.id) return duel.playerA;
    if (duel.playerB?.userId === user.id) return duel.playerB;
    return null;
  }, [duel, user, spectatorMode]);

  const opponent = useMemo(() => {
    if (!duel || !user) return null;
    if (spectatorMode) return duel.playerB;
    if (duel.playerA.userId === user.id) return duel.playerB;
    return duel.playerA;
  }, [duel, user, spectatorMode]);

  const phaseMs = duel?.phaseEndsAt
    ? Math.max(0, new Date(duel.phaseEndsAt).getTime() - now)
    : 0;

  const canTrade =
    !spectatorMode &&
    (duel?.status === 'PREPARATION' || duel?.status === 'DEVELOPMENT');
  const canRaise = !spectatorMode && duel?.status === 'DEVELOPMENT';
  const isFinished =
    duel?.status === 'COMPLETED' || duel?.status === 'DRAW';

  // Modal de fin de partida: solo jugadores, una vez por duelo
  useEffect(() => {
    if (!isFinished || spectatorMode || !user || resultModalSeen) return;
    setResultModalOpen(true);
    setResultModalSeen(true);
    void refreshWallet();
  }, [isFinished, spectatorMode, user, resultModalSeen, refreshWallet]);

  // Reset modal flag al cambiar de duelo
  useEffect(() => {
    setResultModalOpen(false);
    setResultModalSeen(false);
  }, [id]);

  const maxRisk = MODE_MAX_RISK[duel?.mode ?? 'NORMAL'] ?? 4;
  const maxTrades = MODE_MAX_TRADES[duel?.mode ?? 'NORMAL'] ?? 3;
  const riskLeft = maxRisk - (me?.totalRiskUsedPct ?? 0);
  const tradesLeft = maxTrades - (me?.tradeCount ?? 0);

  /** Trades activos (OPEN/PENDING) con etiqueta de dueño para el chart */
  const chartTrades = useMemo(() => {
    const nameById = new Map<string, string>();
    if (duel?.playerA) {
      nameById.set(
        duel.playerA.userId,
        user?.id === duel.playerA.userId && !spectatorMode
          ? 'Me'
          : duel.playerA.username,
      );
    }
    if (duel?.playerB) {
      nameById.set(
        duel.playerB.userId,
        user?.id === duel.playerB.userId && !spectatorMode
          ? 'Me'
          : duel.playerB.username,
      );
    }

    return trades
      .filter((t) => t.status === 'OPEN' || t.status === 'PENDING')
      .map((t) => ({
        id: t.id,
        asset: t.asset,
        side: t.side,
        status: t.status,
        entryPrice: t.entryPrice,
        stopLoss: t.stopLoss,
        takeProfit: t.takeProfit,
        label: nameById.get(t.userId) ?? t.side,
      }));
  }, [trades, duel, user?.id, spectatorMode]);

  const iWon =
    !spectatorMode &&
    isFinished &&
    duel &&
    user &&
    duel.status !== 'DRAW' &&
    me != null &&
    opponent != null &&
    (me.totalR > opponent.totalR ||
      (me.totalR === opponent.totalR && me.totalPnl > opponent.totalPnl));

  const matchOutcome: MatchOutcome = useMemo(() => {
    if (duel?.status === 'DRAW') return 'draw';
    if (iWon) return 'win';
    return 'loss';
  }, [duel?.status, iWon]);

  function buildRematchUrl(nextStake: number, auto: boolean) {
    const params = new URLSearchParams();
    params.set('mode', duel?.mode ?? 'NORMAL');
    params.set('stake', String(nextStake));
    if (duel?.primaryAsset) params.set('asset', duel.primaryAsset);
    if (auto) params.set('auto', '1');
    return `/lobby?${params.toString()}`;
  }

  const raiseFromName =
    duel?.pendingRaise && opponent
      ? duel.pendingRaise.fromUserId === opponent.userId
        ? opponent.username
        : me?.username
      : undefined;

  async function ready() {
    setBusy(true);
    try {
      const snap = await duelsApi.ready(id);
      applySnapshot(snap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function proposeRaise(newStake: number) {
    setBusy(true);
    try {
      await duelsApi.proposeRaise(id, newStake);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function respondRaise(action: 'ACCEPT' | 'REJECT') {
    if (!duel?.pendingRaise) return;
    setBusy(true);
    try {
      await duelsApi.respondRaise(id, duel.pendingRaise.id, action);
      await load();
      await refreshWallet();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function closeTrade(tradeId: string) {
    setBusy(true);
    try {
      await duelsApi.closeTrade(id, tradeId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function cancelTrade(tradeId: string) {
    setBusy(true);
    try {
      await duelsApi.cancelTrade(id, tradeId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  if (error && !duel) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" onClick={() => router.push('/lobby')}>
          Back to Lobby
        </Button>
      </div>
    );
  }

  if (!duel) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <Swords className="h-8 w-8 animate-pulse text-primary" />
          <p className="text-sm">Entering arena…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="arena-root -mx-4 -mt-6 flex min-h-[calc(100vh-3.5rem)] flex-col bg-[hsl(210_22%_5%)] pb-16 md:pb-0">
      {/* Arena header — stake / pot / timer dominate hierarchy */}
      <header className="sticky top-14 z-30 border-b border-border bg-[hsl(210_20%_6%/0.96)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:px-4 lg:gap-5">
          <Link
            href="/lobby"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title="Exit"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="font-semibold tracking-wide">
              {duel.mode}
            </Badge>
            <Badge variant="outline" className="mono-num font-medium text-foreground">
              {duel.primaryAsset ?? asset}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                duel.status === 'DEVELOPMENT' && 'border-primary/30 text-primary',
                duel.status === 'PREPARATION' && 'border-warning/30 text-warning',
              )}
            >
              {phaseLabel(duel.status)}
            </Badge>
          </div>

          <div className="hidden h-7 w-px bg-border sm:block" />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <div>
              <p className="label-caps">Stake</p>
              <p className="mono-num text-sm font-semibold text-foreground">
                {formatUsd(me?.stake ?? 0)}
              </p>
            </div>
            <div>
              <p className="label-caps">Pot</p>
              <p className="mono-num text-sm font-semibold text-foreground">
                {formatUsd(duel.pot)}
              </p>
            </div>
            <div className="hidden md:block">
              <p className="label-caps">Prize</p>
              <p className="mono-num text-sm font-semibold text-success">
                {formatUsd(duel.winnerPrize)}
              </p>
            </div>
            {livePrice != null && (
              <div className="hidden lg:block">
                <p className="label-caps">{duel.primaryAsset ?? asset}</p>
                <p className="mono-num text-sm font-semibold text-primary">
                  {formatLive(livePrice)}
                </p>
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {spectatorMode && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Eye className="h-3 w-3" />
                Spectator
              </Badge>
            )}
            <ArenaTimer phaseMs={phaseMs} status={duel.status} />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-4">
        {spectatorMode && (
          <div className="rounded-md border border-border bg-secondary/30 px-4 py-2.5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Spectator mode.</span>{' '}
            Read-only match view.
            {user
              ? ' You can place P2P bets on the winner; 10% fee on matched bets only.'
              : ' Sign in to place P2P bets on the winner.'}
          </div>
        )}

        {/* Scoreboard */}
        <ArenaScoreboard
          me={me}
          opponent={opponent}
          isFinished={isFinished}
          isDraw={duel.status === 'DRAW'}
          iWon={!!iWon}
        />

        {/* Raise alert — solo jugadores */}
        {duel.pendingRaise && user && !spectatorMode && (
          <RaiseAlert
            pendingRaise={duel.pendingRaise}
            myUserId={user.id}
            now={now}
            busy={busy}
            fromUsername={raiseFromName}
            onAccept={() => respondRaise('ACCEPT')}
            onReject={() => respondRaise('REJECT')}
          />
        )}

        {/* Ready gate — solo jugadores */}
        {duel.status === 'MATCHED' && !spectatorMode && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-6 py-8">
            <Swords className="h-10 w-10 text-primary" />
            <div className="text-center">
              <p className="text-lg font-semibold">Match ready</p>
              <p className="text-sm text-muted-foreground">
                Both players must confirm to start preparation
              </p>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className={me?.isReady ? 'text-success' : ''}>
                You: {me?.isReady ? '✓ Ready' : '…'}
              </span>
              <span className={opponent?.isReady ? 'text-success' : ''}>
                Opponent: {opponent?.isReady ? '✓ Ready' : '…'}
              </span>
            </div>
            <Button
              size="lg"
              className="min-w-[200px]"
              onClick={ready}
              disabled={busy || me?.isReady}
            >
              {me?.isReady ? 'Waiting for opponent…' : "I'm ready"}
            </Button>
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => setError('')}
            >
              close
            </button>
          </p>
        )}

        {/* Main workspace: chart + side panels */}
        {(duel.status !== 'MATCHED' || spectatorMode) && (
          <div
            className={cn(
              'grid min-h-0 flex-1 gap-3',
              spectatorMode
                ? 'lg:grid-cols-[1fr_320px]'
                : 'lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_320px_260px]',
            )}
          >
            {/* Chart column */}
            <section className="flex min-h-[380px] flex-col overflow-hidden rounded-md border border-border bg-card shadow-panel lg:min-h-[520px]">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <span className="flex h-8 items-center rounded-md border border-border bg-secondary/50 px-2.5 font-mono text-xs font-semibold text-foreground">
                  {duel.primaryAsset ?? asset}
                </span>
                <div className="flex flex-wrap gap-0.5">
                  {TIMEFRAMES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTf(t)}
                      className={cn(
                        'h-7 rounded px-2 font-mono text-[11px] font-medium transition-colors',
                        tf === t
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <span className="label-caps ml-auto hidden sm:inline">
                  Fixed asset
                </span>
              </div>
              <div className="relative min-h-0 flex-1">
                <PriceChart
                  asset={duel.primaryAsset ?? asset}
                  timeframe={tf}
                  trades={chartTrades}
                  className="absolute inset-0"
                />
              </div>
            </section>

            {/* Side column: trading (player) or bets (spectator) */}
            <section className="flex min-h-0 flex-col gap-3">
              {spectatorMode ? (
                duel.playerB && (
                  <div className="min-h-[420px] flex-1 space-y-3">
                    {!user && (
                      <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs text-primary">
                        Guest mode: you are watching live.{' '}
                        <Link
                          href={buildLoginUrl(
                            `/duel/${id}?spectate=1`,
                            AUTH_REASONS.bet,
                          )}
                          className="font-semibold underline"
                        >
                          Sign in
                        </Link>{' '}
                        to place P2P bets.
                      </div>
                    )}
                    <SpectatorBetsPanel
                      duelId={id}
                      playerA={{
                        userId: duel.playerA.userId,
                        username: duel.playerA.username,
                      }}
                      playerB={{
                        userId: duel.playerB.userId,
                        username: duel.playerB.username,
                      }}
                      disabled={
                        !user || isFinished || duel.status === 'SETTLING'
                      }
                      availableBalance={wallet?.availableBalance ?? 0}
                      onBalanceChange={refreshWallet}
                      onRequireAuth={() => requireAuth('bet')}
                    />
                  </div>
                )
              ) : user ? (
                <>
                  <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-panel">
                    <h3 className="label-caps">My trades</h3>
                    <TradeList
                      trades={trades}
                      myUserId={user.id}
                      busy={busy}
                      onClose={canTrade ? closeTrade : undefined}
                      onCancel={canTrade ? cancelTrade : undefined}
                    />
                  </div>

                  <div className="rounded-md border border-border bg-card p-3 shadow-panel">
                    <TradeForm
                      duelId={id}
                      disabled={!canTrade}
                      maxRiskLeft={Math.max(0, riskLeft)}
                      tradesLeft={Math.max(0, tradesLeft)}
                      asset={duel.primaryAsset ?? asset}
                      livePrice={livePrice}
                      onOpened={load}
                    />
                  </div>

                  {canRaise && (
                    <RaisePanel
                      mode={duel.mode}
                      currentStake={me?.stake ?? 0}
                      raisesUsed={duel.raisesUsed[user.id] ?? 0}
                      disabled={!!duel.pendingRaise}
                      busy={busy}
                      onPropose={proposeRaise}
                    />
                  )}
                </>
              ) : null}
            </section>

            {/* Chat — solo jugadores en XL */}
            {!spectatorMode && user && (
              <section className="hidden min-h-[200px] xl:flex xl:flex-col">
                <DuelChat duelId={id} myUserId={user.id} />
              </section>
            )}
          </div>
        )}

        {/* Chat mobile / tablet (jugadores) */}
        {duel.status !== 'MATCHED' && !spectatorMode && user && (
          <div className="h-52 xl:hidden">
            <DuelChat duelId={id} myUserId={user.id} />
          </div>
        )}

        {/* Finished strip (visible si cerró el modal) */}
        {isFinished && !spectatorMode && !resultModalOpen && (
          <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-card px-6 py-5 text-center shadow-panel">
            <p className="text-lg font-semibold">
              {duel.status === 'DRAW'
                ? 'Draw — stakes refunded'
                : iWon
                  ? `Victory · +${formatUsd(duel.winnerPrize)}`
                  : 'Defeat'}
            </p>
            <p className="mono-num text-sm text-muted-foreground">
              You {me ? formatUsd(me.totalPnl) : '—'} ({me?.totalR.toFixed(2)}R)
              {' · '}
              Opponent {opponent ? formatUsd(opponent.totalPnl) : '—'} (
              {opponent?.totalR.toFixed(2)}R)
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                onClick={() =>
                  router.push(buildRematchUrl(me?.stake ?? 10, true))
                }
              >
                Play again
              </Button>
              <Button
                variant="outline"
                onClick={() => setResultModalOpen(true)}
              >
                View result
              </Button>
              <Button variant="ghost" asChild>
                <Link href="/dashboard">Dashboard</Link>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modal fin de partida — jugadores */}
      {!spectatorMode && me && opponent && (
        <MatchResultModal
          open={resultModalOpen && isFinished}
          outcome={matchOutcome}
          myR={me.totalR}
          myPnl={me.totalPnl}
          stake={me.stake}
          winnerPrize={duel.winnerPrize}
          opponentUsername={opponent.username}
          mode={duel.mode}
          asset={duel.primaryAsset}
          availableBalance={wallet?.availableBalance ?? 0}
          onClose={() => setResultModalOpen(false)}
          onPlayAgain={(nextStake) => {
            setResultModalOpen(false);
            router.push(buildRematchUrl(nextStake, true));
          }}
          onChangeStake={(nextStake) => {
            setResultModalOpen(false);
            router.push(buildRematchUrl(nextStake, false));
          }}
        />
      )}
    </div>
  );
}

function formatLive(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 10) return n.toFixed(3);
  return n.toFixed(5);
}

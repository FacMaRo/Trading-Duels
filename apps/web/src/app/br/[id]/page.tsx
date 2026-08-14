'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Trophy } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import {
  brApi,
  marketApi,
  type BrMatchSnapshot,
  type BrTradeDto,
} from '@/lib/api';
import { ensureBrSocketConnected } from '@/lib/socket';
import { PriceChart } from '@/components/duel/price-chart';
import { BrResultModal } from '@/components/br/br-result-modal';
import { BrMatchChat } from '@/components/br/br-match-chat';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PremiumBadge } from '@/components/ui/premium-badge';
import {
  PriceInput,
  parsePrice,
  validateStopLossSide,
  validateTakeProfitSide,
} from '@/components/ui/price-input';
import { ToastStack, type ToastItem } from '@/components/ui/toast';
import { cn, formatR, formatSignedUsd, formatUsd } from '@/lib/utils';
import { TIMEFRAMES } from '@/lib/arena';
import { COPY } from '@/lib/copy';
import {
  arenaSfx,
  isSfxEnabled,
  setSfxEnabled,
} from '@/lib/arena-sounds';
import {
  unrealizedTradePnlUsd,
  unrealizedTradeR,
} from '@/lib/br-pnl';
import type { BrPrizeZone } from '@/lib/api';

export default function BrArenaPage() {
  const params = useParams();
  const id = params.id as string;
  const { user, wallet, refreshWallet, loading: authLoading } = useAuth();
  const router = useRouter();

  const [match, setMatch] = useState<BrMatchSnapshot | null>(null);
  const [trades, setTrades] = useState<BrTradeDto[]>([]);
  const [error, setError] = useState('');
  const [tf, setTf] = useState('1m');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultSeen, setResultSeen] = useState(false);
  const [liveMid, setLiveMid] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSl, setEditSl] = useState('');
  const [editTp, setEditTp] = useState('');
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [forceEnding, setForceEnding] = useState(false);
  const [myRankFlash, setMyRankFlash] = useState<'up' | 'down' | null>(null);
  const prevMyRankRef = useRef<number | null>(null);
  const prevMyZoneRef = useRef<BrPrizeZone | null>(null);
  const lastRankToastAtRef = useRef(0);
  const [showEndedBanner, setShowEndedBanner] = useState(false);
  const [sfxOn, setSfxOn] = useState(false);

  useEffect(() => {
    setSfxOn(isSfxEnabled());
  }, []);

  // Trade form
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [riskPct, setRiskPct] = useState('1');
  const [formError, setFormError] = useState('');
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const tradesRef = useRef<BrTradeDto[]>([]);
  tradesRef.current = trades;

  const pushToast = useCallback((message: string, tone?: ToastItem['tone']) => {
    const tid = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-4), { id: tid, message, tone }]);
  }, []);

  const pulseTrade = useCallback((tradeId: string) => {
    setPulseIds((prev) => new Set(prev).add(tradeId));
    setTimeout(() => {
      setPulseIds((prev) => {
        const n = new Set(prev);
        n.delete(tradeId);
        return n;
      });
    }, 800);
  }, []);

  const handleTradeEvent = useCallback(
    (t: BrTradeDto) => {
      if (user?.id && t.userId && t.userId !== user.id) return;

      const prev = tradesRef.current.find((x) => x.id === t.id);
      setTrades((list) => {
        const i = list.findIndex((x) => x.id === t.id);
        if (i >= 0) {
          const n = [...list];
          n[i] = t;
          return n;
        }
        return [...list, t];
      });

      // State-change feedback
      if (prev) {
        if (prev.status === 'PENDING' && t.status === 'OPEN') {
          pushToast(COPY.arena.limitFilled, 'success');
          pulseTrade(t.id);
          arenaSfx.limitFill();
        } else if (prev.status === 'OPEN' && t.status === 'CLOSED') {
          const reason = (t.closeReason || '').toUpperCase();
          if (reason === 'SL') {
            pushToast(COPY.arena.slHit, 'danger');
          } else if (reason === 'TP') {
            pushToast(COPY.arena.tpHit, 'success');
          } else {
            pushToast(COPY.arena.closedMarket, 'info');
          }
          pulseTrade(t.id);
        }
      } else if (t.status === 'OPEN' && t.orderType === 'MARKET') {
        pulseTrade(t.id);
        arenaSfx.tradeOpen();
      }
    },
    [user?.id, pushToast, pulseTrade],
  );

  /**
   * Merge match snapshots carefully.
   * WS broadcasts (br:state / br:started) are NOT user-scoped — they omit
   * myStats/me/trades. Blindly replacing state made demo users look unseated
   * and blocked trading with "You are not seated in this match."
   */
  const apply = useCallback((snap: BrMatchSnapshot, opts?: { scoped?: boolean }) => {
    const scoped = !!opts?.scoped;
    setMatch((prev) => {
      if (!prev || prev.matchId !== snap.matchId) {
        return snap;
      }
      if (scoped) {
        // Authoritative HTTP snapshot for this user
        return snap;
      }
      // Public/WS snapshot: keep personal seat + stats + isMe flags
      const leaderboard = (snap.leaderboard ?? []).map((row) => {
        const wasMe =
          prev.me?.userId === row.userId ||
          prev.leaderboard?.find((r) => r.userId === row.userId)?.isMe;
        return { ...row, isMe: row.isMe || !!wasMe };
      });
      const meFromBoard = leaderboard.find((r) => r.isMe) ?? prev.me;
      return {
        ...snap,
        leaderboard,
        me: snap.me ?? meFromBoard ?? prev.me,
        myStats: snap.myStats ?? prev.myStats,
        trades:
          snap.trades && snap.trades.length > 0 ? snap.trades : prev.trades,
      };
    });
    if (scoped && snap.trades) {
      setTrades(snap.trades);
    } else if (snap.trades && snap.trades.length > 0) {
      setTrades(snap.trades);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const snap = await brApi.getMatch(id);
      apply(snap, { scoped: true });
      if (snap.status === 'QUEUE' || snap.status === 'COUNTDOWN') {
        router.replace(snap.isDemo ? '/demo' : '/lobby');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.common.error);
    }
  }, [id, apply, router]);

  useEffect(() => {
    if (!authLoading) void load();
  }, [authLoading, load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  // Live mid — WS ticks (primary) + REST poll fallback for unrealized PnL
  useEffect(() => {
    if (!match?.asset) return;
    let cancelled = false;
    const asset = match.asset;

    const applyMid = (mid: number) => {
      if (!cancelled && Number.isFinite(mid) && mid > 0) setLiveMid(mid);
    };

    const poll = async () => {
      try {
        const tick = await marketApi.price(asset);
        if (tick?.mid != null) applyMid(tick.mid);
      } catch {
        /* ignore */
      }
    };
    void poll();
    const pollT = setInterval(poll, 2000);

    const socket = ensureBrSocketConnected();
    socket.emit('market:subscribe', { asset });
    const onTick = (tick: {
      asset?: string;
      mid?: number;
      bid?: number;
      ask?: number;
    }) => {
      if (
        tick?.asset &&
        tick.asset.toUpperCase() !== asset.toUpperCase()
      ) {
        return;
      }
      if (tick?.mid != null) applyMid(tick.mid);
      else if (tick?.bid != null && tick?.ask != null) {
        applyMid((tick.bid + tick.ask) / 2);
      }
    };
    socket.on('price:tick', onTick);

    return () => {
      cancelled = true;
      clearInterval(pollT);
      socket.off('price:tick', onTick);
    };
  }, [match?.asset]);

  useEffect(() => {
    if (authLoading || !user) return;
    const socket = ensureBrSocketConnected();
    socket.emit('br:subscribe', { matchId: id });

    const onState = (snap: BrMatchSnapshot) => {
      // Merge public WS snapshot — never wipe myStats/me (see apply())
      apply(snap);
    };
    const onTrade = (t: BrTradeDto) => handleTradeEvent(t);
    const onFinished = (snap: BrMatchSnapshot) => {
      apply(snap);
      void load();
    };

    socket.on('br:state', onState);
    socket.on('br:started', onState);
    socket.on('br:finished', onFinished);
    socket.on('br:trade', onTrade);
    socket.on('br:trade_update', onTrade);

    return () => {
      socket.emit('br:unsubscribe', { matchId: id });
      socket.off('br:state', onState);
      socket.off('br:started', onState);
      socket.off('br:finished', onFinished);
      socket.off('br:trade', onTrade);
      socket.off('br:trade_update', onTrade);
    };
  }, [id, user, authLoading, apply, load, handleTradeEvent]);

  /** Per-trade live unrealized PnL $ (OPEN only; PENDING → null) */
  const livePnlByTradeId = useMemo(() => {
    const map = new Map<string, { pnl: number | null; r: number | null }>();
    for (const t of trades) {
      if (t.status === 'PENDING') {
        map.set(t.id, { pnl: null, r: null });
        continue;
      }
      if (t.status !== 'OPEN') continue;
      if (liveMid == null) {
        map.set(t.id, { pnl: null, r: null });
        continue;
      }
      const pnl = unrealizedTradePnlUsd({
        side: t.side,
        entryPrice: t.entryPrice,
        stopLoss: t.stopLoss,
        riskAmount: t.riskAmount,
        mid: liveMid,
      });
      const r = unrealizedTradeR({
        side: t.side,
        entryPrice: t.entryPrice,
        stopLoss: t.stopLoss,
        mid: liveMid,
      });
      map.set(t.id, { pnl, r });
    }
    return map;
  }, [trades, liveMid]);

  const openPnlSum = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const t of trades) {
      if (t.status !== 'OPEN') continue;
      const v = livePnlByTradeId.get(t.id)?.pnl;
      if (v != null) {
        sum += v;
        any = true;
      }
    }
    return any ? sum : null;
  }, [trades, livePnlByTradeId]);

  const msLeft = match?.liveEndsAt
    ? Math.max(0, new Date(match.liveEndsAt).getTime() - now)
    : 0;
  const isLive = match?.status === 'LIVE';
  const isCompleted = match?.status === 'COMPLETED';
  const isFinished =
    match?.status === 'COMPLETED' || match?.status === 'SETTLING';

  // Rank / zone change flash + toast (throttled unless zone changes)
  useEffect(() => {
    if (!isLive || !match?.me) return;
    const r = match.me.rank;
    const zone = (match.me.zone ?? 'OUT') as BrPrizeZone;
    const prevRank = prevMyRankRef.current;
    const prevZone = prevMyZoneRef.current;

    prevMyRankRef.current = r;
    prevMyZoneRef.current = zone;

    if (prevRank == null) return;
    if (prevRank === r && prevZone === zone) return;

    const improved = r < prevRank;
    setMyRankFlash(improved ? 'up' : 'down');
    const flashT = setTimeout(() => setMyRankFlash(null), 900);

    const zoneChanged = prevZone != null && prevZone !== zone;
    const rankDelta = Math.abs(r - prevRank);
    const nowTs = Date.now();
    const sinceToast = nowTs - lastRankToastAtRef.current;
    const meaningful =
      zoneChanged || rankDelta >= 2 || (rankDelta >= 1 && sinceToast > 8000);

    if (meaningful && (zoneChanged || sinceToast >= 3500)) {
      lastRankToastAtRef.current = nowTs;
      const zoneLabel =
        zone === 'PRIZE'
          ? COPY.arena.zonePrize
          : zone === 'REFUND'
            ? COPY.arena.zoneRefund
            : COPY.arena.zoneOut;
      const msg = improved
        ? COPY.arena.rankToastUp(r, zoneLabel)
        : COPY.arena.rankToastDown(r, zoneLabel);
      const tone =
        zone === 'PRIZE'
          ? 'success'
          : zone === 'REFUND'
            ? 'info'
            : improved
              ? 'info'
              : 'danger';
      pushToast(msg, tone);
      if (improved || zone === 'PRIZE' || zone === 'REFUND') {
        if (zoneChanged && improved) arenaSfx.zoneUp();
        else if (zoneChanged && !improved) arenaSfx.zoneDown();
      }
    }

    return () => clearTimeout(flashT);
    // match.me used for rank/zone; intentional narrow deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, match?.me?.rank, match?.me?.zone, pushToast]);

  useEffect(() => {
    if (!isCompleted || !user || resultSeen) return;
    setShowEndedBanner(true);
    setResultOpen(true);
    setResultSeen(true);
    arenaSfx.matchEnd();
    void refreshWallet();
    const t = setTimeout(() => setShowEndedBanner(false), 2800);
    return () => clearTimeout(t);
  }, [isCompleted, user, resultSeen, refreshWallet]);

  useEffect(() => {
    setResultOpen(false);
    setResultSeen(false);
  }, [id]);

  useEffect(() => {
    setFormError('');
  }, [side, orderType]);

  const closedTrades = useMemo(
    () => trades.filter((t) => t.status === 'CLOSED' && t.pnl != null),
    [trades],
  );

  const bestTradePnl = useMemo(() => {
    if (!closedTrades.length) return null;
    return Math.max(...closedTrades.map((t) => t.pnl as number));
  }, [closedTrades]);

  const worstTradePnl = useMemo(() => {
    if (!closedTrades.length) return null;
    return Math.min(...closedTrades.map((t) => t.pnl as number));
  }, [closedTrades]);

  const top5CutoffPnl = useMemo(() => {
    if (!match?.leaderboard?.length) return null;
    const ps = match.prizeStructure;
    const strong = ps?.strongCount ?? 5;
    const row = match.leaderboard.find((r) => r.rank === strong);
    return row?.totalPnl ?? null;
  }, [match?.leaderboard, match?.prizeStructure]);

  const zoneCutoffPnl = useMemo(() => {
    if (!match?.leaderboard?.length || !match.prizeStructure) return null;
    const ps = match.prizeStructure;
    const edge =
      ps.refundTo != null
        ? ps.refundTo
        : ps.strongCount;
    const row = match.leaderboard.find((r) => r.rank === edge);
    return row?.totalPnl ?? null;
  }, [match?.leaderboard, match?.prizeStructure]);

  const timerUrgency =
    isLive && msLeft > 0
      ? msLeft <= 30_000
        ? 'critical'
        : msLeft <= 60_000
          ? 'minute'
          : msLeft <= 120_000
            ? 'warn'
            : 'normal'
      : 'normal';

  /** Continuous near-miss / hold status for local player */
  const rewardStatus = useMemo(() => {
    if (!isLive || !match?.me || !match.prizeStructure) return null;
    const me = match.me;
    const ps = match.prizeStructure;
    const zone = (me.zone ?? 'OUT') as BrPrizeZone;
    const myPnl = me.totalPnl;

    const prizeEdge = match.leaderboard.find(
      (r) => r.rank === ps.strongCount,
    );
    const refundEdge =
      ps.refundTo != null
        ? match.leaderboard.find((r) => r.rank === ps.refundTo)
        : null;
    if (zone === 'OUT') {
      const target = refundEdge ?? prizeEdge;
      if (!target) return { line: COPY.arena.zoneOut, tone: 'out' as const };
      const gap = target.totalPnl - myPnl;
      if (gap <= 0) {
        return {
          line: COPY.arena.awayFromStakeBack(formatUsd(0.01)),
          tone: 'out' as const,
        };
      }
      const label =
        ps.refundTo != null
          ? COPY.arena.awayFromStakeBack(formatUsd(gap))
          : COPY.arena.awayFromPrize(formatUsd(gap));
      return { line: label, tone: 'out' as const };
    }

    if (zone === 'REFUND') {
      if (prizeEdge) {
        const gap = prizeEdge.totalPnl - myPnl;
        if (gap > 0) {
          return {
            line: COPY.arena.awayFromPrize(formatUsd(gap)),
            tone: 'refund' as const,
          };
        }
      }
      return {
        line: COPY.arena.holdingStakeBack,
        tone: 'refund' as const,
      };
    }

    // PRIZE zone
    const payout = ps.payouts.find(
      (p) => p.rank === me.rank && p.kind === 'PRIZE',
    );
    let line =
      payout && payout.amount > 0
        ? COPY.arena.holdingPrize(formatUsd(payout.amount), me.rank)
        : COPY.arena.holdingPrizeNoAmt(me.rank);
    const nextBelow = match.leaderboard.find((r) => r.rank === me.rank + 1);
    if (nextBelow && myPnl > nextBelow.totalPnl) {
      const ahead = myPnl - nextBelow.totalPnl;
      if (ahead > 0) {
        line = `${line} · ${COPY.arena.aheadOfNext(formatUsd(ahead))}`;
      }
    }
    return { line, tone: 'prize' as const };
  }, [isLive, match?.me, match?.prizeStructure, match?.leaderboard]);

  const bestTradeSummary = useMemo(() => {
    if (!closedTrades.length) return null;
    let best = closedTrades[0];
    for (const t of closedTrades) {
      if ((t.pnl ?? -Infinity) > (best.pnl ?? -Infinity)) best = t;
    }
    if (best.pnl == null) return null;
    return {
      side: best.side,
      pnl: best.pnl,
      label: `${best.side} ${best.pnl >= 0 ? '+' : ''}${formatUsd(best.pnl)}`,
    };
  }, [closedTrades]);

  function rematchUrl(nextStake: number, auto: boolean) {
    const q = new URLSearchParams();
    q.set('stake', String(nextStake));
    q.set('asset', match?.asset ?? 'EURUSD');
    if (auto) q.set('auto', '1');
    return `/lobby?${q.toString()}`;
  }

  const chartTrades = useMemo(
    () =>
      trades
        .filter((t) => t.status === 'OPEN' || t.status === 'PENDING')
        .map((t) => ({
          id: t.id,
          asset: t.asset,
          side: t.side,
          status: t.status,
          entryPrice: t.entryPrice,
          stopLoss: t.stopLoss,
          takeProfit: t.takeProfit,
          label: COPY.arena.me,
        })),
    [trades],
  );

  function showFormError(msg: string) {
    setFormError(msg);
    requestAnimationFrame(() => {
      formErrorRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  }

  async function openTrade() {
    setFormError('');

    if (!isLive) {
      showFormError(COPY.arena.notLive);
      return;
    }

    // Seat recovery: WS may have wiped myStats; re-fetch once before blocking
    let stats = match?.myStats ?? null;
    const seatedOnBoard =
      !!match?.me ||
      !!match?.leaderboard?.some(
        (r) => r.isMe || (user?.id && r.userId === user.id),
      );

    if (!stats) {
      try {
        const snap = await brApi.getMatch(id);
        apply(snap, { scoped: true });
        stats = snap.myStats;
        if (!stats && !seatedOnBoard && !snap.me) {
          showFormError(COPY.arena.noSeat);
          return;
        }
        // If still no stats but user is on board, use defaults from board row
        if (!stats && snap.me) {
          stats = {
            virtualCapital: 10_000,
            totalRiskUsedPct: 0,
            tradeCount: snap.me.tradeCount ?? 0,
            maxTrades: 2,
            maxRiskPct: 2,
            openTrades: snap.me.openTrades ?? 0,
          };
        }
      } catch (err) {
        showFormError(
          err instanceof Error ? err.message : COPY.arena.noSeat,
        );
        return;
      }
    }

    if (!stats) {
      // Last resort: still attempt API if we appear on the board
      if (!seatedOnBoard) {
        showFormError(COPY.arena.noSeat);
        return;
      }
      stats = {
        virtualCapital: 10_000,
        totalRiskUsedPct: 0,
        tradeCount: match?.me?.tradeCount ?? 0,
        maxTrades: 2,
        maxRiskPct: 2,
        openTrades: match?.me?.openTrades ?? 0,
      };
    }

    if (stats.tradeCount >= stats.maxTrades) {
      showFormError(COPY.arena.maxTrades(stats.maxTrades));
      return;
    }

    const sl = parsePrice(stopLoss);
    if (sl == null) {
      showFormError(COPY.arena.invalidSl);
      return;
    }

    let tp: number | null = null;
    if (takeProfit.trim()) {
      tp = parsePrice(takeProfit);
      if (tp == null) {
        showFormError(COPY.arena.invalidTp);
        return;
      }
    }

    let entry: number | undefined;
    if (orderType === 'LIMIT') {
      const e = parsePrice(entryPrice);
      if (e == null) {
        showFormError(COPY.arena.invalidEntry);
        return;
      }
      entry = e;
    }

    const ref =
      orderType === 'LIMIT' && entry != null
        ? entry
        : liveMid != null && liveMid > 0
          ? liveMid
          : null;

    if (ref != null) {
      const slCheck = validateStopLossSide(side, sl, ref);
      if (!slCheck.ok) {
        showFormError(slCheck.message);
        return;
      }
      if (tp != null) {
        const tpCheck = validateTakeProfitSide(side, tp, ref);
        if (!tpCheck.ok) {
          showFormError(tpCheck.message);
          return;
        }
      }
    }

    const risk = parsePrice(riskPct);
    const maxRisk = stats.maxRiskPct ?? 2;
    if (risk == null || risk <= 0 || risk > maxRisk) {
      showFormError(COPY.arena.invalidRisk);
      return;
    }
    const riskLeft = maxRisk - (stats.totalRiskUsedPct ?? 0);
    if (risk > riskLeft + 1e-9) {
      showFormError(
        `Risk left: ${riskLeft.toFixed(2)}% (max total ${maxRisk}%)`,
      );
      return;
    }

    setBusy(true);
    try {
      const payload: Parameters<typeof brApi.openTrade>[1] = {
        side,
        orderType,
        stopLoss: sl,
        riskPct: risk,
      };
      if (tp != null) payload.takeProfit = tp;
      if (orderType === 'LIMIT' && entry != null) payload.entryPrice = entry;

      const opened = await brApi.openTrade(id, payload);
      // Optimistic: show trade immediately
      setTrades((prev) => {
        if (prev.some((t) => t.id === opened.id)) return prev;
        return [...prev, opened];
      });
      setStopLoss('');
      setTakeProfit('');
      setEntryPrice('');
      await load();
    } catch (err) {
      showFormError(err instanceof Error ? err.message : COPY.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function closeTrade(tradeId: string) {
    setBusy(true);
    setFormError('');
    try {
      await brApi.closeTrade(id, tradeId);
      await load();
    } catch (err) {
      showFormError(err instanceof Error ? err.message : COPY.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function cancelTrade(tradeId: string) {
    setBusy(true);
    setFormError('');
    try {
      await brApi.cancelTrade(id, tradeId);
      await load();
    } catch (err) {
      showFormError(err instanceof Error ? err.message : COPY.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function forceEndDemo() {
    if (!match?.isDemo || !isLive) return;
    setForceEnding(true);
    try {
      const snap = await brApi.forceEnd(id);
      apply(snap, { scoped: true });
      setShowEndedBanner(true);
      setResultOpen(true);
      setResultSeen(true);
      void refreshWallet();
    } catch (err) {
      showFormError(err instanceof Error ? err.message : COPY.common.error);
    } finally {
      setForceEnding(false);
    }
  }

  function startEditLevels(t: BrTradeDto) {
    setEditingId(t.id);
    setEditSl(String(t.stopLoss ?? ''));
    setEditTp(t.takeProfit != null ? String(t.takeProfit) : '');
    setEditError('');
  }

  async function saveEditLevels(t: BrTradeDto) {
    setEditError('');
    const sl = parsePrice(editSl);
    if (sl == null) {
      setEditError(COPY.arena.slRequired);
      return;
    }
    let tp: number | null = null;
    if (editTp.trim()) {
      tp = parsePrice(editTp);
      if (tp == null) {
        setEditError(COPY.arena.invalidTp);
        return;
      }
    }
    const ref =
      t.entryPrice != null && t.entryPrice > 0
        ? t.entryPrice
        : liveMid != null && liveMid > 0
          ? liveMid
          : null;
    if (ref != null) {
      const slCheck = validateStopLossSide(t.side as 'LONG' | 'SHORT', sl, ref);
      if (!slCheck.ok) {
        setEditError(slCheck.message);
        return;
      }
      if (tp != null) {
        const tpCheck = validateTakeProfitSide(
          t.side as 'LONG' | 'SHORT',
          tp,
          ref,
        );
        if (!tpCheck.ok) {
          setEditError(tpCheck.message);
          return;
        }
      }
    }

    setEditBusy(true);
    try {
      const updated = await brApi.updateTradeLevels(id, t.id, {
        stopLoss: sl,
        takeProfit: tp,
      });
      setTrades((prev) => {
        const i = prev.findIndex((x) => x.id === updated.id);
        if (i < 0) return [...prev, updated];
        const n = [...prev];
        n[i] = updated;
        return n;
      });
      setEditingId(null);
      pushToast(COPY.arena.levelsSaved, 'info');
      pulseTrade(t.id);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : COPY.common.error);
    } finally {
      setEditBusy(false);
    }
  }

  if (!user && !authLoading) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-muted-foreground">{COPY.arena.signInToView}</p>
        <Button asChild>
          <Link href="/login?next=/lobby">{COPY.arena.signIn}</Link>
        </Button>
      </div>
    );
  }

  if (error && !match) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" asChild>
          <Link href="/lobby">{COPY.arena.lobby}</Link>
        </Button>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="flex justify-center py-24 text-sm text-muted-foreground">
        {COPY.arena.loading}
      </div>
    );
  }

  const seated =
    !!match.myStats ||
    !!match.me ||
    !!match.leaderboard?.some(
      (r) => r.isMe || (user?.id != null && r.userId === user.id),
    );
  const tradesLeft =
    (match.myStats?.maxTrades ?? 2) - (match.myStats?.tradeCount ?? 0);
  const canAttemptTrade = isLive && seated && tradesLeft > 0;

  return (
    <div className="arena-root flex h-[calc(100vh-3.5rem)] max-h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-[hsl(210_22%_5%)]">
      {/* Compact header */}
      <header className="z-30 shrink-0 border-b border-border bg-[hsl(210_20%_6%/0.96)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 sm:gap-3 sm:px-3">
          <Link
            href={match.isDemo ? '/demo' : '/lobby'}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-secondary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
          <Badge variant="secondary" className="h-6 px-1.5 text-[10px] font-semibold">
            BR
          </Badge>
          {match.isDemo && (
            <Badge className="h-6 border border-primary/40 bg-primary/15 px-1.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              {COPY.arena.demo}
            </Badge>
          )}
          {match.isDemo && (
            <Badge
              variant="outline"
              className="hidden h-6 border-amber-500/35 bg-amber-500/10 px-1.5 text-[9px] font-bold uppercase tracking-wide text-amber-200/90 sm:inline-flex"
            >
              {COPY.arena.virtualStakeChip}
            </Badge>
          )}
          <Badge variant="outline" className="mono-num h-6 px-1.5 text-[10px]">
            {match.asset}
          </Badge>
          <Badge variant="outline" className="h-6 px-1.5 text-[10px]">
            {match.status}
          </Badge>
          {liveMid != null && (
            <span className="mono-num hidden text-xs font-semibold text-foreground sm:inline">
              {formatPrice(liveMid)}
            </span>
          )}
          <div className="hidden h-5 w-px bg-border sm:block" />
          <div className="flex gap-3 text-[10px]">
            <div>
              <p className="label-caps !text-[9px]">{COPY.arena.pool}</p>
              <p className="mono-num text-xs font-semibold text-success">
                {formatUsd(
                  match.prizeStructure?.prizePool ?? match.prizePool,
                )}
              </p>
            </div>
            <div>
              <p className="label-caps !text-[9px]">{COPY.arena.players}</p>
              <p className="mono-num text-xs font-semibold">{match.playerCount}</p>
            </div>
            <div>
              <p className="label-caps !text-[9px]">{COPY.arena.stake}</p>
              <p className="mono-num text-xs font-semibold">
                {match.isDemo
                  ? formatUsd(match.prizeStructure?.stake ?? 5)
                  : formatUsd(match.stake)}
                {match.isDemo && (
                  <span className="ml-0.5 text-[9px] font-normal text-muted-foreground">
                    virt.
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="ml-auto text-right">
            <p className="label-caps !text-[9px]">{COPY.arena.time}</p>
            <p
              className={cn(
                'mono-num text-2xl font-black leading-none tracking-tight sm:text-3xl',
                timerUrgency === 'warn' && 'text-amber-400',
                timerUrgency === 'minute' && 'text-amber-300',
                timerUrgency === 'critical' &&
                  'text-destructive timer-urgent',
              )}
            >
              {isLive ? formatCd(msLeft) : isFinished ? COPY.arena.end : '—'}
            </p>
          </div>
        </div>
        {showEndedBanner && (
          <div className="border-t border-success/30 bg-success/15 px-3 py-1.5 text-center text-xs font-bold tracking-wide text-success animate-fade-in">
            {COPY.arena.matchEndedBanner}
          </div>
        )}
        {isLive && timerUrgency === 'critical' && (
          <div className="border-t border-destructive/40 bg-destructive/15 px-3 py-1 text-center text-[10px] font-bold tracking-[0.18em] text-destructive animate-fade-in">
            {COPY.arena.finalPush}
          </div>
        )}
        {isLive && timerUrgency === 'minute' && (
          <div className="border-t border-amber-500/35 bg-amber-500/10 px-3 py-1 text-center text-[10px] font-bold tracking-[0.18em] text-amber-300 animate-fade-in">
            {COPY.arena.finalMinute}
          </div>
        )}
        {match.prizeStructure && isLive && timerUrgency === 'normal' && (
          <div className="border-t border-border/60 px-3 py-1 text-center text-[10px] text-muted-foreground">
            {match.prizeStructure.footer}
          </div>
        )}
        {match.prizeStructure &&
          isLive &&
          (timerUrgency === 'warn' ||
            timerUrgency === 'minute' ||
            timerUrgency === 'critical') && (
            <div
              className={cn(
                'border-t px-3 py-1 text-center text-[10px] font-medium',
                timerUrgency === 'critical'
                  ? 'border-destructive/30 bg-destructive/10 text-destructive/90'
                  : 'border-amber-500/25 bg-amber-500/5 text-amber-200/90',
              )}
            >
              {match.prizeStructure.footer}
            </div>
          )}
      </header>

      {/* Main: chart left · side panel right — fits without browser zoom */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 lg:grid-cols-[minmax(0,1fr)_minmax(240px,280px)] lg:gap-2.5 lg:p-2.5">
        {/* Chart + trades */}
        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          <section className="relative min-h-[180px] flex-1 overflow-hidden rounded-md border border-border bg-card sm:min-h-[220px]">
            <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTf(t)}
                  className={cn(
                    'h-6 rounded px-1.5 font-mono text-[10px]',
                    tf === t
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="absolute inset-x-0 bottom-0 top-8">
              <PriceChart
                asset={match.asset}
                timeframe={tf}
                trades={chartTrades}
                className="h-full w-full"
              />
            </div>
          </section>

          <section className="max-h-[32vh] shrink-0 overflow-y-auto rounded-md border border-border bg-card p-2 sm:max-h-[26vh]">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
              <h3 className="label-caps !text-[9px]">
                {COPY.arena.myTrades} ({match.myStats?.tradeCount ?? 0}/
                {match.myStats?.maxTrades ?? 2})
              </h3>
              {isLive && openPnlSum != null && (
                <p className="text-[11px] font-medium">
                  <span className="text-muted-foreground">
                    {COPY.arena.openPnl}{' '}
                  </span>
                  <span
                    className={cn(
                      'mono-num text-sm font-bold tabular-nums',
                      openPnlSum > 0 && 'text-success',
                      openPnlSum < 0 && 'text-destructive',
                      openPnlSum === 0 && 'text-muted-foreground',
                    )}
                  >
                    {formatSignedUsd(openPnlSum)}
                  </span>
                </p>
              )}
            </div>
            {trades.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {COPY.arena.noTrades}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {trades.map((t) => {
                  const closedBy = (t.closeReason || '').toUpperCase();
                  const canEdit =
                    isLive &&
                    (t.status === 'OPEN' || t.status === 'PENDING');
                  const live = livePnlByTradeId.get(t.id);
                  const isOpen = t.status === 'OPEN';
                  const isPending = t.status === 'PENDING';
                  const livePnl = isOpen ? live?.pnl : null;
                  const liveR = isOpen ? live?.r : null;
                  return (
                    <li
                      key={t.id}
                      className={cn(
                        'rounded border border-border bg-secondary/20 px-2 py-1.5 text-[11px]',
                        pulseIds.has(t.id) && 'trade-row-pulse',
                        t.status === 'CLOSED' &&
                          closedBy === 'SL' &&
                          'border-destructive/30',
                        t.status === 'CLOSED' &&
                          closedBy === 'TP' &&
                          'border-success/30',
                        isOpen &&
                          livePnl != null &&
                          livePnl > 0 &&
                          'border-success/20 bg-success/[0.06]',
                        isOpen &&
                          livePnl != null &&
                          livePnl < 0 &&
                          'border-destructive/20 bg-destructive/[0.06]',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          <Badge
                            variant={
                              t.side === 'LONG' ? 'success' : 'destructive'
                            }
                            className="mr-1.5 h-5 px-1 text-[9px]"
                          >
                            {t.side}
                          </Badge>
                          <span className="text-muted-foreground">
                            {t.orderType === 'LIMIT' ? 'LMT' : 'MKT'} ·{' '}
                            {t.status}
                            {t.status === 'CLOSED' && closedBy
                              ? ` · ${closedBy}`
                              : ''}
                          </span>
                          {t.entryPrice != null && (
                            <span className="mono-num ml-1.5 text-muted-foreground">
                              @ {formatPrice(t.entryPrice)}
                            </span>
                          )}
                          <span className="mono-num ml-1.5 text-muted-foreground">
                            SL {formatPrice(t.stopLoss)}
                            {t.takeProfit != null
                              ? ` · TP ${formatPrice(t.takeProfit)}`
                              : ''}
                          </span>
                          {/* Live unrealized PnL (OPEN) */}
                          {isOpen && (
                            <span
                              className={cn(
                                'mono-num ml-1.5 text-sm font-bold tabular-nums sm:text-base',
                                livePnl == null && 'text-muted-foreground',
                                livePnl != null &&
                                  livePnl > 0 &&
                                  'text-success',
                                livePnl != null &&
                                  livePnl < 0 &&
                                  'text-destructive',
                                livePnl === 0 && 'text-muted-foreground',
                              )}
                            >
                              {livePnl != null
                                ? formatSignedUsd(livePnl)
                                : '…'}
                              {liveR != null && (
                                <span className="ml-1 text-[10px] font-medium opacity-70">
                                  ({formatR(liveR)})
                                </span>
                              )}
                            </span>
                          )}
                          {isPending && (
                            <span className="mono-num ml-1.5 text-muted-foreground">
                              {COPY.arena.pendingPnl}
                            </span>
                          )}
                          {/* Realized PnL (CLOSED) */}
                          {t.status === 'CLOSED' && t.pnl != null && (
                            <span
                              className={cn(
                                'mono-num ml-1.5 text-sm font-bold tabular-nums',
                                t.pnl > 0 && 'text-success',
                                t.pnl < 0 && 'text-destructive',
                                t.pnl === 0 && 'text-muted-foreground',
                              )}
                            >
                              {formatSignedUsd(t.pnl)}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 gap-1">
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[10px]"
                              disabled={busy || editBusy}
                              onClick={() =>
                                editingId === t.id
                                  ? setEditingId(null)
                                  : startEditLevels(t)
                              }
                            >
                              {COPY.arena.editLevels}
                            </Button>
                          )}
                          {t.status === 'OPEN' && isLive && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              disabled={busy}
                              onClick={() => void closeTrade(t.id)}
                            >
                              {COPY.arena.close}
                            </Button>
                          )}
                          {t.status === 'PENDING' && isLive && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[10px]"
                              disabled={busy}
                              onClick={() => void cancelTrade(t.id)}
                            >
                              {COPY.arena.cancel}
                            </Button>
                          )}
                        </span>
                      </div>

                      {editingId === t.id && canEdit && (
                        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                          <div className="grid grid-cols-2 gap-1.5">
                            <div>
                              <p className="label-caps mb-0.5 !text-[9px]">
                                {COPY.arena.stopLoss}
                              </p>
                              <PriceInput
                                className="h-7 text-[11px]"
                                value={editSl}
                                onChange={setEditSl}
                                placeholder={COPY.arena.pricePlaceholder}
                              />
                            </div>
                            <div>
                              <p className="label-caps mb-0.5 !text-[9px]">
                                {COPY.arena.takeProfitShort}
                              </p>
                              <PriceInput
                                className="h-7 text-[11px]"
                                value={editTp}
                                onChange={setEditTp}
                                placeholder={COPY.arena.optionalPlaceholder}
                              />
                            </div>
                          </div>
                          {editError && (
                            <p className="text-[10px] text-destructive">
                              {editError}
                            </p>
                          )}
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              className="h-7 flex-1 text-[10px]"
                              disabled={editBusy}
                              onClick={() => void saveEditLevels(t)}
                            >
                              {editBusy ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                COPY.arena.saveLevels
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px]"
                              disabled={editBusy}
                              onClick={() => setEditingId(null)}
                            >
                              {COPY.common.close}
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Side panel — scrollable so order form always reachable */}
        <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto overscroll-contain pb-2 lg:pb-0">
          {/* Distance-to-reward (continuous near-miss) */}
          {isLive && rewardStatus && (
            <div
              className={cn(
                'shrink-0 rounded-md border px-2.5 py-2 text-[11px] font-medium leading-snug',
                rewardStatus.tone === 'prize' &&
                  'border-success/35 bg-success/10 text-success',
                rewardStatus.tone === 'refund' &&
                  'border-sky-500/35 bg-sky-500/10 text-sky-200',
                rewardStatus.tone === 'out' &&
                  'border-border bg-secondary/40 text-muted-foreground',
                (timerUrgency === 'minute' || timerUrgency === 'critical') &&
                  'ring-1 ring-inset',
                timerUrgency === 'critical' && 'ring-destructive/30',
                timerUrgency === 'minute' && 'ring-amber-500/25',
              )}
            >
              <p className="label-caps mb-0.5 !text-[8px] opacity-80">
                {match.me
                  ? `#${match.me.rank} · ${
                      match.me.zone === 'PRIZE'
                        ? COPY.arena.zonePrize
                        : match.me.zone === 'REFUND'
                          ? COPY.arena.zoneRefund
                          : COPY.arena.zoneOut
                    }`
                  : '—'}
              </p>
              <p className="text-[12px] font-semibold text-foreground">
                {rewardStatus.line}
              </p>
            </div>
          )}

          <section
            className={cn(
              'flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card p-2 lg:min-h-[200px] lg:max-h-[42vh]',
              (timerUrgency === 'minute' || timerUrgency === 'critical') &&
                'border-primary/25',
            )}
          >
            <div className="mb-1.5 flex shrink-0 items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <Trophy className="h-3 w-3 text-primary" />
                <h3 className="label-caps !text-[9px]">
                  {COPY.arena.liveRanking}
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="text-[9px] text-muted-foreground hover:text-foreground"
                  title={sfxOn ? COPY.arena.sfxOn : COPY.arena.sfxOff}
                  onClick={() => {
                    const next = !sfxOn;
                    setSfxEnabled(next);
                    setSfxOn(next);
                  }}
                >
                  {sfxOn ? 'SFX' : 'SFX off'}
                </button>
                <span className="text-[9px] text-muted-foreground">
                  {COPY.arena.playersAll(match.leaderboard.length)}
                </span>
              </div>
            </div>
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain pr-0.5">
              {match.leaderboard.map((row) => {
                const zone = row.zone ?? 'OUT';
                return (
                  <li
                    key={row.userId}
                    className={cn(
                      'rank-row flex items-center justify-between rounded border-l-2 px-1.5 py-1 text-[11px]',
                      zone === 'PRIZE' && 'border-l-success bg-success/[0.04]',
                      zone === 'REFUND' && 'border-l-sky-400 bg-sky-400/[0.05]',
                      zone === 'OUT' && 'border-l-transparent opacity-80',
                      row.isMe && 'rank-row-me',
                      row.isMe &&
                        myRankFlash === 'up' &&
                        'bg-success/20 ring-1 ring-success/40',
                      row.isMe &&
                        myRankFlash === 'down' &&
                        'bg-destructive/15 ring-1 ring-destructive/30',
                    )}
                  >
                    <span className="inline-flex min-w-0 items-center gap-0.5">
                      <span className="count-tick mr-0.5 text-muted-foreground">
                        #{row.rank}
                      </span>
                      <span className="truncate">@{row.username}</span>
                      {row.isPremium && <PremiumBadge showLabel={false} />}
                      {row.isMe && (
                        <span className="text-primary">({COPY.arena.you})</span>
                      )}
                      {zone === 'PRIZE' && (
                        <span className="ml-0.5 rounded bg-success/20 px-1 text-[8px] font-bold uppercase tracking-wide text-success">
                          {COPY.arena.badgePrize}
                        </span>
                      )}
                      {zone === 'REFUND' && (
                        <span className="ml-0.5 rounded bg-sky-400/15 px-1 text-[8px] font-bold uppercase tracking-wide text-sky-300">
                          {COPY.arena.badgeRefund}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        'count-tick shrink-0 pl-1',
                        row.totalPnl > 0
                          ? 'text-success'
                          : row.totalPnl < 0
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                      )}
                    >
                      {formatUsd(row.totalPnl)}
                    </span>
                  </li>
                );
              })}
            </ul>
            {match.me && (
              <p className="mt-1.5 shrink-0 border-t border-border pt-1.5 text-center text-[11px] text-muted-foreground">
                {COPY.arena.yourPosition}{' '}
                <span className="font-semibold text-foreground">
                  #{match.me.rank}
                </span>{' '}
                · {formatUsd(match.me.totalPnl)}
                {isLive && openPnlSum != null && (
                  <>
                    {' '}
                    ·{' '}
                    <span className="text-muted-foreground">
                      {COPY.arena.openPnl}{' '}
                    </span>
                    <span
                      className={cn(
                        'mono-num font-bold tabular-nums',
                        openPnlSum > 0 && 'text-success',
                        openPnlSum < 0 && 'text-destructive',
                        openPnlSum === 0 && 'text-muted-foreground',
                      )}
                    >
                      {formatSignedUsd(openPnlSum)}
                    </span>
                  </>
                )}
                {match.me.zone === 'PRIZE' && (
                  <span className="ml-1 text-success">· prize</span>
                )}
                {match.me.zone === 'REFUND' && (
                  <span className="ml-1 text-sky-300">· stake back</span>
                )}
              </p>
            )}
          </section>

          <BrMatchChat
            matchId={id}
            isPremium={!!user?.isPremium}
            className="shrink-0"
          />

          {isLive && match.isDemo && (
            <div className="shrink-0 rounded-md border border-border/80 bg-secondary/20 px-2.5 py-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full text-[11px] font-semibold"
                disabled={forceEnding}
                onClick={() => void forceEndDemo()}
              >
                {forceEnding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {COPY.arena.forceEnd}
              </Button>
              <p className="mt-1 text-center text-[9px] text-muted-foreground">
                {COPY.arena.forceEndHint}
              </p>
            </div>
          )}

          {isLive && (
            <section className="shrink-0 rounded-md border border-border bg-card p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="label-caps !text-[9px]">{COPY.arena.newOrder}</h3>
                {liveMid != null && (
                  <p className="mono-num text-[10px] text-muted-foreground">
                    {COPY.arena.mid}{' '}
                    <span className="font-semibold text-primary">
                      {formatPrice(liveMid)}
                    </span>
                  </p>
                )}
              </div>

              {/* Side */}
              <div className="mb-1.5 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setSide('LONG')}
                  className={cn(
                    'h-8 rounded-md text-[11px] font-bold transition-colors',
                    side === 'LONG'
                      ? 'bg-success text-success-foreground'
                      : 'border border-border text-muted-foreground hover:bg-secondary',
                  )}
                >
                  LONG
                </button>
                <button
                  type="button"
                  onClick={() => setSide('SHORT')}
                  className={cn(
                    'h-8 rounded-md text-[11px] font-bold transition-colors',
                    side === 'SHORT'
                      ? 'bg-destructive text-destructive-foreground'
                      : 'border border-border text-muted-foreground hover:bg-secondary',
                  )}
                >
                  SHORT
                </button>
              </div>

              {/* Order type */}
              <div className="mb-1.5 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setOrderType('MARKET')}
                  className={cn(
                    'h-7 rounded-md text-[10px] font-semibold transition-colors',
                    orderType === 'MARKET'
                      ? 'border border-primary/40 bg-primary/15 text-primary'
                      : 'border border-border text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {COPY.arena.market}
                </button>
                <button
                  type="button"
                  onClick={() => setOrderType('LIMIT')}
                  className={cn(
                    'h-7 rounded-md text-[10px] font-semibold transition-colors',
                    orderType === 'LIMIT'
                      ? 'border border-primary/40 bg-primary/15 text-primary'
                      : 'border border-border text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {COPY.arena.limit}
                </button>
              </div>

              {orderType === 'LIMIT' && (
                <div className="mb-1.5">
                  <p className="label-caps mb-0.5 !text-[9px]">
                    {COPY.arena.entryPrice}
                  </p>
                  <PriceInput
                    className="h-8 text-xs"
                    value={entryPrice}
                    onChange={setEntryPrice}
                    placeholder={COPY.arena.pricePlaceholder}
                  />
                </div>
              )}

              <div className="mb-1.5 grid grid-cols-2 gap-1.5">
                <div>
                  <p className="label-caps mb-0.5 !text-[9px]">
                    {COPY.arena.stopLoss}
                    <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/80">
                      ·{' '}
                      {side === 'LONG'
                        ? COPY.arena.slHintLong
                        : COPY.arena.slHintShort}
                    </span>
                  </p>
                  <PriceInput
                    className="h-8 text-xs"
                    value={stopLoss}
                    onChange={setStopLoss}
                    placeholder={COPY.arena.pricePlaceholder}
                  />
                </div>
                <div>
                  <p className="label-caps mb-0.5 !text-[9px]">
                    {COPY.arena.takeProfitShort}
                  </p>
                  <PriceInput
                    className="h-8 text-xs"
                    value={takeProfit}
                    onChange={setTakeProfit}
                    placeholder={COPY.arena.optionalPlaceholder}
                  />
                </div>
              </div>

              <div className="mb-1.5">
                <p className="label-caps mb-0.5 !text-[9px]">
                  {COPY.arena.riskPct(match.myStats?.maxRiskPct ?? 2)}
                </p>
                <PriceInput
                  className="h-8 text-xs"
                  value={riskPct}
                  onChange={setRiskPct}
                />
              </div>

              {formError && (
                <p
                  ref={formErrorRef}
                  role="alert"
                  className="mb-1.5 rounded border border-destructive/35 bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
                >
                  {formError}
                </p>
              )}

              {!canAttemptTrade && isLive && (
                <p className="mb-1.5 text-[10px] text-muted-foreground">
                  {!seated
                    ? COPY.arena.noSeat
                    : COPY.arena.maxTrades(match.myStats?.maxTrades ?? 2)}
                </p>
              )}

              <Button
                type="button"
                className="h-9 w-full text-xs font-bold"
                disabled={busy || !isLive}
                onClick={() => void openTrade()}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {COPY.arena.opening}
                  </>
                ) : (
                  COPY.arena.openOrder(side, orderType)
                )}
              </Button>
              <p className="mt-1 text-[9px] leading-snug text-muted-foreground">
                {COPY.arena.riskUsed(
                  String(match.myStats?.totalRiskUsedPct.toFixed(1) ?? 0),
                  formatUsd(match.myStats?.virtualCapital ?? 10000),
                )}
              </p>
            </section>
          )}

          {isCompleted && !resultOpen && match.me && (
            <section className="shrink-0 rounded-md border border-border bg-card p-3 text-center shadow-panel">
              <p className="text-sm font-semibold">
                {match.isDemo ? COPY.arena.demoEnded : COPY.arena.matchEnded}
              </p>
              <p className="mono-num mt-1 text-base font-bold">
                #{match.me.rank} · {formatUsd(match.me.totalPnl)}
                {!match.isDemo &&
                  match.me.prizeAmount != null &&
                  match.me.prizeAmount > 0 && (
                    <span className="ml-2 text-success">
                      +{formatUsd(match.me.prizeAmount)}
                    </span>
                  )}
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {match.isDemo ? (
                  <>
                    <Button
                      className="h-9 w-full text-xs font-bold"
                      onClick={() => router.push('/register?next=/lobby')}
                    >
                      {COPY.arena.playReal}
                    </Button>
                    <Button variant="outline" className="h-8 w-full text-xs" asChild>
                      <Link href="/demo">{COPY.arena.anotherDemo}</Link>
                    </Button>
                  </>
                ) : (
                  <Button
                    className="h-9 w-full text-xs font-bold"
                    onClick={() => router.push(rematchUrl(match.stake, true))}
                  >
                    {COPY.arena.playAgain}
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="h-8 w-full text-xs"
                  onClick={() => setResultOpen(true)}
                >
                  {COPY.arena.viewResult}
                </Button>
                <Button variant="ghost" className="h-8 w-full text-xs" asChild>
                  <Link href={match.isDemo ? '/' : '/lobby'}>
                    {match.isDemo ? COPY.arena.home : COPY.arena.lobby}
                  </Link>
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>

      {match.me && (
        <BrResultModal
          open={resultOpen && isCompleted}
          rank={match.me.rank}
          playerCount={match.playerCount}
          totalPnl={match.me.totalPnl}
          prizeAmount={match.me.prizeAmount}
          stake={match.stake}
          asset={match.asset}
          isDemo={!!match.isDemo}
          tradesUsed={match.myStats?.tradeCount ?? trades.length}
          maxTrades={match.myStats?.maxTrades ?? 2}
          bestTradePnl={bestTradePnl}
          worstTradePnl={worstTradePnl}
          top5CutoffPnl={top5CutoffPnl}
          zoneCutoffPnl={zoneCutoffPnl}
          prizeStructure={match.prizeStructure}
          zone={match.me.zone}
          bestTradeLabel={bestTradeSummary?.label ?? null}
          availableBalance={wallet?.availableBalance ?? 0}
          onClose={() => setResultOpen(false)}
          onPlayAgain={(nextStake) => {
            setResultOpen(false);
            if (match.isDemo) {
              router.push('/demo');
            } else {
              router.push(rematchUrl(nextStake, true));
            }
          }}
          onLobby={(nextStake) => {
            setResultOpen(false);
            if (match.isDemo) {
              router.push('/register?next=/lobby');
            } else {
              router.push(rematchUrl(nextStake, false));
            }
          }}
          onPlayReal={() => {
            setResultOpen(false);
            router.push('/register?next=/lobby');
          }}
        />
      )}

      <ToastStack
        toasts={toasts}
        onDismiss={(tid) =>
          setToasts((prev) => prev.filter((x) => x.id !== tid))
        }
      />
    </div>
  );
}

function formatCd(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function formatPrice(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 10) return n.toFixed(3);
  return n.toFixed(5);
}

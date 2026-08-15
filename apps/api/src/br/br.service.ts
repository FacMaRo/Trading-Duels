import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  BrMatchStatus,
  BrPlayerStatus,
  OrderType,
  TradeSide,
  TradeStatus,
  WalletTxType,
} from '@prisma/client';
import {
  BR_ASSETS,
  BR_COUNTDOWN_SECONDS,
  BR_DEMO_BOT_JOIN_MS_MAX,
  BR_DEMO_BOT_JOIN_MS_MIN,
  BR_DEMO_BOT_MAX_PNL,
  BR_DEMO_BOT_MIN_PNL,
  BR_DEMO_MIN_HUMANS_TO_START,
  BR_DEMO_MIN_PLAYERS,
  BR_DEMO_STAKE,
  BR_DEMO_TARGET_PLAYERS,
  BR_FREE_ENTRY_STAKE,
  BR_FULL_LOBBY_COUNTDOWN_SECONDS,
  BR_MATCH_DURATION_SECONDS,
  BR_MATCH_INTRO_SECONDS,
  BR_MAX_PLAYERS,
  BR_MAX_RISK_PCT,
  BR_MAX_TRADES,
  BR_MIN_PLAYERS,
  BR_STAKES,
  BR_VIRTUAL_CAPITAL,
  brEffectiveStake,
  brFreezeOpenRisk,
  brPlatformFee,
  brPot,
  brPrizePool,
  brRemainingRiskAmount,
  brRiskPctFromAmount,
  brValidateSlRiskChange,
  checkSlTpHit,
  daysUntilNextUtcWeek,
  exitPriceForClose,
  getBrPrizeStructure,
  isBrAsset,
  isBrStake,
  isStopLossValid,
  isTakeProfitValid,
  marketEntryPrice,
  nextUtcWeekStart,
  payoutForRank,
  rankBrPlayers,
  scoreBrTradeFixedSize,
  shouldActivateLimit,
  utcIsoWeekKey,
  validateBrTradeOpen,
  validateMarketSlTp,
  validateOpenTradeStopLoss,
  validateOpenTradeTakeProfit,
  zoneForRank,
  type AssetSymbol,
  type BrPrizeStructure,
} from '@trading-duels/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { MarketService } from '../market/market.service';
import { ReferralsService } from '../referrals/referrals.service';
import { toNumber } from '../common/utils/decimal';
import {
  botEmail,
  botJoinDelayMs,
  botPersonality,
  randomBotUsername,
  sleep,
} from './br-bots';

export type BrEmitter = (
  matchId: string,
  event: string,
  payload: unknown,
) => void;

export type BrLobbyEmitter = (event: string, payload: unknown) => void;

export type BrUserEmitter = (
  userId: string,
  event: string,
  payload: unknown,
) => void;

@Injectable()
export class BrService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrService.name);
  private tickTimer: NodeJS.Timeout | null = null;
  private priceUnsub: (() => void) | null = null;
  private emit: BrEmitter = () => {};
  private emitLobby: BrLobbyEmitter = () => {};
  private emitUser: BrUserEmitter = () => {};
  /** Demo queues currently receiving staggered bot fills */
  private readonly demoFillInProgress = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly market: MarketService,
    private readonly referrals: ReferralsService,
  ) {}

  setEmitters(
    match: BrEmitter,
    lobby: BrLobbyEmitter,
    user?: BrUserEmitter,
  ) {
    this.emit = match;
    this.emitLobby = lobby;
    if (user) this.emitUser = user;
  }

  onModuleInit() {
    this.tickTimer = setInterval(() => void this.tick(), 1000);
    this.priceUnsub = this.market.subscribe((asset, tick) => {
      void this.onPriceTick(asset as AssetSymbol, tick);
    });
    // Re-retain assets for live matches
    void this.bootstrapLiveAssets();
  }

  onModuleDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.priceUnsub?.();
  }

  private async bootstrapLiveAssets() {
    const live = await this.prisma.brMatch.findMany({
      where: { status: { in: [BrMatchStatus.LIVE, BrMatchStatus.COUNTDOWN] } },
    });
    for (const m of live) this.market.retainAsset(m.asset);
  }

  // ─── Queue ───────────────────────────────────────────────────────────────

  async joinQueue(
    userId: string,
    stake: number,
    assetRaw: string,
    opts?: {
      useFreeEntry?: boolean;
      useFreeEntryCredit?: boolean;
      isDemo?: boolean;
    },
  ) {
    const isDemo = !!opts?.isDemo;
    const asset = assetRaw.toUpperCase();
    if (!isBrAsset(asset)) {
      throw new BadRequestException(
        `Activo inválido. Permitidos: ${BR_ASSETS.join(', ')}`,
      );
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    // Demo guests solo en colas demo
    if (user.isDemoGuest && !isDemo) {
      throw new BadRequestException(
        'Cuenta demo: usá “Probar gratis” (no hay dinero real)',
      );
    }

    // DEMO: sin stake, colas separadas
    if (isDemo) {
      stake = BR_DEMO_STAKE;
    } else if (!isBrStake(stake)) {
      throw new BadRequestException(
        `Stake inválido. Permitidos: ${BR_STAKES.join(', ')}`,
      );
    }

    // Ya en cola o live?
    const existing = await this.prisma.brMatchPlayer.findFirst({
      where: {
        userId,
        status: { in: [BrPlayerStatus.QUEUED, BrPlayerStatus.PLAYING] },
        match: {
          status: {
            in: [
              BrMatchStatus.QUEUE,
              BrMatchStatus.COUNTDOWN,
              BrMatchStatus.LIVE,
            ],
          },
        },
      },
      include: { match: true },
    });
    if (existing) {
      if (existing.match.status === BrMatchStatus.LIVE) {
        throw new BadRequestException('Ya estás en una partida en curso');
      }
      return this.toQueueSnapshot(existing.matchId, userId);
    }

    const isPremium = !isDemo && (user.isPremium ?? false);
    // Premium weekly free $1 entry (separate from referral credits)
    let usePremiumFreeEntry = !isDemo && !!opts?.useFreeEntry;
    // Referral / voucher free-entry credit for matching stake
    let useFreeEntryCredit = !isDemo && !!opts?.useFreeEntryCredit;

    if (usePremiumFreeEntry && useFreeEntryCredit) {
      throw new BadRequestException(
        'Choose either Premium weekly free entry or a free-entry credit',
      );
    }

    if (usePremiumFreeEntry) {
      if (!isPremium) {
        throw new BadRequestException(
          'La entrada gratis es un beneficio Premium',
        );
      }
      if (stake !== BR_FREE_ENTRY_STAKE) {
        throw new BadRequestException(
          `La entrada gratis solo aplica a stake ${BR_FREE_ENTRY_STAKE}`,
        );
      }
      const weekKey = utcIsoWeekKey();
      const already = await this.prisma.premiumFreeEntryUse.findUnique({
        where: { userId_weekKey: { userId, weekKey } },
      });
      if (already) {
        throw new BadRequestException(
          'Ya usaste la entrada gratis de esta semana (UTC)',
        );
      }
    } else if (useFreeEntryCredit) {
      const ok = await this.referrals.hasAvailableCredit(userId, stake);
      if (!ok) {
        throw new BadRequestException(
          `No free $${stake} entry credit available`,
        );
      }
    } else if (!isDemo) {
      const snap = await this.wallet.getSnapshot(userId);
      if (snap.availableBalance < stake) {
        throw new BadRequestException('Saldo insuficiente');
      }
    }

    const isFreeSeat = usePremiumFreeEntry || useFreeEntryCredit;

    // Demo: minPlayers = human threshold; bots fill separately toward target
    const minPlayers = isDemo ? BR_DEMO_MIN_PLAYERS : BR_MIN_PLAYERS;

    // Match abierto mismo stake+asset+isDemo (nunca mezclar demo/real)
    let match = await this.prisma.brMatch.findFirst({
      where: {
        asset,
        stake,
        isDemo,
        status: { in: [BrMatchStatus.QUEUE, BrMatchStatus.COUNTDOWN] },
        playerCount: { lt: BR_MAX_PLAYERS },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!match) {
      match = await this.prisma.brMatch.create({
        data: {
          asset,
          stake,
          isDemo,
          status: BrMatchStatus.QUEUE,
          maxPlayers: BR_MAX_PLAYERS,
          minPlayers,
          durationSeconds: BR_MATCH_DURATION_SECONDS,
          countdownSeconds: BR_COUNTDOWN_SECONDS,
        },
      });
    }

    // Prioridad Premium: si la partida está llena, desplaza al free más reciente
    if (match.playerCount >= BR_MAX_PLAYERS) {
      if (!isPremium) {
        throw new BadRequestException('La partida está llena');
      }
      const displaced = await this.prisma.brMatchPlayer.findFirst({
        where: {
          matchId: match.id,
          status: BrPlayerStatus.QUEUED,
          isPremium: false,
        },
        orderBy: { joinedAt: 'desc' },
      });
      if (!displaced) {
        throw new BadRequestException(
          'La partida está llena (solo Premium en cola)',
        );
      }
      await this.forceLeaveQueuePlayer(
        displaced.id,
        displaced.userId,
        match.id,
        toNumber(displaced.stake),
        displaced.usedFreeEntry,
        displaced.freeEntryCreditId,
      );
      match = await this.prisma.brMatch.findUniqueOrThrow({
        where: { id: match.id },
      });
    }

    if (!isDemo && !isFreeSeat) {
      await this.wallet.lockFunds(
        userId,
        stake,
        WalletTxType.BR_STAKE,
        `BR stake $${stake} · ${asset}`,
      );
    }
    // Demo / free entry: no lock.

    const nextCount = match.playerCount + 1;
    const pot = brPot(nextCount, stake);
    const fee = brPlatformFee(pot);
    const prize = brPrizePool(pot);

    const player = await this.prisma.brMatchPlayer.create({
      data: {
        matchId: match.id,
        userId,
        username: user.username,
        isPremium,
        isBot: false,
        usedFreeEntry: isFreeSeat,
        freeEntryCreditId: null,
        stake,
        virtualCapital: BR_VIRTUAL_CAPITAL,
        status: BrPlayerStatus.QUEUED,
      },
    });

    if (usePremiumFreeEntry) {
      const weekKey = utcIsoWeekKey();
      await this.prisma.premiumFreeEntryUse.create({
        data: {
          userId,
          weekKey,
          matchId: match.id,
          playerId: player.id,
          stake,
        },
      });
    } else if (useFreeEntryCredit) {
      try {
        const creditId = await this.referrals.spendCredit(
          userId,
          stake,
          match.id,
          player.id,
        );
        await this.prisma.brMatchPlayer.update({
          where: { id: player.id },
          data: { freeEntryCreditId: creditId },
        });
      } catch (err) {
        // Roll back seat if voucher spend failed
        await this.prisma.brMatchPlayer.update({
          where: { id: player.id },
          data: { status: BrPlayerStatus.LEFT, leftAt: new Date() },
        });
        throw err;
      }
    }

    let status = match.status;
    let countdownEndsAt = match.countdownEndsAt;
    let countdownStartedAt = match.countdownStartedAt;

    // Threshold → countdown
    // Demo: human count; Real: total seats
    const shouldCountdown =
      status === BrMatchStatus.QUEUE &&
      (isDemo
        ? (await this.countHumansQueued(match.id)) >= BR_DEMO_MIN_HUMANS_TO_START
        : nextCount >= match.minPlayers);

    if (shouldCountdown) {
      status = BrMatchStatus.COUNTDOWN;
      countdownStartedAt = new Date();
      countdownEndsAt = new Date(Date.now() + BR_COUNTDOWN_SECONDS * 1000);
      this.market.retainAsset(asset);
    }

    // Full lobby → snap countdown to 10s if still longer (do not skip to LIVE)
    const fullSnap = this.snapCountdownIfFull(
      nextCount,
      match.maxPlayers ?? BR_MAX_PLAYERS,
      status,
      countdownEndsAt,
      countdownStartedAt,
    );
    status = fullSnap.status;
    countdownEndsAt = fullSnap.countdownEndsAt;
    countdownStartedAt = fullSnap.countdownStartedAt;
    if (fullSnap.snapped) {
      this.market.retainAsset(asset);
      this.logger.log(
        `BR full lobby snap · match=${match.id} · N=${nextCount} · countdown→${BR_FULL_LOBBY_COUNTDOWN_SECONDS}s`,
      );
    }

    match = await this.prisma.brMatch.update({
      where: { id: match.id },
      data: {
        playerCount: nextCount,
        pot,
        platformFee: fee,
        prizePool: prize,
        status,
        countdownEndsAt,
        countdownStartedAt,
      },
    });

    this.broadcastMatch(match.id);
    // DEMO ONLY: fill seats with bots (staggered) so solo play feels full
    if (isDemo && nextCount < BR_MAX_PLAYERS) {
      void this.scheduleDemoBotFill(match.id);
    }

    return this.toQueueSnapshot(match.id, userId);
  }

  async leaveQueue(userId: string) {
    const player = await this.prisma.brMatchPlayer.findFirst({
      where: {
        userId,
        status: BrPlayerStatus.QUEUED,
        match: {
          status: { in: [BrMatchStatus.QUEUE, BrMatchStatus.COUNTDOWN] },
        },
      },
      include: { match: true },
    });
    if (!player) {
      throw new BadRequestException('No estás en cola');
    }

    const stake = toNumber(player.stake);
    // Demo / free entry: no había saldo bloqueado
    if (!player.usedFreeEntry && stake > 0 && !player.match.isDemo) {
      await this.wallet.unlockFunds(
        userId,
        stake,
        WalletTxType.BR_REFUND,
        `BR canceló cola · reembolso $${stake}`,
      );
    }
    // Free entry cancel: restore Premium weekly OR referral credit
    if (player.usedFreeEntry) {
      if (player.freeEntryCreditId) {
        await this.referrals.restoreCredit(
          player.freeEntryCreditId,
          userId,
        );
      } else {
        await this.prisma.premiumFreeEntryUse.deleteMany({
          where: { playerId: player.id },
        });
      }
    }
    // Demo: sin wallet

    await this.prisma.brMatchPlayer.update({
      where: { id: player.id },
      data: { status: BrPlayerStatus.LEFT, leftAt: new Date() },
    });

    const nextCount = Math.max(0, player.match.playerCount - 1);
    const pot = brPot(nextCount, toNumber(player.match.stake));
    let status = player.match.status;

    // Drop below minimum in countdown → back to QUEUE
    // Demo: only humans matter; bots alone never keep a match open
    if (status === BrMatchStatus.COUNTDOWN) {
      if (player.match.isDemo) {
        const humansLeft = await this.countHumansQueued(player.matchId);
        if (humansLeft < BR_DEMO_MIN_HUMANS_TO_START) {
          status = BrMatchStatus.QUEUE;
        }
      } else if (nextCount < player.match.minPlayers) {
        status = BrMatchStatus.QUEUE;
      }
    }

    await this.prisma.brMatch.update({
      where: { id: player.matchId },
      data: {
        playerCount: nextCount,
        pot,
        platformFee: brPlatformFee(pot),
        prizePool: brPrizePool(pot),
        status,
        countdownEndsAt:
          status === BrMatchStatus.QUEUE ? null : player.match.countdownEndsAt,
        countdownStartedAt:
          status === BrMatchStatus.QUEUE
            ? null
            : player.match.countdownStartedAt,
      },
    });

    // Demo: if no humans remain, cancel and clear bots
    if (player.match.isDemo) {
      const humansLeft = await this.countHumansQueued(player.matchId);
      if (humansLeft === 0) {
        await this.cancelDemoMatchEmpty(player.matchId);
        return { ok: true };
      }
    }

    if (nextCount === 0) {
      await this.prisma.brMatch.update({
        where: { id: player.matchId },
        data: { status: BrMatchStatus.CANCELLED },
      });
    } else {
      this.broadcastMatch(player.matchId);
    }

    return { ok: true };
  }

  async getMyActive(userId: string) {
    const player = await this.prisma.brMatchPlayer.findFirst({
      where: {
        userId,
        status: { in: [BrPlayerStatus.QUEUED, BrPlayerStatus.PLAYING] },
        match: {
          status: {
            in: [
              BrMatchStatus.QUEUE,
              BrMatchStatus.COUNTDOWN,
              BrMatchStatus.LIVE,
              BrMatchStatus.SETTLING,
            ],
          },
        },
      },
      include: { match: true },
      orderBy: { joinedAt: 'desc' },
    });
    if (!player) return null;
    if (
      player.match.status === BrMatchStatus.QUEUE ||
      player.match.status === BrMatchStatus.COUNTDOWN
    ) {
      return this.toQueueSnapshot(player.matchId, userId);
    }
    return this.toMatchSnapshot(player.matchId, userId);
  }

  async getMatch(matchId: string, userId?: string) {
    return this.toMatchSnapshot(matchId, userId);
  }

  // ─── Historial / stats ───────────────────────────────────────────────────

  /** Free: últimas 10 · Premium: hasta 100 */
  async getHistory(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { isPremium: true },
    });
    const limit = user.isPremium ? 100 : 10;
    const rows = await this.prisma.brMatchPlayer.findMany({
      where: {
        userId,
        status: BrPlayerStatus.SETTLED,
        match: { status: BrMatchStatus.COMPLETED },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        match: {
          select: {
            id: true,
            asset: true,
            stake: true,
            playerCount: true,
            prizePool: true,
            settledAt: true,
            liveStartedAt: true,
          },
        },
      },
    });

    return {
      isPremium: user.isPremium,
      limit,
      totalShown: rows.length,
      truncated: !user.isPremium && rows.length >= 10,
      matches: rows.map((r) => ({
        matchId: r.match.id,
        asset: r.match.asset,
        stake: toNumber(r.match.stake),
        playerCount: r.match.playerCount,
        rank: r.rank,
        totalPnl: toNumber(r.totalPnl),
        prizeAmount: r.prizeAmount != null ? toNumber(r.prizeAmount) : 0,
        tradeCount: r.tradeCount,
        settledAt: r.match.settledAt?.toISOString() ?? null,
        startedAt: r.match.liveStartedAt?.toISOString() ?? null,
      })),
    };
  }

  async getStats(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { isPremium: true, username: true },
    });

    const settled = await this.prisma.brMatchPlayer.findMany({
      where: {
        userId,
        status: BrPlayerStatus.SETTLED,
        match: { status: BrMatchStatus.COMPLETED, isDemo: false },
      },
      include: {
        match: { select: { asset: true, stake: true } },
      },
    });

    const games = settled.length;
    const top5 = settled.filter((r) => r.rank != null && r.rank <= 5).length;
    const wins = settled.filter((r) => r.rank === 1).length;
    const totalPrize = settled.reduce(
      (s, r) => s + (r.prizeAmount != null ? toNumber(r.prizeAmount) : 0),
      0,
    );
    const totalPnl = settled.reduce((s, r) => s + toNumber(r.totalPnl), 0);
    const avgPnl = games > 0 ? totalPnl / games : 0;
    const avgRank =
      games > 0
        ? settled.reduce((s, r) => s + (r.rank ?? 0), 0) / games
        : 0;

    const basic = {
      isPremium: user.isPremium,
      games,
      wins,
      top5,
      top5Rate: games > 0 ? Math.round((top5 / games) * 1000) / 10 : 0,
      totalPrize: Math.round(totalPrize * 100) / 100,
      avgPnl: Math.round(avgPnl * 100) / 100,
      avgRank: Math.round(avgRank * 10) / 10,
    };

    if (!user.isPremium) {
      return {
        ...basic,
        advanced: null,
        upgradeHint:
          'Premium unlocks asset & stake breakdowns, Top 5 streak, recent form, and full match history.',
      };
    }

    // Premium advanced analytics
    const byAsset: Record<
      string,
      { games: number; top5: number; pnl: number; prize: number }
    > = {};
    const byStake: Record<
      string,
      { games: number; top5: number; pnl: number; prize: number }
    > = {};
    for (const r of settled) {
      const a = r.match.asset;
      if (!byAsset[a]) byAsset[a] = { games: 0, top5: 0, pnl: 0, prize: 0 };
      byAsset[a].games += 1;
      if (r.rank != null && r.rank <= 5) byAsset[a].top5 += 1;
      byAsset[a].pnl += toNumber(r.totalPnl);
      byAsset[a].prize +=
        r.prizeAmount != null ? toNumber(r.prizeAmount) : 0;

      const sk = String(toNumber(r.match.stake));
      if (!byStake[sk]) byStake[sk] = { games: 0, top5: 0, pnl: 0, prize: 0 };
      byStake[sk].games += 1;
      if (r.rank != null && r.rank <= 5) byStake[sk].top5 += 1;
      byStake[sk].pnl += toNumber(r.totalPnl);
      byStake[sk].prize +=
        r.prizeAmount != null ? toNumber(r.prizeAmount) : 0;
    }

    let bestStreak = 0;
    let cur = 0;
    const chrono = [...settled].sort(
      (a, b) => a.updatedAt.getTime() - b.updatedAt.getTime(),
    );
    for (const r of chrono) {
      if (r.rank != null && r.rank <= 5) {
        cur += 1;
        bestStreak = Math.max(bestStreak, cur);
      } else cur = 0;
    }

    const bestFinish = settled.reduce(
      (best, r) =>
        r.rank != null && (best == null || r.rank < best) ? r.rank : best,
      null as number | null,
    );

    // Recent form: last 10 finishes (newest first)
    const recentForm = [...settled]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 10)
      .map((r) => ({
        rank: r.rank,
        pnl: Math.round(toNumber(r.totalPnl) * 100) / 100,
        prize: r.prizeAmount != null ? toNumber(r.prizeAmount) : 0,
        asset: r.match.asset,
        stake: toNumber(r.match.stake),
      }));

    // Simple profit factor: sum greens / abs(sum reds) on match PnL
    let green = 0;
    let red = 0;
    for (const r of settled) {
      const p = toNumber(r.totalPnl);
      if (p > 0) green += p;
      else if (p < 0) red += Math.abs(p);
    }
    const profitFactor =
      red > 1e-9
        ? Math.round((green / red) * 100) / 100
        : green > 0
          ? null
          : null;
    // If no losses, show null rather than Infinity
    const pf =
      red > 1e-9 ? profitFactor : green > 0 ? green : null;

    return {
      ...basic,
      advanced: {
        totalPnl: Math.round(totalPnl * 100) / 100,
        bestFinish,
        bestTop5Streak: bestStreak,
        profitFactor: pf != null ? Math.round(pf * 100) / 100 : null,
        byAsset: Object.entries(byAsset).map(([asset, v]) => ({
          asset,
          games: v.games,
          top5: v.top5,
          avgPnl: Math.round((v.pnl / v.games) * 100) / 100,
          prizeTotal: Math.round(v.prize * 100) / 100,
        })),
        byStake: Object.entries(byStake)
          .map(([stake, v]) => ({
            stake: Number(stake),
            games: v.games,
            top5: v.top5,
            avgPnl: Math.round((v.pnl / v.games) * 100) / 100,
            prizeTotal: Math.round(v.prize * 100) / 100,
          }))
          .sort((a, b) => a.stake - b.stake),
        recentForm,
      },
      upgradeHint: null,
    };
  }

  // ─── Chat ────────────────────────────────────────────────────────────────

  async getChat(matchId: string, limit = 80) {
    const msgs = await this.prisma.brChatMessage.findMany({
      where: { matchId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
    return msgs.reverse().map((m) => ({
      id: m.id,
      matchId: m.matchId,
      userId: m.userId,
      username: m.username,
      isPremium: m.isPremium,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async postChat(matchId: string, userId: string, bodyRaw: string) {
    const body = bodyRaw?.trim().slice(0, 280);
    if (!body) throw new BadRequestException('Mensaje vacío');

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (!user.isPremium) {
      throw new BadRequestException('Solo Premium puede chatear');
    }

    const player = await this.prisma.brMatchPlayer.findUnique({
      where: { matchId_userId: { matchId, userId } },
    });
    if (!player) {
      throw new BadRequestException('No participas de esta partida');
    }

    const match = await this.prisma.brMatch.findUniqueOrThrow({
      where: { id: matchId },
    });
    if (
      ![
        BrMatchStatus.LIVE,
        BrMatchStatus.SETTLING,
        BrMatchStatus.COMPLETED,
        BrMatchStatus.COUNTDOWN,
      ].includes(match.status as never)
    ) {
      throw new BadRequestException('Chat no disponible en este estado');
    }

    const msg = await this.prisma.brChatMessage.create({
      data: {
        matchId,
        userId,
        username: user.username,
        isPremium: true,
        body,
      },
    });

    const dto = {
      id: msg.id,
      matchId: msg.matchId,
      userId: msg.userId,
      username: msg.username,
      isPremium: msg.isPremium,
      body: msg.body,
      createdAt: msg.createdAt.toISOString(),
    };
    this.emit(matchId, 'br:chat', dto);
    return dto;
  }

  // ─── Trades ──────────────────────────────────────────────────────────────

  /** LIVE status + past match intro (official trading clock started). */
  private isMatchTradingOpen(match: {
    status: BrMatchStatus;
    liveStartedAt: Date | null;
  }): boolean {
    if (match.status !== BrMatchStatus.LIVE) return false;
    if (!match.liveStartedAt) return true; // legacy rows
    return Date.now() >= match.liveStartedAt.getTime();
  }

  private assertMatchTradingOpen(match: {
    status: BrMatchStatus;
    liveStartedAt: Date | null;
  }) {
    if (match.status !== BrMatchStatus.LIVE) {
      throw new BadRequestException('Match is not live');
    }
    if (!this.isMatchTradingOpen(match)) {
      throw new BadRequestException(
        'Match is starting — trading opens in a few seconds',
      );
    }
  }

  async openTrade(
    matchId: string,
    userId: string,
    input: {
      side: 'LONG' | 'SHORT';
      orderType: 'MARKET' | 'LIMIT';
      entryPrice?: number;
      stopLoss: number;
      takeProfit?: number | null;
      riskPct: number;
    },
  ) {
    const match = await this.prisma.brMatch.findUniqueOrThrow({
      where: { id: matchId },
    });
    this.assertMatchTradingOpen(match);

    let player = await this.prisma.brMatchPlayer.findUnique({
      where: { matchId_userId: { matchId, userId } },
    });

    // Repair race: match already LIVE but seat still QUEUED (tick/start timing)
    if (
      player &&
      player.status === BrPlayerStatus.QUEUED &&
      match.status === BrMatchStatus.LIVE
    ) {
      player = await this.prisma.brMatchPlayer.update({
        where: { id: player.id },
        data: { status: BrPlayerStatus.PLAYING },
      });
      this.logger.warn(
        `BR seat repair: promoted QUEUED→PLAYING user=${userId} match=${matchId}`,
      );
    }

    if (!player) {
      this.logger.warn(
        `BR openTrade: no seat user=${userId} match=${matchId} demo=${match.isDemo}`,
      );
      throw new BadRequestException(
        'You are not seated in this match. Re-join from the lobby/demo queue.',
      );
    }
    if (player.status !== BrPlayerStatus.PLAYING) {
      this.logger.warn(
        `BR openTrade: bad seat status=${player.status} user=${userId} match=${matchId}`,
      );
      throw new BadRequestException(
        `You cannot trade right now (seat status: ${player.status}).`,
      );
    }

    const validation = validateBrTradeOpen({
      tradeCount: player.tradeCount,
      totalRiskUsedPct: toNumber(player.totalRiskUsedPct),
      riskPct: input.riskPct,
    });
    if (!validation.ok) throw new BadRequestException(validation.message);

    if (!(input.stopLoss > 0)) {
      throw new BadRequestException('Stop loss is required');
    }

    const asset = match.asset as AssetSymbol;
    let status: TradeStatus = TradeStatus.PENDING;
    let entryPrice: number | null = null;
    let openedAt: Date | null = null;

    if (input.orderType === 'MARKET') {
      const tick = this.market.getTick(asset);
      if (!tick?.mid || !(tick.mid > 0)) {
        throw new BadRequestException('No price available for this asset');
      }
      entryPrice = marketEntryPrice(input.side, tick);
      if (!(entryPrice > 0)) {
        throw new BadRequestException('Could not determine market entry price');
      }
      const slTp = validateMarketSlTp(
        input.side,
        entryPrice,
        input.stopLoss,
        input.takeProfit ?? null,
      );
      if (!slTp.ok) throw new BadRequestException(slTp.message);
      status = TradeStatus.OPEN;
      openedAt = new Date();
    } else if (input.orderType === 'LIMIT') {
      if (!input.entryPrice || !(input.entryPrice > 0)) {
        throw new BadRequestException('Limit order requires an entry price');
      }
      if (!isStopLossValid(input.side, input.entryPrice, input.stopLoss)) {
        throw new BadRequestException(
          input.side === 'LONG'
            ? 'On LONG, stop loss must be below the entry price'
            : 'On SHORT, stop loss must be above the entry price',
        );
      }
      if (
        input.takeProfit != null &&
        input.takeProfit > 0 &&
        !isTakeProfitValid(input.side, input.entryPrice, input.takeProfit)
      ) {
        throw new BadRequestException(
          input.side === 'LONG'
            ? 'On LONG, take profit must be above the entry price'
            : 'On SHORT, take profit must be below the entry price',
        );
      }
      entryPrice = input.entryPrice;
      status = TradeStatus.PENDING;
      openedAt = null;
    } else {
      throw new BadRequestException('Order type must be MARKET or LIMIT');
    }

    // Freeze size + original risk at open (1R $ never resets when SL moves later)
    if (entryPrice == null || !(entryPrice > 0)) {
      throw new BadRequestException('Entry price required to size position');
    }
    const frozen = brFreezeOpenRisk({
      side: input.side,
      entryPrice,
      stopLoss: input.stopLoss,
      riskPct: input.riskPct,
      capital: BR_VIRTUAL_CAPITAL,
    });
    if (!(frozen.positionSize > 0)) {
      throw new BadRequestException(
        'Stop loss is too close to entry to size a position',
      );
    }

    const trade = await this.prisma.brTrade.create({
      data: {
        matchId,
        playerId: player.id,
        userId,
        asset: match.asset,
        side: input.side as TradeSide,
        orderType: input.orderType as OrderType,
        status,
        entryPrice,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit ?? null,
        riskPct: input.riskPct,
        riskAmount: frozen.originalRiskAmount,
        originalStopLoss: frozen.originalStopLoss,
        positionSize: frozen.positionSize,
        reservedRiskAmount: frozen.reservedRiskAmount,
        openedAt,
      },
    });

    await this.prisma.brMatchPlayer.update({
      where: { id: player.id },
      data: {
        tradeCount: { increment: 1 },
        totalRiskUsedPct: {
          increment: input.riskPct,
        },
        openTrades: {
          increment: status === TradeStatus.OPEN ? 1 : 0,
        },
      },
    });

    this.market.retainAsset(match.asset);
    const result = this.toTradeDto(trade);
    this.emit(matchId, 'br:trade', result);
    this.broadcastMatch(matchId);
    return result;
  }

  async closeTrade(matchId: string, userId: string, tradeId: string) {
    const match = await this.prisma.brMatch.findUniqueOrThrow({
      where: { id: matchId },
    });
    this.assertMatchTradingOpen(match);
    const trade = await this.prisma.brTrade.findFirst({
      where: { id: tradeId, matchId, userId },
    });
    if (!trade) throw new BadRequestException('Trade not found');
    if (trade.status !== TradeStatus.OPEN) {
      throw new BadRequestException('Only open trades can be closed');
    }
    return this.closeTradeAt(trade.id, 'MARKET');
  }

  /**
   * DEMO only: force match into settlement immediately (testing result modal).
   */
  async forceEndDemo(matchId: string, userId: string) {
    const match = await this.prisma.brMatch.findUniqueOrThrow({
      where: { id: matchId },
    });
    if (!match.isDemo) {
      throw new BadRequestException(
        'Force end is only available in Demo matches',
      );
    }
    if (match.status !== BrMatchStatus.LIVE) {
      throw new BadRequestException('Match is not live');
    }
    const seat = await this.prisma.brMatchPlayer.findUnique({
      where: { matchId_userId: { matchId, userId } },
    });
    if (!seat || seat.isBot) {
      throw new BadRequestException('You must be seated in this demo match');
    }
    this.logger.log(`BR DEMO force-end by ${userId} · ${matchId}`);
    await this.settleMatch(matchId);
    return this.toMatchSnapshot(matchId, userId);
  }

  async cancelTrade(matchId: string, userId: string, tradeId: string) {
    const match = await this.prisma.brMatch.findUniqueOrThrow({
      where: { id: matchId },
    });
    this.assertMatchTradingOpen(match);
    const trade = await this.prisma.brTrade.findFirst({
      where: { id: tradeId, matchId, userId },
    });
    if (!trade) throw new BadRequestException('Trade not found');
    if (trade.status !== TradeStatus.PENDING) {
      throw new BadRequestException('Only pending limits can be cancelled');
    }
    const reserved = toNumber(trade.reservedRiskAmount) || toNumber(trade.riskAmount);
    const releasePct = brRiskPctFromAmount(reserved, BR_VIRTUAL_CAPITAL);

    const updated = await this.prisma.brTrade.update({
      where: { id: tradeId },
      data: {
        status: TradeStatus.CANCELLED,
        closedAt: new Date(),
        reservedRiskAmount: 0,
      },
    });

    // Return reserved risk to match budget
    if (releasePct > 0) {
      await this.prisma.brMatchPlayer.update({
        where: { id: trade.playerId },
        data: {
          totalRiskUsedPct: {
            decrement: releasePct,
          },
        },
      });
      // Clamp floor at 0
      const seat = await this.prisma.brMatchPlayer.findUnique({
        where: { id: trade.playerId },
      });
      if (seat && toNumber(seat.totalRiskUsedPct) < 0) {
        await this.prisma.brMatchPlayer.update({
          where: { id: trade.playerId },
          data: { totalRiskUsedPct: 0 },
        });
      }
    }

    const result = this.toTradeDto(updated);
    this.emit(matchId, 'br:trade_update', result);
    this.broadcastMatch(matchId);
    return result;
  }

  /**
   * Edit SL / TP on an OPEN or PENDING trade.
   * SL is always required (cannot clear). TP optional (null clears).
   */
  async updateTradeLevels(
    matchId: string,
    userId: string,
    tradeId: string,
    input: { stopLoss: number; takeProfit?: number | null },
  ) {
    const match = await this.prisma.brMatch.findUniqueOrThrow({
      where: { id: matchId },
    });
    this.assertMatchTradingOpen(match);

    const trade = await this.prisma.brTrade.findFirst({
      where: { id: tradeId, matchId, userId },
    });
    if (!trade) throw new BadRequestException('Trade not found');
    if (
      trade.status !== TradeStatus.OPEN &&
      trade.status !== TradeStatus.PENDING
    ) {
      throw new BadRequestException(
        'Only open or pending trades can edit SL/TP',
      );
    }
    if (!(input.stopLoss > 0)) {
      throw new BadRequestException('Stop loss is required');
    }

    const side = (String(trade.side).toUpperCase() === 'SHORT'
      ? 'SHORT'
      : 'LONG') as 'LONG' | 'SHORT';
    const statusRaw = String(trade.status ?? '');
    const status = statusRaw.toUpperCase();
    // Treat filled trades as OPEN even if status string is odd
    const isOpen =
      status === 'OPEN' ||
      status === 'Open' ||
      (trade.openedAt != null &&
        status !== 'PENDING' &&
        status !== 'CANCELLED' &&
        status !== 'EXPIRED' &&
        status !== 'CLOSED');
    const isPending = status === 'PENDING' && !isOpen;
    const entry =
      trade.entryPrice != null && toNumber(trade.entryPrice) > 0
        ? toNumber(trade.entryPrice)
        : null;
    if (entry == null) {
      throw new BadRequestException(
        'Trade has no entry price to validate against',
      );
    }

    const tp =
      input.takeProfit == null || !(input.takeProfit > 0)
        ? null
        : input.takeProfit;

    // Resolve mid — retain asset and re-read if missing
    this.market.retainAsset(match.asset);
    let tick = this.market.getTick(match.asset as AssetSymbol);
    let mid = tick?.mid != null && tick.mid > 0 ? tick.mid : null;
    if (mid == null && tick?.bid != null && tick?.ask != null) {
      mid = (tick.bid + tick.ask) / 2;
    }

    // Debug (demo / dev) — identify which validator ran
    if (match.isDemo || process.env.NODE_ENV !== 'production') {
      this.logger.log(
        `[updateTradeLevels] status=${statusRaw} isOpen=${isOpen} isPending=${isPending} side=${side} entry=${entry} mid=${mid} requestedSl=${input.stopLoss} validator=${isOpen ? 'OPEN_MID' : isPending ? 'PENDING_ENTRY' : 'NONE'}`,
      );
    }

    // OPEN: ONLY mid-based validator — never isStopLossValid(entry)
    // Example: LONG entry=100 mid=105 SL=102 → ALLOW
    if (isOpen) {
      if (mid == null || !(mid > 0)) {
        throw new BadRequestException(
          'No market price available to validate stop loss',
        );
      }
      const slOk = validateOpenTradeStopLoss(side, input.stopLoss, mid);
      if (!slOk.ok) throw new BadRequestException(slOk.message);
      if (tp != null) {
        const tpOk = validateOpenTradeTakeProfit(side, tp, mid);
        if (!tpOk.ok) throw new BadRequestException(tpOk.message);
      }
    } else if (isPending) {
      // PENDING limit only — never use this branch for OPEN
      if (!isStopLossValid(side, entry, input.stopLoss)) {
        throw new BadRequestException(
          side === 'LONG'
            ? 'On LONG, stop loss must be below the entry price'
            : 'On SHORT, stop loss must be above the entry price',
        );
      }
      if (tp != null && !isTakeProfitValid(side, entry, tp)) {
        throw new BadRequestException(
          side === 'LONG'
            ? 'On LONG, take profit must be above the entry price'
            : 'On SHORT, take profit must be below the entry price',
        );
      }
    } else {
      throw new BadRequestException(
        'Only open or pending trades can edit SL/TP',
      );
    }

    // Fixed-size risk budget: widen needs free risk; tighten releases
    const originalRiskAmount = toNumber(trade.riskAmount);
    const originalStopLoss =
      toNumber(trade.originalStopLoss) > 0
        ? toNumber(trade.originalStopLoss)
        : toNumber(trade.stopLoss);
    const currentReserved =
      toNumber(trade.reservedRiskAmount) > 0
        ? toNumber(trade.reservedRiskAmount)
        : originalRiskAmount;

    const player = await this.prisma.brMatchPlayer.findUniqueOrThrow({
      where: { id: trade.playerId },
    });
    // Free budget = remaining besides this trade's current reserved
    const usedPct = toNumber(player.totalRiskUsedPct);
    const usedExcludingThis = Math.max(
      0,
      usedPct - brRiskPctFromAmount(currentReserved, BR_VIRTUAL_CAPITAL),
    );
    const freeRiskBudget = brRemainingRiskAmount({
      totalRiskUsedPct: usedExcludingThis,
      maxRiskPct: BR_MAX_RISK_PCT,
      capital: BR_VIRTUAL_CAPITAL,
    });

    const riskCheck = brValidateSlRiskChange({
      side,
      entryPrice: entry,
      originalStopLoss,
      originalRiskAmount,
      currentReserved,
      newStopLoss: input.stopLoss,
      freeRiskBudget,
    });
    if (!riskCheck.ok) {
      throw new BadRequestException(riskCheck.message);
    }

    const deltaPct = brRiskPctFromAmount(
      riskCheck.deltaReserved,
      BR_VIRTUAL_CAPITAL,
    );

    const updated = await this.prisma.brTrade.update({
      where: { id: tradeId },
      data: {
        stopLoss: input.stopLoss,
        takeProfit: tp,
        reservedRiskAmount: riskCheck.newReserved,
        // Backfill freeze fields if legacy row
        originalStopLoss:
          toNumber(trade.originalStopLoss) > 0
            ? undefined
            : originalStopLoss,
        positionSize:
          toNumber(trade.positionSize) > 0
            ? undefined
            : originalRiskAmount /
              Math.max(
                1e-12,
                Math.abs(entry - originalStopLoss),
              ),
      },
    });

    if (Math.abs(deltaPct) > 1e-9) {
      await this.prisma.brMatchPlayer.update({
        where: { id: trade.playerId },
        data: {
          totalRiskUsedPct: { increment: deltaPct },
        },
      });
      const seat = await this.prisma.brMatchPlayer.findUnique({
        where: { id: trade.playerId },
      });
      if (seat && toNumber(seat.totalRiskUsedPct) < 0) {
        await this.prisma.brMatchPlayer.update({
          where: { id: trade.playerId },
          data: { totalRiskUsedPct: 0 },
        });
      }
    }

    const result = this.toTradeDto(updated);
    this.emit(matchId, 'br:trade_update', result);
    this.broadcastMatch(matchId);
    return {
      ...result,
      riskMessage: riskCheck.widened
        ? 'SL widened — extra risk reserved'
        : riskCheck.tightened
          ? 'SL tightened'
          : null,
      reservedRiskAmount: riskCheck.newReserved,
      riskDelta: riskCheck.deltaReserved,
    };
  }

  // ─── Tick / lifecycle ────────────────────────────────────────────────────

  private async tick() {
    try {
      const now = new Date();

      // Countdown → start
      const ready = await this.prisma.brMatch.findMany({
        where: {
          status: BrMatchStatus.COUNTDOWN,
          countdownEndsAt: { lte: now },
        },
      });
      for (const m of ready) {
        if (m.isDemo) {
          const humans = await this.countHumansQueued(m.id);
          if (humans >= BR_DEMO_MIN_HUMANS_TO_START) {
            await this.startMatch(m.id);
          }
        } else if (m.playerCount >= m.minPlayers) {
          await this.startMatch(m.id);
        }
      }

      // Live → settle
      const ending = await this.prisma.brMatch.findMany({
        where: {
          status: BrMatchStatus.LIVE,
          liveEndsAt: { lte: now },
        },
      });
      for (const m of ending) {
        await this.settleMatch(m.id);
      }

      // DEMO ONLY: bot trading while live
      const liveDemo = await this.prisma.brMatch.findMany({
        where: { isDemo: true, status: BrMatchStatus.LIVE },
        select: { id: true },
      });
      for (const m of liveDemo) {
        await this.tickDemoBotTrades(m.id);
      }

      // Broadcast countdown ticks for open queues
      const open = await this.prisma.brMatch.findMany({
        where: {
          status: { in: [BrMatchStatus.QUEUE, BrMatchStatus.COUNTDOWN] },
          playerCount: { gt: 0 },
        },
      });
      for (const m of open) {
        this.emitLobby('br:queue_update', await this.toPublicQueue(m.id));
        // Keep filling incomplete demo queues (e.g. after restart)
        if (m.isDemo && m.playerCount < BR_DEMO_TARGET_PLAYERS) {
          void this.scheduleDemoBotFill(m.id);
        }
      }
    } catch (err) {
      this.logger.warn(`BR tick error: ${err}`);
    }
  }

  private async startMatch(matchId: string) {
    const match = await this.prisma.brMatch.findUnique({
      where: { id: matchId },
      include: { players: { where: { status: BrPlayerStatus.QUEUED } } },
    });
    if (!match) return;
    if (
      match.status !== BrMatchStatus.COUNTDOWN &&
      match.status !== BrMatchStatus.QUEUE
    ) {
      return;
    }
    if (match.isDemo) {
      const humans = await this.countHumansQueued(matchId);
      if (humans < BR_DEMO_MIN_HUMANS_TO_START) return;
    } else if (match.playerCount < match.minPlayers) {
      return;
    }

    const now = new Date();
    // Intro (MATCH STARTING) is outside the 10:00 trading clock
    const introMs = BR_MATCH_INTRO_SECONDS * 1000;
    const liveStartedAt = new Date(now.getTime() + introMs);
    const liveEndsAt = new Date(
      liveStartedAt.getTime() + match.durationSeconds * 1000,
    );

    await this.prisma.brMatch.update({
      where: { id: matchId },
      data: {
        status: BrMatchStatus.LIVE,
        // liveStartedAt = when trading clock begins (after intro)
        liveStartedAt,
        liveEndsAt,
      },
    });

    const promoted = await this.prisma.brMatchPlayer.updateMany({
      where: { matchId, status: BrPlayerStatus.QUEUED },
      data: { status: BrPlayerStatus.PLAYING },
    });

    this.market.retainAsset(match.asset);
    this.logger.log(
      `BR START ${matchId} · ${match.playerCount} players · promoted=${promoted.count} · ${match.asset} · demo=${match.isDemo} · $${toNumber(match.stake)} · intro=${BR_MATCH_INTRO_SECONDS}s · tradeStart=${liveStartedAt.toISOString()}`,
    );

    // Public snapshot for room (clients merge with local seat data)
    const snap = await this.toMatchSnapshot(matchId);
    this.emit(matchId, 'br:started', snap);
    this.emitLobby('br:match_started', {
      matchId,
      asset: match.asset,
      stake: toNumber(match.stake),
    });
    // Notify each player room via lobby with match id
    for (const p of match.players) {
      this.emitLobby('br:you_started', { matchId, userId: p.userId });
    }
  }

  private async settleMatch(matchId: string) {
    const match = await this.prisma.brMatch.findUnique({
      where: { id: matchId },
      include: {
        players: { where: { status: BrPlayerStatus.PLAYING } },
        trades: {
          where: { status: { in: [TradeStatus.OPEN, TradeStatus.PENDING] } },
        },
      },
    });
    if (!match || match.status !== BrMatchStatus.LIVE) return;

    await this.prisma.brMatch.update({
      where: { id: matchId },
      data: { status: BrMatchStatus.SETTLING },
    });

    // Close open trades at market / expire limits
    for (const t of match.trades) {
      try {
        if (t.status === TradeStatus.OPEN) {
          await this.closeTradeAt(t.id, 'TIME');
        } else if (t.status === TradeStatus.PENDING) {
          await this.prisma.brTrade.update({
            where: { id: t.id },
            data: {
              status: TradeStatus.EXPIRED,
              closedAt: new Date(),
              rMultiple: 0,
              pnl: 0,
              closeReason: 'EXPIRED',
            },
          });
        }
      } catch (err) {
        this.logger.warn(`Close trade ${t.id}: ${err}`);
      }
    }

    // Demo: reshape bot PnLs so most are weak/flat — humans can place Top 10
    if (match.isDemo) {
      await this.reshapeDemoBotPnls(matchId);
    }

    const players = await this.prisma.brMatchPlayer.findMany({
      where: {
        matchId,
        status: { in: [BrPlayerStatus.PLAYING, BrPlayerStatus.SETTLED] },
      },
    });

    const ranked = rankBrPlayers(
      players.map((p) => ({
        ...p,
        totalPnl: toNumber(p.totalPnl),
        tradeCount: p.tradeCount,
        joinedAt: p.joinedAt,
      })),
    );

    // Dynamic prizes + stake refunds by lobby size (demo uses display stake when stake=0)
    const rawStake = toNumber(match.stake);
    const effStake = brEffectiveStake(rawStake, match.isDemo);
    const structure = getBrPrizeStructure(ranked.length, effStake);
    this.logger.log(
      `BR SETTLE ${matchId} · N=${ranked.length} · stake=${effStake} · strong=${structure.strongCount} · refunds=${structure.refundSlots} · pool=${structure.prizePool}`,
    );

    for (let i = 0; i < ranked.length; i++) {
      const rank = i + 1;
      const p = ranked[i];
      const payout = payoutForRank(rank, structure);
      const prize = payout?.amount ?? 0;
      const kind = payout?.kind ?? null;
      const stake = toNumber(p.stake);

      // DEMO / bots: never touch wallets. Free entry: no consume. Real paid: consume stake.
      if (!match.isDemo && !p.isBot && !p.usedFreeEntry && stake > 0) {
        await this.wallet.unlockAndConsume(
          p.userId,
          stake,
          WalletTxType.BR_STAKE,
          `BR stake consumed $${stake}`,
        );
      }

      // Credit strong prizes and stake refunds
      if (!match.isDemo && !p.isBot && prize > 0) {
        const label =
          kind === 'REFUND'
            ? `BR stake back #${rank} · $${prize}`
            : `BR prize #${rank} · $${prize}${p.usedFreeEntry ? ' (free entry)' : ''}`;
        await this.wallet.credit(
          p.userId,
          prize,
          WalletTxType.BR_WIN,
          label,
        );
      }

      await this.prisma.brMatchPlayer.update({
        where: { id: p.id },
        data: {
          rank,
          prizeAmount: prize,
          status: BrPlayerStatus.SETTLED,
        },
      });

      // Real-money referral qualification (once per referred user; not demo)
      if (!match.isDemo && !p.isBot) {
        try {
          await this.referrals.tryQualifyOnRealMatch(p.userId, matchId);
        } catch (err) {
          this.logger.warn(
            `Referral qualify failed user=${p.userId}: ${String(err)}`,
          );
        }
      }
    }

    await this.prisma.brMatch.update({
      where: { id: matchId },
      data: {
        status: BrMatchStatus.COMPLETED,
        settledAt: new Date(),
      },
    });

    this.market.releaseAsset(match.asset);
    this.logger.log(`BR SETTLED ${matchId}`);

    const finalSnap = await this.toMatchSnapshot(matchId);
    this.emit(matchId, 'br:finished', finalSnap);
  }

  private async closeTradeAt(
    tradeId: string,
    reason: 'MARKET' | 'TIME' | 'SL' | 'TP',
  ) {
    const trade = await this.prisma.brTrade.findUnique({
      where: { id: tradeId },
    });
    if (!trade || trade.status !== TradeStatus.OPEN || trade.entryPrice == null) {
      return null;
    }

    const tick = this.market.getTick(trade.asset as AssetSymbol);
    const exit =
      reason === 'SL' || reason === 'TP'
        ? exitPriceForClose(
            trade.side as 'LONG' | 'SHORT',
            reason,
            toNumber(trade.stopLoss),
            trade.takeProfit != null ? toNumber(trade.takeProfit) : null,
            tick,
          )
        : exitPriceForClose(
            trade.side as 'LONG' | 'SHORT',
            reason === 'TIME' ? 'TIME' : 'MARKET',
            toNumber(trade.stopLoss),
            trade.takeProfit != null ? toNumber(trade.takeProfit) : null,
            tick,
          );

    const entry = toNumber(trade.entryPrice);
    const originalRiskAmount = toNumber(trade.riskAmount);
    const originalStopLoss =
      toNumber(trade.originalStopLoss) > 0
        ? toNumber(trade.originalStopLoss)
        : toNumber(trade.stopLoss);
    let positionSize = toNumber(trade.positionSize);
    if (!(positionSize > 0) && entry > 0) {
      const d = Math.abs(entry - originalStopLoss);
      positionSize = d > 0 ? originalRiskAmount / d : 0;
    }
    const reserved =
      toNumber(trade.reservedRiskAmount) > 0
        ? toNumber(trade.reservedRiskAmount)
        : originalRiskAmount;

    // Fixed size × price move (1R $ = originalRiskAmount; SL distance does not reset R base)
    const score = scoreBrTradeFixedSize({
      side: trade.side as 'LONG' | 'SHORT',
      entryPrice: entry,
      exitPrice: exit,
      positionSize,
      originalRiskAmount,
    });

    const updated = await this.prisma.brTrade.update({
      where: { id: tradeId },
      data: {
        status: TradeStatus.CLOSED,
        exitPrice: exit,
        rMultiple: score.rMultiple,
        pnl: score.pnl,
        closeReason: reason,
        closedAt: new Date(),
      },
    });

    // Update player totals + risk budget after close
    // Stop-out / loss consumes min(reserved, actualLoss); profit releases full reserved.
    const actualLoss = Math.max(0, -score.pnl);
    const release$ = Math.max(0, reserved - actualLoss);
    const extraConsume$ = Math.max(0, actualLoss - reserved);
    const riskPctAdjust =
      -brRiskPctFromAmount(release$, BR_VIRTUAL_CAPITAL) +
      brRiskPctFromAmount(extraConsume$, BR_VIRTUAL_CAPITAL);

    const player = await this.prisma.brMatchPlayer.findUnique({
      where: { id: trade.playerId },
    });
    if (player) {
      await this.prisma.brMatchPlayer.update({
        where: { id: player.id },
        data: {
          totalPnl: toNumber(player.totalPnl) + score.pnl,
          openTrades: Math.max(0, player.openTrades - 1),
          ...(Math.abs(riskPctAdjust) > 1e-9
            ? { totalRiskUsedPct: { increment: riskPctAdjust } }
            : {}),
        },
      });
      const seat = await this.prisma.brMatchPlayer.findUnique({
        where: { id: player.id },
      });
      if (seat && toNumber(seat.totalRiskUsedPct) < 0) {
        await this.prisma.brMatchPlayer.update({
          where: { id: player.id },
          data: { totalRiskUsedPct: 0 },
        });
      }
    }

    const result = this.toTradeDto(updated);
    this.emit(trade.matchId, 'br:trade_update', result);
    this.broadcastMatch(trade.matchId);
    return result;
  }

  private async onPriceTick(
    asset: AssetSymbol,
    tick: { bid: number; ask: number; mid: number; ts: number },
  ) {
    const trades = await this.prisma.brTrade.findMany({
      where: {
        asset,
        status: { in: [TradeStatus.OPEN, TradeStatus.PENDING] },
        match: { status: BrMatchStatus.LIVE },
      },
      include: {
        match: { select: { liveStartedAt: true, status: true } },
      },
    });

    for (const trade of trades) {
      try {
        // No fills / SL-TP during MATCH STARTING intro
        if (!this.isMatchTradingOpen(trade.match)) continue;

        if (trade.status === TradeStatus.PENDING && trade.entryPrice != null) {
          if (
            shouldActivateLimit(
              trade.side as 'LONG' | 'SHORT',
              toNumber(trade.entryPrice),
              tick,
            )
          ) {
            const updated = await this.prisma.brTrade.update({
              where: { id: trade.id },
              data: {
                status: TradeStatus.OPEN,
                openedAt: new Date(),
              },
            });
            await this.prisma.brMatchPlayer.update({
              where: { id: trade.playerId },
              data: { openTrades: { increment: 1 } },
            });
            this.emit(
              trade.matchId,
              'br:trade_update',
              this.toTradeDto(updated),
            );
          }
        } else if (
          trade.status === TradeStatus.OPEN &&
          trade.entryPrice != null
        ) {
          const hit = checkSlTpHit(
            trade.side as 'LONG' | 'SHORT',
            toNumber(trade.stopLoss),
            trade.takeProfit != null ? toNumber(trade.takeProfit) : null,
            tick,
          );
          if (hit) await this.closeTradeAt(trade.id, hit);
        }
      } catch (err) {
        this.logger.warn(`BR price trade ${trade.id}: ${err}`);
      }
    }
  }

  private async broadcastMatch(matchId: string) {
    const match = await this.prisma.brMatch.findUnique({
      where: { id: matchId },
    });
    if (!match) return;
    if (
      match.status === BrMatchStatus.QUEUE ||
      match.status === BrMatchStatus.COUNTDOWN
    ) {
      const pub = await this.toPublicQueue(matchId);
      const queueSnap = await this.toQueueSnapshot(matchId);
      // Lobby-wide (all connected clients on /br)
      this.emitLobby('br:queue_update', pub);
      // Match room (if anyone subscribed)
      this.emit(matchId, 'br:queue', queueSnap);
      // Fan-out to each human in queue so demo counter updates even if
      // the client never joined br:{matchId}
      const humans = await this.prisma.brMatchPlayer.findMany({
        where: {
          matchId,
          isBot: false,
          status: BrPlayerStatus.QUEUED,
        },
        select: { userId: true },
      });
      for (const h of humans) {
        this.emitUser(h.userId, 'br:queue_update', pub);
        this.emitUser(h.userId, 'br:queue', {
          ...queueSnap,
          me: { userId: h.userId, inQueue: true },
        });
      }
    } else {
      this.emit(matchId, 'br:state', await this.toMatchSnapshot(matchId));
    }
  }

  // ─── Demo bots (never real-money) ────────────────────────────────────────

  private async countHumansQueued(matchId: string): Promise<number> {
    return this.prisma.brMatchPlayer.count({
      where: {
        matchId,
        isBot: false,
        status: BrPlayerStatus.QUEUED,
      },
    });
  }

  private async cancelDemoMatchEmpty(matchId: string) {
    await this.prisma.brMatchPlayer.updateMany({
      where: {
        matchId,
        status: BrPlayerStatus.QUEUED,
      },
      data: { status: BrPlayerStatus.LEFT, leftAt: new Date() },
    });
    await this.prisma.brMatch.update({
      where: { id: matchId },
      data: {
        status: BrMatchStatus.CANCELLED,
        playerCount: 0,
        pot: 0,
        platformFee: 0,
        prizePool: 0,
        countdownEndsAt: null,
        countdownStartedAt: null,
      },
    });
    this.demoFillInProgress.delete(matchId);
    this.logger.log(`BR DEMO cancelled (no humans) ${matchId}`);
  }

  /**
   * DEMO ONLY: stagger-fill bots toward BR_DEMO_TARGET_PLAYERS.
   * Safe to call repeatedly — guarded by demoFillInProgress.
   */
  private async scheduleDemoBotFill(matchId: string) {
    if (this.demoFillInProgress.has(matchId)) return;
    this.demoFillInProgress.add(matchId);
    try {
      while (true) {
        const match = await this.prisma.brMatch.findUnique({
          where: { id: matchId },
        });
        if (
          !match ||
          !match.isDemo ||
          (match.status !== BrMatchStatus.QUEUE &&
            match.status !== BrMatchStatus.COUNTDOWN)
        ) {
          break;
        }
        if (match.playerCount >= BR_DEMO_TARGET_PLAYERS) break;
        if (match.playerCount >= BR_MAX_PLAYERS) break;

        const humans = await this.countHumansQueued(matchId);
        if (humans < 1) break;

        const added = await this.addDemoBot(matchId);
        if (!added) break;

        await sleep(
          botJoinDelayMs(BR_DEMO_BOT_JOIN_MS_MIN, BR_DEMO_BOT_JOIN_MS_MAX),
        );
      }
    } catch (err) {
      this.logger.warn(`Demo bot fill ${matchId}: ${err}`);
    } finally {
      this.demoFillInProgress.delete(matchId);
    }
  }

  private async addDemoBot(matchId: string): Promise<boolean> {
    const match = await this.prisma.brMatch.findUnique({
      where: { id: matchId },
    });
    if (
      !match ||
      !match.isDemo ||
      (match.status !== BrMatchStatus.QUEUE &&
        match.status !== BrMatchStatus.COUNTDOWN) ||
      match.playerCount >= BR_DEMO_TARGET_PLAYERS ||
      match.playerCount >= BR_MAX_PLAYERS
    ) {
      return false;
    }

    // Avoid username collisions in this match + globally
    const seated = await this.prisma.brMatchPlayer.findMany({
      where: { matchId },
      select: { username: true, userId: true },
    });
    const usedNames = new Set(seated.map((p) => p.username.toLowerCase()));

    // Prefer idle bot users not currently in a live/queue match
    const busyBotIds = await this.prisma.brMatchPlayer.findMany({
      where: {
        isBot: true,
        status: { in: [BrPlayerStatus.QUEUED, BrPlayerStatus.PLAYING] },
        match: {
          status: {
            in: [
              BrMatchStatus.QUEUE,
              BrMatchStatus.COUNTDOWN,
              BrMatchStatus.LIVE,
              BrMatchStatus.SETTLING,
            ],
          },
        },
      },
      select: { userId: true },
    });
    const busy = new Set(busyBotIds.map((b) => b.userId));

    let botUser = await this.prisma.user.findFirst({
      where: {
        isBot: true,
        isActive: true,
        id: { notIn: [...busy] },
        username: { notIn: [...usedNames] },
      },
    });

    if (!botUser) {
      const username = randomBotUsername(usedNames);
      botUser = await this.prisma.user.create({
        data: {
          email: botEmail(username),
          username,
          displayName: username,
          passwordHash: `bot:${randomBotUsername(new Set())}`, // not login-capable path
          isBot: true,
          isDemoGuest: true,
          isActive: true,
        },
      });
      // Empty wallet so accidental wallet paths no-op safely
      await this.wallet.createForUser(botUser.id).catch(() => undefined);
    }

    // Double-check capacity after await
    const fresh = await this.prisma.brMatch.findUnique({
      where: { id: matchId },
    });
    if (
      !fresh ||
      !fresh.isDemo ||
      fresh.playerCount >= BR_DEMO_TARGET_PLAYERS ||
      fresh.playerCount >= BR_MAX_PLAYERS
    ) {
      return false;
    }

    try {
      await this.prisma.brMatchPlayer.create({
        data: {
          matchId,
          userId: botUser.id,
          username: botUser.username,
          isPremium: false,
          isBot: true,
          usedFreeEntry: false,
          stake: BR_DEMO_STAKE,
          virtualCapital: BR_VIRTUAL_CAPITAL,
          status: BrPlayerStatus.QUEUED,
        },
      });
    } catch {
      // unique collision — skip
      return false;
    }

    const nextCount = fresh.playerCount + 1;
    const pot = brPot(nextCount, BR_DEMO_STAKE);
    let status = fresh.status;
    let countdownEndsAt = fresh.countdownEndsAt;
    let countdownStartedAt = fresh.countdownStartedAt;

    // Humans already present → ensure countdown running once threshold met
    if (status === BrMatchStatus.QUEUE) {
      const humans = await this.countHumansQueued(matchId);
      if (humans >= BR_DEMO_MIN_HUMANS_TO_START) {
        status = BrMatchStatus.COUNTDOWN;
        countdownStartedAt = new Date();
        countdownEndsAt = new Date(
          Date.now() + BR_COUNTDOWN_SECONDS * 1000,
        );
        this.market.retainAsset(fresh.asset);
      }
    }

    // Full lobby (50/50) → snap remaining countdown to 10s if still longer
    const fullSnap = this.snapCountdownIfFull(
      nextCount,
      fresh.maxPlayers ?? BR_MAX_PLAYERS,
      status,
      countdownEndsAt,
      countdownStartedAt,
    );
    status = fullSnap.status;
    countdownEndsAt = fullSnap.countdownEndsAt;
    countdownStartedAt = fullSnap.countdownStartedAt;
    if (fullSnap.snapped) {
      this.market.retainAsset(fresh.asset);
      this.logger.log(
        `BR full lobby snap (bot fill) · match=${matchId} · N=${nextCount} · countdown→${BR_FULL_LOBBY_COUNTDOWN_SECONDS}s`,
      );
    }

    await this.prisma.brMatch.update({
      where: { id: matchId },
      data: {
        playerCount: nextCount,
        pot,
        platformFee: brPlatformFee(pot),
        prizePool: brPrizePool(pot),
        status,
        countdownEndsAt,
        countdownStartedAt,
      },
    });

    this.broadcastMatch(matchId);
    return true;
  }

  /**
   * When seats hit max: if countdown remaining > FULL_LOBBY seconds, snap to that.
   * Does not restart from 60. If already ≤ snap window, no-op.
   * Only applies once effectively (second call with remaining ≤ 10 is a no-op).
   */
  private snapCountdownIfFull(
    playerCount: number,
    maxPlayers: number,
    status: BrMatchStatus,
    countdownEndsAt: Date | null,
    countdownStartedAt: Date | null,
  ): {
    status: BrMatchStatus;
    countdownEndsAt: Date | null;
    countdownStartedAt: Date | null;
    snapped: boolean;
  } {
    if (playerCount < maxPlayers) {
      return { status, countdownEndsAt, countdownStartedAt, snapped: false };
    }
    if (
      status !== BrMatchStatus.QUEUE &&
      status !== BrMatchStatus.COUNTDOWN
    ) {
      return { status, countdownEndsAt, countdownStartedAt, snapped: false };
    }

    const snapMs = BR_FULL_LOBBY_COUNTDOWN_SECONDS * 1000;
    const now = Date.now();

    // Not in countdown yet (edge: filled without countdown) → start short countdown
    if (status === BrMatchStatus.QUEUE || !countdownEndsAt) {
      return {
        status: BrMatchStatus.COUNTDOWN,
        countdownStartedAt: countdownStartedAt ?? new Date(now),
        countdownEndsAt: new Date(now + snapMs),
        snapped: true,
      };
    }

    const remaining = countdownEndsAt.getTime() - now;
    if (remaining <= snapMs) {
      return { status, countdownEndsAt, countdownStartedAt, snapped: false };
    }

    return {
      status: BrMatchStatus.COUNTDOWN,
      countdownStartedAt: countdownStartedAt ?? new Date(now),
      countdownEndsAt: new Date(now + snapMs),
      snapped: true,
    };
  }

  /**
   * DEMO ONLY: open/close bot trades on LIVE matches so ranking moves.
   * Uses same openTrade / closeTradeAt paths; no wallet effects (isDemo).
   */
  private async tickDemoBotTrades(matchId: string) {
    const match = await this.prisma.brMatch.findUnique({
      where: { id: matchId },
    });
    if (!match?.isDemo || match.status !== BrMatchStatus.LIVE) return;
    if (!match.liveStartedAt || !match.liveEndsAt) return;
    // No bot trading during MATCH STARTING intro
    if (!this.isMatchTradingOpen(match)) return;

    const now = Date.now();
    const start = match.liveStartedAt.getTime();
    const end = match.liveEndsAt.getTime();
    const duration = Math.max(1, end - start);
    const progress = Math.min(1, Math.max(0, (now - start) / duration));

    const bots = await this.prisma.brMatchPlayer.findMany({
      where: {
        matchId,
        isBot: true,
        status: BrPlayerStatus.PLAYING,
      },
    });

    for (const bot of bots) {
      const persona = botPersonality(matchId, bot.userId);
      const botPnl = toNumber(bot.totalPnl);

      // Soft stop: bot already hit skill cap — no more opens (still may manage open)
      const atCap = botPnl >= persona.maxPnl - 1e-9;

      // Early-close open trades (weak bots chop out; winners less so)
      if (bot.openTrades > 0) {
        if (Math.random() < persona.earlyCloseChance) {
          const open = await this.prisma.brTrade.findFirst({
            where: {
              playerId: bot.id,
              status: TradeStatus.OPEN,
            },
          });
          if (open) {
            try {
              await this.closeTradeAt(open.id, 'MARKET');
              await this.clampDemoBotPnl(bot.id, persona.minPnl, persona.maxPnl);
            } catch {
              /* ignore */
            }
          }
        }
      }

      if (atCap) continue;
      if (bot.tradeCount >= BR_MAX_TRADES) continue;
      if (bot.tradeCount >= persona.plannedTrades) continue;
      if (persona.plannedTrades === 0) continue;

      const nextIdx = bot.tradeCount;
      const openAt = persona.openAt[nextIdx] ?? 1;
      if (progress + 0.02 < openAt) continue;

      // Stagger opens — weak bots more hesitant
      const openChance =
        persona.tier === 'small_win' || persona.tier === 'medium_win'
          ? 0.28
          : 0.18;
      if (Math.random() > openChance) continue;

      const remainingRisk =
        BR_MAX_RISK_PCT - toNumber(bot.totalRiskUsedPct);
      // Cap bot risk well under human max so winners stay modest
      const botRiskCap =
        persona.tier === 'medium_win'
          ? 1.0
          : persona.tier === 'small_win'
            ? 0.7
            : 0.95;
      if (remainingRisk < 0.2) continue;

      const riskPct = Math.min(persona.riskPct, remainingRisk, botRiskCap);
      if (riskPct <= 0) continue;

      try {
        const asset = match.asset as AssetSymbol;
        const tick = this.market.getTick(asset);
        if (!tick?.mid || tick.mid <= 0) continue;

        const side: 'LONG' | 'SHORT' =
          Math.random() < persona.longBias ? 'LONG' : 'SHORT';
        const entry = marketEntryPrice(side, tick);
        const slDist = Math.max(entry * persona.slFrac, entry * 0.0004);
        const stopLoss =
          side === 'LONG' ? entry - slDist : entry + slDist;
        let takeProfit: number | null = null;
        if (Math.random() < persona.tpChance) {
          takeProfit =
            side === 'LONG'
              ? entry + slDist * persona.tpMult
              : entry - slDist * persona.tpMult;
        }

        await this.openTrade(matchId, bot.userId, {
          side,
          orderType: 'MARKET',
          stopLoss,
          takeProfit,
          riskPct,
        });
      } catch (err) {
        this.logger.debug?.(
          `Bot trade skip ${bot.username}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  /** Keep demo bot cumulative PnL inside skill band (believable, beatable) */
  private async clampDemoBotPnl(
    playerId: string,
    minPnl: number,
    maxPnl: number,
  ) {
    const p = await this.prisma.brMatchPlayer.findUnique({
      where: { id: playerId },
    });
    if (!p?.isBot) return;
    let pnl = toNumber(p.totalPnl);
    const capMax = Math.min(maxPnl, BR_DEMO_BOT_MAX_PNL);
    const capMin = Math.max(minPnl, BR_DEMO_BOT_MIN_PNL);
    if (pnl > capMax) pnl = capMax;
    if (pnl < capMin) pnl = capMin;
    if (Math.abs(pnl - toNumber(p.totalPnl)) < 1e-9) return;
    await this.prisma.brMatchPlayer.update({
      where: { id: playerId },
      data: { totalPnl: pnl },
    });
  }

  /**
   * Before ranking in demo settlement, softly reshape bot PnLs so most are
   * flat/red and winners stay modest — humans keep a real shot at Top 10.
   */
  private async reshapeDemoBotPnls(matchId: string) {
    const bots = await this.prisma.brMatchPlayer.findMany({
      where: {
        matchId,
        isBot: true,
        status: {
          in: [BrPlayerStatus.PLAYING, BrPlayerStatus.SETTLED],
        },
      },
    });
    for (const bot of bots) {
      const persona = botPersonality(matchId, bot.userId);
      let pnl = toNumber(bot.totalPnl);
      const rng = Math.random();

      // Idle / no trades → near flat noise
      if (bot.tradeCount === 0 || persona.tier === 'idle') {
        pnl = (rng - 0.5) * 12;
      } else if (persona.tier === 'weak') {
        // Bias flat/slight red
        if (pnl > 40) pnl = 15 + rng * 25;
        if (pnl > 0 && rng < 0.55) pnl = -rng * 35;
      } else if (persona.tier === 'loser') {
        if (pnl > 0) pnl = -20 - rng * 100;
        if (pnl > -5) pnl = -15 - rng * 80;
      } else if (persona.tier === 'small_win') {
        if (pnl < 0 && rng < 0.65) pnl = 12 + rng * 45;
        if (pnl > 85) pnl = 50 + rng * 35;
      } else if (persona.tier === 'medium_win') {
        if (pnl < 10) pnl = 40 + rng * 55;
        if (pnl > BR_DEMO_BOT_MAX_PNL) pnl = 70 + rng * 50;
      }

      pnl = Math.min(BR_DEMO_BOT_MAX_PNL, Math.max(BR_DEMO_BOT_MIN_PNL, pnl));
      pnl = Math.min(persona.maxPnl, Math.max(persona.minPnl, pnl));
      pnl = Math.round(pnl * 100) / 100;

      if (Math.abs(pnl - toNumber(bot.totalPnl)) >= 0.01) {
        await this.prisma.brMatchPlayer.update({
          where: { id: bot.id },
          data: { totalPnl: pnl },
        });
      }
    }
  }

  // ─── DTOs ────────────────────────────────────────────────────────────────

  /** Desplaza un free de la cola (prioridad Premium) */
  private async forceLeaveQueuePlayer(
    playerId: string,
    userId: string,
    matchId: string,
    stake: number,
    usedFreeEntry = false,
    freeEntryCreditId?: string | null,
  ) {
    if (!usedFreeEntry) {
      await this.wallet.unlockFunds(
        userId,
        stake,
        WalletTxType.BR_REFUND,
        `BR prioridad Premium · reembolso $${stake}`,
      );
    } else if (freeEntryCreditId) {
      await this.referrals.restoreCredit(freeEntryCreditId, userId);
    } else {
      await this.prisma.premiumFreeEntryUse.deleteMany({
        where: { playerId },
      });
    }
    await this.prisma.brMatchPlayer.update({
      where: { id: playerId },
      data: { status: BrPlayerStatus.LEFT, leftAt: new Date() },
    });
    const match = await this.prisma.brMatch.findUniqueOrThrow({
      where: { id: matchId },
    });
    const nextCount = Math.max(0, match.playerCount - 1);
    const pot = brPot(nextCount, toNumber(match.stake));
    await this.prisma.brMatch.update({
      where: { id: matchId },
      data: {
        playerCount: nextCount,
        pot,
        platformFee: brPlatformFee(pot),
        prizePool: brPrizePool(pot),
      },
    });
  }

  /** Estado de la entrada gratis semanal (UTC) + referral free-entry credits */
  async getFreeEntryStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { isPremium: true },
    });
    const overview = await this.referrals.getOverview(userId);
    const credits = {
      availableByStake: overview.availableByStake,
      availableCredits: overview.availableCredits,
    };

    if (!user.isPremium) {
      return {
        isPremium: false,
        available: false,
        stakeOnly: BR_FREE_ENTRY_STAKE,
        weekKey: utcIsoWeekKey(),
        usedAt: null as string | null,
        daysUntilNext: daysUntilNextUtcWeek(),
        nextAvailableAt: nextUtcWeekStart().toISOString(),
        timezone: 'UTC',
        credits,
      };
    }
    const weekKey = utcIsoWeekKey();
    const used = await this.prisma.premiumFreeEntryUse.findUnique({
      where: { userId_weekKey: { userId, weekKey } },
    });
    return {
      isPremium: true,
      available: !used,
      stakeOnly: BR_FREE_ENTRY_STAKE,
      weekKey,
      usedAt: used?.usedAt?.toISOString() ?? null,
      daysUntilNext: used ? daysUntilNextUtcWeek() : 0,
      nextAvailableAt: used ? nextUtcWeekStart().toISOString() : null,
      timezone: 'UTC',
      credits,
    };
  }

  async toPublicQueue(matchId: string) {
    const match = await this.prisma.brMatch.findUniqueOrThrow({
      where: { id: matchId },
      include: {
        players: {
          where: { status: BrPlayerStatus.QUEUED },
          // Premium primero, luego orden de llegada
          orderBy: [{ isPremium: 'desc' }, { joinedAt: 'asc' }],
          select: {
            username: true,
            joinedAt: true,
            isPremium: true,
            isBot: true,
          },
        },
      },
    });
    const premiumCount = match.players.filter((p) => p.isPremium).length;
    const stake = toNumber(match.stake);
    const prizeStructure = this.prizeStructureDto(
      match.playerCount,
      stake,
      match.isDemo,
    );
    return {
      matchId: match.id,
      status: match.status,
      asset: match.asset,
      stake,
      isDemo: match.isDemo,
      demoBotsEnabled: match.isDemo,
      playerCount: match.playerCount,
      maxPlayers: match.maxPlayers,
      minPlayers: match.minPlayers,
      pot: toNumber(match.pot),
      prizePool: toNumber(match.prizePool),
      countdownEndsAt: match.countdownEndsAt?.toISOString() ?? null,
      premiumCount,
      prizeStructure,
      players: match.players.map((p) => ({
        username: p.username,
        joinedAt: p.joinedAt.toISOString(),
        isPremium: p.isPremium,
        isBot: p.isBot,
      })),
    };
  }

  private prizeStructureDto(
    playerCount: number,
    stake: number,
    isDemo?: boolean,
  ) {
    const structure = getBrPrizeStructure(
      playerCount,
      brEffectiveStake(stake, isDemo),
    );
    return {
      playerCount: structure.playerCount,
      stake: structure.stake,
      pot: structure.pot,
      platformFee: structure.platformFee,
      prizePool: structure.prizePool,
      strongCount: structure.strongCount,
      refundFrom: structure.refundFrom,
      refundTo: structure.refundTo,
      refundSlots: structure.refundSlots,
      refundReserve: structure.refundReserve,
      strongPool: structure.strongPool,
      footer: structure.footer,
      prizeLine: structure.prizeLine,
      refundLine: structure.refundLine,
      payouts: structure.payouts.map((p) => ({
        rank: p.rank,
        kind: p.kind,
        amount: p.amount,
      })),
    };
  }

  async toQueueSnapshot(matchId: string, userId?: string) {
    const pub = await this.toPublicQueue(matchId);
    let mePremium = false;
    if (userId) {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isPremium: true },
      });
      mePremium = u?.isPremium ?? false;
    }
    return {
      phase: 'queue' as const,
      ...pub,
      me: userId
        ? { userId, inQueue: true, isPremium: mePremium }
        : null,
      priorityNote: mePremium
        ? 'Prioridad Premium: entrás preferente si la cola se llena'
        : 'Pasate a Premium para prioridad en cola y chat',
    };
  }

  async toMatchSnapshot(matchId: string, userId?: string) {
    const match = await this.prisma.brMatch.findUniqueOrThrow({
      where: { id: matchId },
      include: {
        players: {
          where: {
            status: {
              in: [
                BrPlayerStatus.PLAYING,
                BrPlayerStatus.SETTLED,
                BrPlayerStatus.QUEUED,
              ],
            },
          },
        },
        trades: userId
          ? { where: { userId }, orderBy: { createdAt: 'asc' } }
          : false,
      },
    });

    const ranked = rankBrPlayers(
      match.players.map((p) => ({
        userId: p.userId,
        username: p.username,
        isPremium: p.isPremium,
        isBot: p.isBot,
        totalPnl: toNumber(p.totalPnl),
        tradeCount: p.tradeCount,
        openTrades: p.openTrades,
        totalRiskUsedPct: toNumber(p.totalRiskUsedPct),
        rank: p.rank,
        prizeAmount: p.prizeAmount != null ? toNumber(p.prizeAmount) : null,
        joinedAt: p.joinedAt,
        status: p.status,
      })),
    );

    const stakeNum = toNumber(match.stake);
    const prizeStructure = this.prizeStructureDto(
      match.playerCount,
      stakeNum,
      match.isDemo,
    );
    const structure: BrPrizeStructure = getBrPrizeStructure(
      match.playerCount,
      brEffectiveStake(stakeNum, match.isDemo),
    );

    const leaderboard = ranked.map((p, i) => {
      const rank = p.rank ?? i + 1;
      const zone = zoneForRank(rank, structure);
      const payout = payoutForRank(rank, structure);
      return {
        rank,
        userId: p.userId,
        username: p.username,
        isPremium: p.isPremium ?? false,
        isBot: p.isBot ?? false,
        totalPnl: p.totalPnl,
        tradeCount: p.tradeCount,
        openTrades: p.openTrades,
        prizeAmount:
          p.prizeAmount != null
            ? p.prizeAmount
            : payout && match.status === 'COMPLETED'
              ? payout.amount
              : null,
        zone,
        isMe: userId ? p.userId === userId : false,
      };
    });

    const me = userId
      ? leaderboard.find((p) => p.userId === userId) ?? null
      : null;

    const myPlayer = userId
      ? match.players.find((p) => p.userId === userId)
      : null;

    const trades =
      userId && Array.isArray(match.trades)
        ? match.trades.map((t) => this.toTradeDto(t))
        : [];

    return {
      phase: 'match' as const,
      matchId: match.id,
      status: match.status,
      asset: match.asset,
      stake: stakeNum,
      isDemo: match.isDemo,
      demoBotsEnabled: match.isDemo,
      playerCount: match.playerCount,
      maxPlayers: match.maxPlayers,
      pot: toNumber(match.pot),
      platformFee: toNumber(match.platformFee),
      prizePool: toNumber(match.prizePool),
      prizeStructure,
      liveStartedAt: match.liveStartedAt?.toISOString() ?? null,
      liveEndsAt: match.liveEndsAt?.toISOString() ?? null,
      settledAt: match.settledAt?.toISOString() ?? null,
      countdownEndsAt: match.countdownEndsAt?.toISOString() ?? null,
      leaderboard,
      me,
      myStats: myPlayer
        ? {
            virtualCapital: toNumber(myPlayer.virtualCapital),
            totalRiskUsedPct: toNumber(myPlayer.totalRiskUsedPct),
            tradeCount: myPlayer.tradeCount,
            maxTrades: BR_MAX_TRADES,
            maxRiskPct: BR_MAX_RISK_PCT,
            openTrades: myPlayer.openTrades,
          }
        : null,
      trades,
    };
  }

  private toTradeDto(t: {
    id: string;
    matchId: string;
    userId: string;
    asset: string;
    side: string;
    orderType: string;
    status: string;
    entryPrice: { toNumber?: () => number } | number | null;
    exitPrice: { toNumber?: () => number } | number | null;
    stopLoss: { toNumber?: () => number } | number;
    takeProfit: { toNumber?: () => number } | number | null;
    riskPct: { toNumber?: () => number } | number;
    riskAmount: { toNumber?: () => number } | number;
    originalStopLoss?: { toNumber?: () => number } | number | null;
    positionSize?: { toNumber?: () => number } | number | null;
    reservedRiskAmount?: { toNumber?: () => number } | number | null;
    rMultiple: { toNumber?: () => number } | number | null;
    pnl: { toNumber?: () => number } | number | null;
    closeReason?: string | null;
    openedAt: Date | null;
    closedAt: Date | null;
  }) {
    const num = (v: unknown): number | null => {
      if (v == null) return null;
      if (typeof v === 'number') return v;
      if (typeof v === 'object' && v !== null && 'toNumber' in v) {
        return (v as { toNumber: () => number }).toNumber();
      }
      return Number(v);
    };
    const riskAmount = num(t.riskAmount) ?? 0;
    const stopLoss = num(t.stopLoss) ?? 0;
    const entry = num(t.entryPrice);
    let originalStopLoss = num(t.originalStopLoss) ?? 0;
    if (!(originalStopLoss > 0)) originalStopLoss = stopLoss;
    let positionSize = num(t.positionSize) ?? 0;
    if (!(positionSize > 0) && entry != null && entry > 0 && originalStopLoss > 0) {
      const d = Math.abs(entry - originalStopLoss);
      positionSize = d > 0 ? riskAmount / d : 0;
    }
    let reservedRiskAmount = num(t.reservedRiskAmount) ?? 0;
    if (!(reservedRiskAmount > 0)) reservedRiskAmount = riskAmount;

    return {
      id: t.id,
      matchId: t.matchId,
      userId: t.userId,
      asset: t.asset,
      side: t.side,
      orderType: t.orderType,
      status: t.status,
      entryPrice: entry,
      exitPrice: num(t.exitPrice),
      stopLoss,
      takeProfit: num(t.takeProfit),
      riskPct: num(t.riskPct) ?? 0,
      /** Frozen original risk $ at open (1R reference) */
      riskAmount,
      originalStopLoss,
      positionSize,
      reservedRiskAmount,
      rMultiple: num(t.rMultiple),
      pnl: num(t.pnl),
      closeReason: t.closeReason ?? null,
      openedAt: t.openedAt?.toISOString() ?? null,
      closedAt: t.closedAt?.toISOString() ?? null,
    };
  }
}

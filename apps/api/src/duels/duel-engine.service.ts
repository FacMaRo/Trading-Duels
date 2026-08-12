import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  DuelStatus,
  OrderType,
  RaiseStatus,
  TradeStatus,
} from '@prisma/client';
import {
  calcNewElo,
  calcPlatformFee,
  calcRiskAmount,
  calcWinnerPrize,
  canTransition,
  checkSlTpHit,
  exitPriceForClose,
  getModeConfig,
  isPhaseExpired,
  marketEntryPrice,
  scoreClosedTrade,
  scoreExpiredLimit,
  settleDuel,
  shouldActivateLimit,
  validateMarketSlTp,
  validateRaiseProposal,
  validateTradeOpen,
  type AssetSymbol,
  type DuelModeKey,
  type TradeInput,
  type TradeResult,
} from '@trading-duels/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { UsersService } from '../users/users.service';
import { MarketService } from '../market/market.service';
import { MissionsService } from '../missions/missions.service';
import { SpectatorBetsService } from '../spectator/spectator-bets.service';
import { toNumber } from '../common/utils/decimal';

type StateEmitter = (duelId: string, event: string, payload: unknown) => void;

@Injectable()
export class DuelEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuelEngineService.name);
  private phaseTimers = new Map<string, NodeJS.Timeout[]>();
  private raiseTimers = new Map<string, NodeJS.Timeout>();
  private priceUnsub: (() => void) | null = null;
  private emitter: StateEmitter | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly users: UsersService,
    private readonly market: MarketService,
    private readonly missions: MissionsService,
    private readonly spectatorBets: SpectatorBetsService,
  ) {}

  /** El gateway registra el emisor de eventos socket */
  setEmitter(fn: StateEmitter) {
    this.emitter = fn;
  }

  private emit(duelId: string, event: string, payload: unknown) {
    this.emitter?.(duelId, event, payload);
  }

  onModuleInit() {
    this.priceUnsub = this.market.subscribe((asset, tick) => {
      void this.onPriceTick(asset, tick);
    });
    // Recuperar duelos activos tras restart
    void this.recoverActiveDuels();
  }

  onModuleDestroy() {
    this.priceUnsub?.();
    for (const timers of this.phaseTimers.values()) {
      timers.forEach(clearTimeout);
    }
    for (const t of this.raiseTimers.values()) clearTimeout(t);
  }

  private async recoverActiveDuels() {
    const active = await this.prisma.duel.findMany({
      where: {
        status: {
          in: [DuelStatus.PREPARATION, DuelStatus.DEVELOPMENT, DuelStatus.MATCHED],
        },
      },
      include: { trades: true },
    });
    for (const d of active) {
      this.scheduleDuel(d.id);
      // Re-retain market feeds de trades abiertos
      for (const t of d.trades) {
        if (t.status === TradeStatus.OPEN || t.status === TradeStatus.PENDING) {
          this.market.retainAsset(t.asset);
        }
      }
    }
    this.logger.log(`Recuperados ${active.length} duelos activos`);
  }

  scheduleDuel(duelId: string) {
    this.clearPhaseTimers(duelId);

    void this.prisma.duel.findUnique({ where: { id: duelId } }).then((duel) => {
      if (!duel) return;
      const timers: NodeJS.Timeout[] = [];

      if (duel.status === DuelStatus.PREPARATION && duel.prepEndsAt) {
        const ms = duel.prepEndsAt.getTime() - Date.now();
        if (ms <= 0) {
          void this.transitionToDevelopment(duelId);
        } else {
          timers.push(
            setTimeout(() => void this.transitionToDevelopment(duelId), ms),
          );
        }
      }

      if (
        (duel.status === DuelStatus.PREPARATION ||
          duel.status === DuelStatus.DEVELOPMENT) &&
        duel.developEndsAt
      ) {
        const ms = duel.developEndsAt.getTime() - Date.now();
        if (ms <= 0 && duel.status === DuelStatus.DEVELOPMENT) {
          void this.transitionToSettling(duelId);
        } else if (ms > 0) {
          timers.push(
            setTimeout(() => {
              void this.prisma.duel
                .findUnique({ where: { id: duelId } })
                .then((d) => {
                  if (d?.status === DuelStatus.DEVELOPMENT) {
                    void this.transitionToSettling(duelId);
                  }
                });
            }, ms),
          );
        }
      }

      if (duel.status === DuelStatus.MATCHED) {
        // Auto-start prep a los 30s si no se hace ready
        timers.push(
          setTimeout(() => {
            void this.prisma.duel
              .findUnique({ where: { id: duelId } })
              .then((d) => {
                if (d?.status === DuelStatus.MATCHED) {
                  void this.autoStartPrep(duelId);
                }
              });
          }, 30_000),
        );
      }

      this.phaseTimers.set(duelId, timers);
    });
  }

  private clearPhaseTimers(duelId: string) {
    const timers = this.phaseTimers.get(duelId);
    if (timers) timers.forEach(clearTimeout);
    this.phaseTimers.delete(duelId);
  }

  private async autoStartPrep(duelId: string) {
    const timers = createPrepTimersFromMode(duelId);
    const duel = await this.prisma.duel.findUnique({ where: { id: duelId } });
    if (!duel || duel.status !== DuelStatus.MATCHED) return;

    const modeCfg = getModeConfig(duel.mode as DuelModeKey);
    const now = new Date();
    const prepEndsAt = new Date(now.getTime() + modeCfg.prepSeconds * 1000);
    const developEndsAt = new Date(
      prepEndsAt.getTime() + modeCfg.developSeconds * 1000,
    );

    const updated = await this.prisma.duel.update({
      where: { id: duelId },
      data: {
        status: DuelStatus.PREPARATION,
        playerAReady: true,
        playerBReady: true,
        prepStartedAt: now,
        prepEndsAt,
        developEndsAt,
      },
    });

    this.emit(duelId, 'duel:phase', {
      duelId,
      status: updated.status,
      phaseEndsAt: prepEndsAt.toISOString(),
    });
    this.scheduleDuel(duelId);
    void timers;
  }

  async transitionToDevelopment(duelId: string) {
    const duel = await this.prisma.duel.findUnique({ where: { id: duelId } });
    if (!duel || duel.status !== DuelStatus.PREPARATION) return;
    if (!canTransition('PREPARATION', 'DEVELOPMENT')) return;

    const now = new Date();
    // developEndsAt ya estaba calculado desde el inicio
    let developEndsAt = duel.developEndsAt;
    if (!developEndsAt || developEndsAt <= now) {
      const cfg = getModeConfig(duel.mode as DuelModeKey);
      developEndsAt = new Date(now.getTime() + cfg.developSeconds * 1000);
    }

    const updated = await this.prisma.duel.update({
      where: { id: duelId },
      data: {
        status: DuelStatus.DEVELOPMENT,
        developStartedAt: now,
        developEndsAt,
      },
    });

    this.logger.log(`Duel ${duelId} → DEVELOPMENT`);
    this.emit(duelId, 'duel:phase', {
      duelId,
      status: updated.status,
      phaseEndsAt: developEndsAt.toISOString(),
    });
    this.scheduleDuel(duelId);
  }

  async transitionToSettling(duelId: string) {
    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: { trades: true },
    });
    if (!duel || duel.status !== DuelStatus.DEVELOPMENT) return;

    await this.prisma.duel.update({
      where: { id: duelId },
      data: { status: DuelStatus.SETTLING },
    });
    this.emit(duelId, 'duel:phase', {
      duelId,
      status: 'SETTLING',
      phaseEndsAt: null,
    });

    // Cerrar todas las abiertas a mercado; expirar limits pendientes
    for (const trade of duel.trades) {
      if (trade.status === TradeStatus.OPEN) {
        await this.closeTradeAtMarket(trade.id, 'TIME');
      } else if (trade.status === TradeStatus.PENDING) {
        await this.expireLimit(trade.id);
      }
    }

    await this.finalizeSettlement(duelId);
  }

  private async finalizeSettlement(duelId: string) {
    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: { trades: true, playerA: true, playerB: true },
    });
    if (!duel || !duel.playerBId) return;

    const tradesA = duel.trades.filter((t) => t.userId === duel.playerAId);
    const tradesB = duel.trades.filter((t) => t.userId === duel.playerBId);

    const mapTrade = (t: (typeof tradesA)[0]) => ({
      rMultiple: t.rMultiple != null ? toNumber(t.rMultiple) : null,
      pnl: t.pnl != null ? toNumber(t.pnl) : null,
      status: t.status as TradeStatus,
    });

    const result = settleDuel({
      playerAId: duel.playerAId,
      playerBId: duel.playerBId,
      stakeA: toNumber(duel.stakeA),
      stakeB: toNumber(duel.stakeB),
      tradesA: tradesA.map(mapTrade),
      tradesB: tradesB.map(mapTrade),
    });

    const finalStatus = result.isDraw ? DuelStatus.DRAW : DuelStatus.COMPLETED;

    await this.prisma.duel.update({
      where: { id: duelId },
      data: {
        status: finalStatus,
        winnerId: result.winnerId,
        totalRA: result.playerA.totalR,
        totalRB: result.playerB.totalR,
        totalPnlA: result.playerA.totalPnl,
        totalPnlB: result.playerB.totalPnl,
        pot: result.pot,
        platformFee: result.platformFee,
        winnerPrize: result.winnerPrize,
        settledAt: new Date(),
        completedAt: new Date(),
      },
    });

    await this.wallet.settleDuelPayout({
      winnerId: result.winnerId,
      playerAId: duel.playerAId,
      playerBId: duel.playerBId,
      stakeA: toNumber(duel.stakeA),
      stakeB: toNumber(duel.stakeB),
      winnerPrize: result.winnerPrize,
      platformFee: result.platformFee,
      duelId,
      isDraw: result.isDraw,
    });

    // ELO
    const scoreA: 0 | 0.5 | 1 = result.isDraw
      ? 0.5
      : result.winnerId === duel.playerAId
        ? 1
        : 0;
    const eloA = duel.eloA ?? duel.playerA.elo;
    const eloB = duel.eloB ?? (duel.playerB?.elo ?? 1000);
    const { eloA: newEloA, eloB: newEloB } = calcNewElo(eloA, eloB, scoreA);
    await this.users.updateEloStats({
      winnerId: result.winnerId,
      playerAId: duel.playerAId,
      playerBId: duel.playerBId,
      eloA,
      eloB,
      newEloA,
      newEloB,
      isDraw: result.isDraw,
    });

    // Misiones: pozo (10% fee) + progreso de victorias
    await this.missions.onDuelSettled({
      duelId,
      winnerId: result.winnerId,
      playerAId: duel.playerAId,
      playerBId: duel.playerBId,
      stakeA: toNumber(duel.stakeA),
      stakeB: toNumber(duel.stakeB),
      platformFee: result.platformFee,
      isDraw: result.isDraw,
    });

    // Apuestas P2P de espectadores
    await this.spectatorBets.settleForDuel({
      duelId,
      duelWinnerId: result.winnerId,
      isDraw: result.isDraw,
    });

    this.clearPhaseTimers(duelId);
    this.logger.log(
      `Duel ${duelId} settled. Winner=${result.winnerId ?? 'DRAW'} R=${result.playerA.totalR}/${result.playerB.totalR}`,
    );

    this.emit(duelId, 'duel:finished', {
      duelId,
      winnerId: result.winnerId,
      playerA: {
        totalR: result.playerA.totalR,
        totalPnl: result.playerA.totalPnl,
      },
      playerB: {
        totalR: result.playerB.totalR,
        totalPnl: result.playerB.totalPnl,
      },
      pot: result.pot,
      platformFee: result.platformFee,
      winnerPrize: result.winnerPrize,
    });
  }

  // ─── Trades ──────────────────────────────────────────────────────────────

  async openTrade(duelId: string, userId: string, input: TradeInput) {
    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: { trades: true },
    });
    if (!duel) throw new BadRequestException('Duelo no encontrado');
    if (duel.playerAId !== userId && duel.playerBId !== userId) {
      throw new ForbiddenException('No eres participante');
    }

    const myTrades = duel.trades.filter(
      (t) => t.userId === userId && t.status !== TradeStatus.CANCELLED,
    );
    const totalRiskUsedPct = myTrades.reduce(
      (s, t) => s + toNumber(t.riskPct),
      0,
    );

    const validation = validateTradeOpen(
      duel.mode as DuelModeKey,
      duel.status as Parameters<typeof validateTradeOpen>[1],
      {
        tradeCount: myTrades.length,
        totalRiskUsedPct,
        openTradeIds: myTrades
          .filter((t) => t.status === 'OPEN' || t.status === 'PENDING')
          .map((t) => t.id),
      },
      input,
    );

    if (!validation.ok) {
      throw new BadRequestException(validation.message);
    }

    const riskAmount = calcRiskAmount(input.riskPct);
    let status: TradeStatus = TradeStatus.PENDING;
    let entryPrice: number | null = null;
    let openedAt: Date | null = null;

    // Desafío abierto / duelo con activo fijo
    if (duel.primaryAsset && input.asset !== duel.primaryAsset) {
      throw new BadRequestException(
        `Este duelo solo permite operar ${duel.primaryAsset}`,
      );
    }

    if (input.orderType === 'MARKET') {
      const tick = this.market.getTick(input.asset);
      entryPrice = marketEntryPrice(input.side, tick);
      const slTp = validateMarketSlTp(
        input.side,
        entryPrice,
        input.stopLoss,
        input.takeProfit,
      );
      if (!slTp.ok) throw new BadRequestException(slTp.message);
      status = TradeStatus.OPEN;
      openedAt = new Date();
    } else {
      entryPrice = input.entryPrice ?? null;
    }

    const trade = await this.prisma.trade.create({
      data: {
        duelId,
        userId,
        asset: input.asset,
        side: input.side,
        orderType: input.orderType as OrderType,
        status,
        entryPrice,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit ?? null,
        riskPct: input.riskPct,
        riskAmount,
        openedAt,
      },
    });

    // Mantener feed real del activo mientras el trade esté vivo
    this.market.retainAsset(input.asset);

    const result = this.toTradeResult(trade);
    this.emit(duelId, 'duel:trade', result);
    return result;
  }

  async closeTradeManual(duelId: string, userId: string, tradeId: string) {
    const trade = await this.prisma.trade.findFirst({
      where: { id: tradeId, duelId, userId },
    });
    if (!trade) throw new BadRequestException('Trade no encontrado');
    if (trade.status !== TradeStatus.OPEN) {
      throw new BadRequestException('Solo se pueden cerrar trades abiertos');
    }
    return this.closeTradeAtMarket(tradeId, 'MARKET');
  }

  async cancelPendingTrade(duelId: string, userId: string, tradeId: string) {
    const trade = await this.prisma.trade.findFirst({
      where: { id: tradeId, duelId, userId },
    });
    if (!trade) throw new BadRequestException('Trade no encontrado');
    if (trade.status !== TradeStatus.PENDING) {
      throw new BadRequestException('Solo se pueden cancelar limits pendientes');
    }

    const updated = await this.prisma.trade.update({
      where: { id: tradeId },
      data: { status: TradeStatus.CANCELLED, closedAt: new Date() },
    });
    this.market.releaseAsset(trade.asset);
    const result = this.toTradeResult(updated);
    this.emit(duelId, 'duel:trade_update', result);
    return result;
  }

  private async closeTradeAtMarket(
    tradeId: string,
    reason: 'MARKET' | 'TIME' | 'SL' | 'TP',
  ) {
    const trade = await this.prisma.trade.findUnique({ where: { id: tradeId } });
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

    const score = scoreClosedTrade({
      side: trade.side as 'LONG' | 'SHORT',
      entryPrice: toNumber(trade.entryPrice),
      exitPrice: exit,
      stopLoss: toNumber(trade.stopLoss),
      riskAmount: toNumber(trade.riskAmount),
    });

    const updated = await this.prisma.trade.update({
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

    this.market.releaseAsset(trade.asset);

    const result = this.toTradeResult(updated);
    this.emit(trade.duelId, 'duel:trade_update', result);
    return result;
  }

  private async expireLimit(tradeId: string) {
    const score = scoreExpiredLimit();
    const trade = await this.prisma.trade.findUnique({ where: { id: tradeId } });
    const updated = await this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        status: TradeStatus.EXPIRED,
        rMultiple: score.rMultiple,
        pnl: score.pnl,
        closeReason: 'EXPIRED',
        closedAt: new Date(),
      },
    });
    if (trade?.asset) this.market.releaseAsset(trade.asset);
    const result = this.toTradeResult(updated);
    this.emit(updated.duelId, 'duel:trade_update', result);
    return result;
  }

  private async onPriceTick(
    asset: AssetSymbol,
    tick: { bid: number; ask: number; mid: number; ts: number },
  ) {
    const openOrPending = await this.prisma.trade.findMany({
      where: {
        asset,
        status: { in: [TradeStatus.OPEN, TradeStatus.PENDING] },
        duel: {
          status: { in: [DuelStatus.PREPARATION, DuelStatus.DEVELOPMENT] },
        },
      },
    });

    for (const trade of openOrPending) {
      try {
        if (trade.status === TradeStatus.PENDING && trade.entryPrice != null) {
          if (
            shouldActivateLimit(
              trade.side as 'LONG' | 'SHORT',
              toNumber(trade.entryPrice),
              tick,
            )
          ) {
            const updated = await this.prisma.trade.update({
              where: { id: trade.id },
              data: {
                status: TradeStatus.OPEN,
                openedAt: new Date(),
              },
            });
            this.emit(trade.duelId, 'duel:trade_update', this.toTradeResult(updated));
          }
        } else if (trade.status === TradeStatus.OPEN && trade.entryPrice != null) {
          const hit = checkSlTpHit(
            trade.side as 'LONG' | 'SHORT',
            toNumber(trade.stopLoss),
            trade.takeProfit != null ? toNumber(trade.takeProfit) : null,
            tick,
          );
          if (hit) {
            await this.closeTradeAtMarket(trade.id, hit);
          }
        }
      } catch (err) {
        this.logger.warn(`Error procesando trade ${trade.id}: ${err}`);
      }
    }
  }

  // ─── Raises ──────────────────────────────────────────────────────────────

  async proposeRaise(duelId: string, userId: string, newStake: number) {
    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: { raises: { where: { status: RaiseStatus.PENDING } } },
    });
    if (!duel || !duel.playerBId) throw new BadRequestException('Duelo inválido');
    if (duel.playerAId !== userId && duel.playerBId !== userId) {
      throw new ForbiddenException();
    }

    const isA = duel.playerAId === userId;
    const currentStake = isA ? toNumber(duel.stakeA) : toNumber(duel.stakeB);
    const raisesUsed = isA ? duel.raisesUsedA : duel.raisesUsedB;
    const toUserId = isA ? duel.playerBId : duel.playerAId;

    const validation = validateRaiseProposal({
      status: duel.status as Parameters<typeof validateRaiseProposal>[0]['status'],
      mode: duel.mode as DuelModeKey,
      raisesUsedByProposer: raisesUsed,
      currentStake,
      newStake,
      hasPendingRaise: duel.raises.length > 0,
    });

    if (!validation.ok) {
      throw new BadRequestException(validation.message);
    }

    // Verificar fondos del proponente para el extra
    const extra = newStake - currentStake;
    const snap = await this.wallet.getSnapshot(userId);
    if (snap.availableBalance < extra) {
      throw new BadRequestException('Saldo insuficiente para proponer la subida');
    }

    const raise = await this.prisma.stakeRaise.create({
      data: {
        duelId,
        fromUserId: userId,
        toUserId,
        previousStake: currentStake,
        proposedStake: newStake,
        status: RaiseStatus.PENDING,
        expiresAt: validation.expiresAt,
      },
    });

    // Incrementar contador del proponente
    await this.prisma.duel.update({
      where: { id: duelId },
      data: isA
        ? { raisesUsedA: { increment: 1 } }
        : { raisesUsedB: { increment: 1 } },
    });

    const payload = {
      id: raise.id,
      fromUserId: raise.fromUserId,
      toUserId: raise.toUserId,
      previousStake: currentStake,
      proposedStake: newStake,
      expiresAt: raise.expiresAt.toISOString(),
      status: 'PENDING' as const,
    };

    this.emit(duelId, 'duel:raise', payload);

    // Timer de expiración 40s
    const existing = this.raiseTimers.get(raise.id);
    if (existing) clearTimeout(existing);
    const ms = raise.expiresAt.getTime() - Date.now();
    this.raiseTimers.set(
      raise.id,
      setTimeout(() => void this.expireRaise(raise.id), Math.max(ms, 0)),
    );

    return payload;
  }

  async respondRaise(
    duelId: string,
    userId: string,
    raiseId: string,
    action: 'ACCEPT' | 'REJECT' | 'RE_RAISE',
    newStake?: number,
  ) {
    const raise = await this.prisma.stakeRaise.findFirst({
      where: { id: raiseId, duelId },
    });
    if (!raise || raise.status !== RaiseStatus.PENDING) {
      throw new BadRequestException('Raise no pendiente');
    }
    if (raise.toUserId !== userId) {
      throw new ForbiddenException('No eres el destinatario de la subida');
    }
    if (isPhaseExpired(raise.expiresAt)) {
      await this.expireRaise(raiseId);
      throw new BadRequestException('La subida ha expirado');
    }

    if (action === 'REJECT') {
      await this.prisma.stakeRaise.update({
        where: { id: raiseId },
        data: { status: RaiseStatus.REJECTED, respondedAt: new Date() },
      });
      this.clearRaiseTimer(raiseId);
      this.emit(duelId, 'duel:raise_result', {
        raiseId,
        status: 'REJECTED',
        pot: 0,
      });
      return { status: 'REJECTED' };
    }

    if (action === 'ACCEPT') {
      return this.acceptRaise(duelId, raiseId);
    }

    // RE_RAISE
    if (newStake == null) {
      throw new BadRequestException('newStake requerido para RE_RAISE');
    }
    await this.prisma.stakeRaise.update({
      where: { id: raiseId },
      data: { status: RaiseStatus.RE_RAISED, respondedAt: new Date() },
    });
    this.clearRaiseTimer(raiseId);
    this.emit(duelId, 'duel:raise_result', {
      raiseId,
      status: 'RE_RAISED',
      pot: 0,
    });
    // El destinatario se convierte en proponente del nuevo nivel
    return this.proposeRaise(duelId, userId, newStake);
  }

  private async acceptRaise(duelId: string, raiseId: string) {
    const raise = await this.prisma.stakeRaise.findUniqueOrThrow({
      where: { id: raiseId },
    });
    const duel = await this.prisma.duel.findUniqueOrThrow({
      where: { id: duelId },
    });

    const proposed = toNumber(raise.proposedStake);
    const isFromA = raise.fromUserId === duel.playerAId;

    // Ambos deben llegar al mismo stake propuesto
    // Proponente ya se comprometió; receptor debe igualar
    const stakeA = proposed;
    const stakeB = proposed;
    const extraA = stakeA - toNumber(duel.stakeA);
    const extraB = stakeB - toNumber(duel.stakeB);

    if (extraA > 0) {
      await this.wallet.increaseLockedStake(duel.playerAId, extraA, duelId);
    }
    if (extraB > 0 && duel.playerBId) {
      await this.wallet.increaseLockedStake(duel.playerBId, extraB, duelId);
    }

    const pot = stakeA + stakeB;
    const updated = await this.prisma.duel.update({
      where: { id: duelId },
      data: {
        stakeA,
        stakeB,
        pot,
        platformFee: calcPlatformFee(pot),
        winnerPrize: calcWinnerPrize(pot),
      },
    });

    await this.prisma.stakeRaise.update({
      where: { id: raiseId },
      data: { status: RaiseStatus.ACCEPTED, respondedAt: new Date() },
    });
    this.clearRaiseTimer(raiseId);

    this.emit(duelId, 'duel:raise_result', {
      raiseId,
      status: 'ACCEPTED',
      pot: toNumber(updated.pot),
    });

    void isFromA;
    return {
      status: 'ACCEPTED',
      pot: toNumber(updated.pot),
      stakeA,
      stakeB,
    };
  }

  private async expireRaise(raiseId: string) {
    const raise = await this.prisma.stakeRaise.findUnique({
      where: { id: raiseId },
    });
    if (!raise || raise.status !== RaiseStatus.PENDING) return;

    await this.prisma.stakeRaise.update({
      where: { id: raiseId },
      data: { status: RaiseStatus.EXPIRED, respondedAt: new Date() },
    });
    this.clearRaiseTimer(raiseId);
    this.emit(raise.duelId, 'duel:raise_result', {
      raiseId,
      status: 'EXPIRED',
      pot: 0,
    });
  }

  private clearRaiseTimer(raiseId: string) {
    const t = this.raiseTimers.get(raiseId);
    if (t) clearTimeout(t);
    this.raiseTimers.delete(raiseId);
  }

  toTradeResult(trade: {
    id: string;
    duelId: string;
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
    rMultiple: { toNumber?: () => number } | number | null;
    pnl: { toNumber?: () => number } | number | null;
    closeReason?: string | null;
    openedAt: Date | null;
    closedAt: Date | null;
  }): TradeResult {
    const num = (v: unknown): number | null => {
      if (v == null) return null;
      if (typeof v === 'number') return v;
      if (typeof v === 'object' && v !== null && 'toNumber' in v) {
        return (v as { toNumber: () => number }).toNumber();
      }
      return Number(v);
    };

    return {
      id: trade.id,
      duelId: trade.duelId,
      userId: trade.userId,
      asset: trade.asset as AssetSymbol,
      side: trade.side as TradeResult['side'],
      orderType: trade.orderType as TradeResult['orderType'],
      status: trade.status as TradeResult['status'],
      entryPrice: num(trade.entryPrice),
      exitPrice: num(trade.exitPrice),
      stopLoss: num(trade.stopLoss) ?? 0,
      takeProfit: num(trade.takeProfit),
      riskPct: num(trade.riskPct) ?? 0,
      riskAmount: num(trade.riskAmount) ?? 0,
      rMultiple: num(trade.rMultiple),
      pnl: num(trade.pnl),
      closeReason: trade.closeReason ?? null,
      openedAt: trade.openedAt?.toISOString() ?? null,
      closedAt: trade.closedAt?.toISOString() ?? null,
    };
  }
}

function createPrepTimersFromMode(_duelId: string) {
  return null;
}

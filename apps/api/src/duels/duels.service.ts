import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DuelMode, DuelStatus, MatchType, Prisma } from '@prisma/client';
import {
  VIRTUAL_CAPITAL,
  calcNewElo,
  calcPlatformFee,
  calcWinnerPrize,
  createPhaseTimers,
  type DuelModeKey,
  type DuelStateSnapshot,
  type TradeInput,
} from '@trading-duels/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { DuelEngineService } from './duel-engine.service';
import { toNumber } from '../common/utils/decimal';

@Injectable()
export class DuelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly engine: DuelEngineService,
  ) {}

  async createMatchedDuel(params: {
    playerAId: string;
    playerBId: string;
    mode: DuelMode;
    stake: number;
    matchType: MatchType;
    sessionWindow?: 'TOKYO' | 'LONDON' | 'NY' | null;
    eloA: number;
    eloB: number;
    /** Activo fijo del duelo (desafíos abiertos) */
    primaryAsset?: string | null;
  }) {
    const {
      playerAId,
      playerBId,
      mode,
      stake,
      matchType,
      sessionWindow,
      eloA,
      eloB,
      primaryAsset,
    } = params;

    const pot = stake * 2;
    const timers = createPhaseTimers(mode as DuelModeKey);

    // Crear duelo primero (para FK en wallet txs), luego bloquear stakes
    const duel = await this.prisma.duel.create({
      data: {
        mode,
        status: DuelStatus.MATCHED,
        matchType,
        sessionWindow: sessionWindow ?? null,
        playerAId,
        playerBId,
        stakeA: stake,
        stakeB: stake,
        pot,
        platformFee: calcPlatformFee(pot),
        winnerPrize: calcWinnerPrize(pot),
        virtualCapital: VIRTUAL_CAPITAL,
        primaryAsset: primaryAsset ?? null,
        eloA,
        eloB,
        matchedAt: new Date(),
        prepEndsAt: timers.prepEndsAt,
        developEndsAt: timers.developEndsAt,
      },
      include: {
        playerA: true,
        playerB: true,
      },
    });

    try {
      await this.wallet.lockStake(playerAId, stake, duel.id);
      await this.wallet.lockStake(playerBId, stake, duel.id);
    } catch (err) {
      await this.prisma.duel.update({
        where: { id: duel.id },
        data: { status: DuelStatus.CANCELLED },
      });
      throw err;
    }

    return duel;
  }

  async startPreparation(duelId: string) {
    const duel = await this.getDuelOrThrow(duelId);
    if (duel.status !== DuelStatus.MATCHED) {
      throw new BadRequestException('El duelo no está en estado MATCHED');
    }

    const timers = createPhaseTimers(duel.mode as DuelModeKey);
    const now = new Date();

    return this.prisma.duel.update({
      where: { id: duelId },
      data: {
        status: DuelStatus.PREPARATION,
        prepStartedAt: now,
        prepEndsAt: timers.prepEndsAt,
        developEndsAt: timers.developEndsAt,
      },
      include: { playerA: true, playerB: true, trades: true, raises: true },
    });
  }

  async markReady(duelId: string, userId: string) {
    const duel = await this.getDuelOrThrow(duelId);
    this.assertParticipant(duel, userId);

    if (duel.status !== DuelStatus.MATCHED && duel.status !== DuelStatus.PREPARATION) {
      throw new BadRequestException('No se puede marcar ready en este estado');
    }

    const isA = duel.playerAId === userId;
    const data: Prisma.DuelUpdateInput = isA
      ? { playerAReady: true }
      : { playerBReady: true };

    let updated = await this.prisma.duel.update({
      where: { id: duelId },
      data,
      include: { playerA: true, playerB: true, trades: true, raises: true },
    });

    // Si ambos ready y aún MATCHED → arrancar prep
    if (
      updated.status === DuelStatus.MATCHED &&
      updated.playerAReady &&
      updated.playerBReady
    ) {
      updated = await this.startPreparation(duelId);
      this.engine.scheduleDuel(updated.id);
    }

    return updated;
  }

  async getDuelOrThrow(duelId: string) {
    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: {
        playerA: true,
        playerB: true,
        trades: { orderBy: { createdAt: 'asc' } },
        raises: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!duel) throw new NotFoundException('Duelo no encontrado');
    return duel;
  }

  async listMyDuels(userId: string, limit = 20) {
    return this.prisma.duel.findMany({
      where: {
        OR: [{ playerAId: userId }, { playerBId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        playerA: { select: { id: true, username: true, elo: true } },
        playerB: { select: { id: true, username: true, elo: true } },
      },
    });
  }

  assertParticipant(
    duel: { playerAId: string; playerBId: string | null },
    userId: string,
  ) {
    if (duel.playerAId !== userId && duel.playerBId !== userId) {
      throw new ForbiddenException('No eres participante de este duelo');
    }
  }

  isParticipant(
    duel: { playerAId: string; playerBId: string | null },
    userId: string,
  ): boolean {
    return duel.playerAId === userId || duel.playerBId === userId;
  }

  /**
   * Snapshot para jugador o espectador (también anónimo).
   * Live: MATCHED | PREPARATION | DEVELOPMENT | SETTLING (y terminados legibles).
   */
  async getSpectatorOrPlayerSnapshot(
    duelId: string,
    userId?: string | null,
  ) {
    const duel = await this.getDuelOrThrow(duelId);
    const isPlayer = userId ? this.isParticipant(duel, userId) : false;
    if (!isPlayer) {
      const watchable = [
        'MATCHED',
        'PREPARATION',
        'DEVELOPMENT',
        'SETTLING',
        'COMPLETED',
        'DRAW',
        'CANCELLED',
      ];
      if (!watchable.includes(duel.status)) {
        throw new ForbiddenException('Este duelo no se puede espectar');
      }
      if (!duel.playerBId) {
        throw new ForbiddenException('Duelo incompleto');
      }
    }
    const snap = this.toSnapshot(duel);
    return {
      ...snap,
      viewerRole: isPlayer ? ('PLAYER' as const) : ('SPECTATOR' as const),
    };
  }

  async openTrade(duelId: string, userId: string, input: TradeInput) {
    return this.engine.openTrade(duelId, userId, input);
  }

  async closeTrade(duelId: string, userId: string, tradeId: string) {
    return this.engine.closeTradeManual(duelId, userId, tradeId);
  }

  async cancelTrade(duelId: string, userId: string, tradeId: string) {
    return this.engine.cancelPendingTrade(duelId, userId, tradeId);
  }

  async proposeRaise(duelId: string, userId: string, newStake: number) {
    return this.engine.proposeRaise(duelId, userId, newStake);
  }

  async respondRaise(
    duelId: string,
    userId: string,
    raiseId: string,
    action: 'ACCEPT' | 'REJECT' | 'RE_RAISE',
    newStake?: number,
  ) {
    return this.engine.respondRaise(duelId, userId, raiseId, action, newStake);
  }

  toSnapshot(
    duel: Awaited<ReturnType<typeof this.getDuelOrThrow>>,
    opts?: { hideElo?: boolean },
  ): DuelStateSnapshot {
    const hideElo =
      opts?.hideElo ??
      (duel.matchType === 'OPEN_CHALLENGE' && duel.status === 'MATCHED');

    const tradesA = duel.trades.filter((t) => t.userId === duel.playerAId);
    const tradesB = duel.playerBId
      ? duel.trades.filter((t) => t.userId === duel.playerBId)
      : [];

    const sumR = (trades: typeof duel.trades) =>
      trades.reduce((s, t) => s + (t.rMultiple ? toNumber(t.rMultiple) : 0), 0);
    const sumPnl = (trades: typeof duel.trades) =>
      trades.reduce((s, t) => s + (t.pnl ? toNumber(t.pnl) : 0), 0);
    const riskUsed = (trades: typeof duel.trades) =>
      trades
        .filter((t) => t.status !== 'CANCELLED')
        .reduce((s, t) => s + toNumber(t.riskPct), 0);

    const pendingRaise = duel.raises.find((r) => r.status === 'PENDING');

    return {
      id: duel.id,
      mode: duel.mode as DuelModeKey,
      status: duel.status as DuelStateSnapshot['status'],
      matchType: duel.matchType as DuelStateSnapshot['matchType'],
      sessionWindow: duel.sessionWindow as DuelStateSnapshot['sessionWindow'],
      primaryAsset: duel.primaryAsset ?? null,
      pot: toNumber(duel.pot),
      platformFee: toNumber(duel.platformFee),
      winnerPrize: toNumber(duel.winnerPrize),
      playerA: {
        userId: duel.playerAId,
        username: duel.playerA.username,
        elo: hideElo ? undefined : (duel.eloA ?? duel.playerA.elo),
        stake: toNumber(duel.stakeA),
        totalRiskUsedPct: riskUsed(tradesA),
        tradeCount: tradesA.filter((t) => t.status !== 'CANCELLED').length,
        openTrades: tradesA.filter((t) => t.status === 'OPEN' || t.status === 'PENDING')
          .length,
        totalR: sumR(tradesA),
        totalPnl: sumPnl(tradesA),
        isReady: duel.playerAReady,
      },
      playerB: duel.playerBId && duel.playerB
        ? {
            userId: duel.playerBId,
            username: duel.playerB.username,
            elo: hideElo ? undefined : (duel.eloB ?? duel.playerB.elo),
            stake: toNumber(duel.stakeB),
            totalRiskUsedPct: riskUsed(tradesB),
            tradeCount: tradesB.filter((t) => t.status !== 'CANCELLED').length,
            openTrades: tradesB.filter(
              (t) => t.status === 'OPEN' || t.status === 'PENDING',
            ).length,
            totalR: sumR(tradesB),
            totalPnl: sumPnl(tradesB),
            isReady: duel.playerBReady,
          }
        : null,
      phaseStartedAt:
        duel.status === 'DEVELOPMENT'
          ? duel.developStartedAt?.toISOString() ?? null
          : duel.prepStartedAt?.toISOString() ?? null,
      phaseEndsAt:
        duel.status === 'DEVELOPMENT'
          ? duel.developEndsAt?.toISOString() ?? null
          : duel.status === 'PREPARATION'
            ? duel.prepEndsAt?.toISOString() ?? null
            : null,
      prepEndsAt: duel.prepEndsAt?.toISOString() ?? null,
      developEndsAt: duel.developEndsAt?.toISOString() ?? null,
      raisesUsed: {
        [duel.playerAId]: duel.raisesUsedA,
        ...(duel.playerBId ? { [duel.playerBId]: duel.raisesUsedB } : {}),
      },
      pendingRaise: pendingRaise
        ? {
            id: pendingRaise.id,
            fromUserId: pendingRaise.fromUserId,
            toUserId: pendingRaise.toUserId,
            previousStake: toNumber(pendingRaise.previousStake),
            proposedStake: toNumber(pendingRaise.proposedStake),
            expiresAt: pendingRaise.expiresAt.toISOString(),
            status: pendingRaise.status as DuelStateSnapshot['pendingRaise'] extends null
              ? never
              : NonNullable<DuelStateSnapshot['pendingRaise']>['status'],
          }
        : null,
      trades: duel.trades.map((t) => this.engine.toTradeResult(t)),
      createdAt: duel.createdAt.toISOString(),
    };
  }
}

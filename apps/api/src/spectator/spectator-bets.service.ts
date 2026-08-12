import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DuelStatus,
  SpectatorBetStatus,
  WalletTxType,
} from '@prisma/client';
import {
  PLATFORM_FEE_RATE,
  calcPlatformFee,
  calcWinnerPrize,
  roundMoney,
  type SpectatorBetView,
} from '@trading-duels/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { toNumber } from '../common/utils/decimal';

const LIVE_STATUSES: DuelStatus[] = [
  DuelStatus.MATCHED,
  DuelStatus.PREPARATION,
  DuelStatus.DEVELOPMENT,
];

@Injectable()
export class SpectatorBetsService {
  private readonly logger = new Logger(SpectatorBetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async listLiveDuels() {
    const duels = await this.prisma.duel.findMany({
      where: {
        status: { in: LIVE_STATUSES },
        playerBId: { not: null },
      },
      orderBy: { matchedAt: 'desc' },
      take: 40,
      include: {
        playerA: { select: { id: true, username: true } },
        playerB: { select: { id: true, username: true } },
        trades: {
          where: { status: { in: ['OPEN', 'CLOSED', 'EXPIRED'] } },
          select: { userId: true, rMultiple: true, status: true },
        },
        _count: {
          select: {
            spectatorBets: { where: { status: SpectatorBetStatus.OPEN } },
          },
        },
      },
    });

    return duels.map((d) => {
      const sumR = (uid: string) =>
        d.trades
          .filter((t) => t.userId === uid && t.rMultiple != null)
          .reduce((s, t) => s + toNumber(t.rMultiple!), 0);

      return {
        id: d.id,
        mode: d.mode,
        status: d.status,
        primaryAsset: d.primaryAsset,
        pot: toNumber(d.pot),
        playerA: {
          userId: d.playerAId,
          username: d.playerA.username,
          totalR: roundMoney(sumR(d.playerAId) * 10000) / 10000,
        },
        playerB: d.playerBId && d.playerB
          ? {
              userId: d.playerBId,
              username: d.playerB.username,
              totalR: roundMoney(sumR(d.playerBId) * 10000) / 10000,
            }
          : null,
        phaseEndsAt:
          d.status === DuelStatus.DEVELOPMENT
            ? d.developEndsAt?.toISOString() ?? null
            : d.status === DuelStatus.PREPARATION
              ? d.prepEndsAt?.toISOString() ?? null
              : null,
        openBets: d._count.spectatorBets,
        spectatorFriendly: true,
        createdAt: d.createdAt.toISOString(),
      };
    });
  }

  async listBets(duelId: string, viewerId?: string): Promise<SpectatorBetView[]> {
    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: {
        playerA: { select: { id: true, username: true } },
        playerB: { select: { id: true, username: true } },
      },
    });
    if (!duel) throw new NotFoundException('Duelo no encontrado');

    const bets = await this.prisma.spectatorBet.findMany({
      where: { duelId },
      orderBy: { createdAt: 'desc' },
      include: {
        proposer: { select: { id: true, username: true } },
        acceptor: { select: { id: true, username: true } },
      },
    });

    return bets.map((b) =>
      this.toView(b, duel, viewerId),
    );
  }

  async createOffer(params: {
    duelId: string;
    proposerId: string;
    pickUserId: string;
    amount: number;
  }) {
    const { duelId, proposerId, pickUserId, amount } = params;
    if (amount < 1) throw new BadRequestException('Monto mínimo $1');

    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: {
        playerA: { select: { id: true, username: true } },
        playerB: { select: { id: true, username: true } },
      },
    });
    if (!duel || !duel.playerBId) {
      throw new BadRequestException('Duelo no disponible');
    }
    if (!LIVE_STATUSES.includes(duel.status)) {
      throw new BadRequestException(
        'Solo se puede apostar en duelos en curso',
      );
    }
    if (
      proposerId === duel.playerAId ||
      proposerId === duel.playerBId
    ) {
      throw new ForbiddenException(
        'Los jugadores del duelo no pueden apostar como espectadores',
      );
    }
    if (pickUserId !== duel.playerAId && pickUserId !== duel.playerBId) {
      throw new BadRequestException('Debes elegir Player A o Player B');
    }

    await this.wallet.lockFunds(
      proposerId,
      amount,
      WalletTxType.SPECTATOR_BET_LOCK,
      `Apuesta espectador bloqueada: $${amount}`,
      duelId,
    );

    const bet = await this.prisma.spectatorBet.create({
      data: {
        duelId,
        proposerId,
        pickUserId,
        amount,
        status: SpectatorBetStatus.OPEN,
      },
      include: {
        proposer: { select: { id: true, username: true } },
        acceptor: { select: { id: true, username: true } },
      },
    });

    return this.toView(bet, duel, proposerId);
  }

  async acceptOffer(params: {
    duelId: string;
    betId: string;
    acceptorId: string;
  }) {
    const { duelId, betId, acceptorId } = params;

    const bet = await this.prisma.spectatorBet.findFirst({
      where: { id: betId, duelId },
      include: {
        proposer: { select: { id: true, username: true } },
        acceptor: { select: { id: true, username: true } },
        duel: {
          include: {
            playerA: { select: { id: true, username: true } },
            playerB: { select: { id: true, username: true } },
          },
        },
      },
    });
    if (!bet) throw new NotFoundException('Apuesta no encontrada');
    if (bet.status !== SpectatorBetStatus.OPEN) {
      throw new BadRequestException('La oferta ya no está disponible');
    }
    if (bet.proposerId === acceptorId) {
      throw new BadRequestException('No puedes aceptar tu propia oferta');
    }
    if (
      acceptorId === bet.duel.playerAId ||
      acceptorId === bet.duel.playerBId
    ) {
      throw new ForbiddenException(
        'Los jugadores del duelo no pueden aceptar apuestas de espectadores',
      );
    }
    if (!LIVE_STATUSES.includes(bet.duel.status)) {
      throw new BadRequestException('El duelo ya no acepta apuestas');
    }

    const amount = toNumber(bet.amount);
    await this.wallet.lockFunds(
      acceptorId,
      amount,
      WalletTxType.SPECTATOR_BET_LOCK,
      `Apuesta espectador aceptada: $${amount}`,
      duelId,
    );

    const pot = roundMoney(amount * 2);
    const platformFee = calcPlatformFee(pot);
    const winnerPrize = calcWinnerPrize(pot);

    const updated = await this.prisma.spectatorBet.update({
      where: { id: betId },
      data: {
        acceptorId,
        status: SpectatorBetStatus.MATCHED,
        pot,
        platformFee,
        winnerPrize,
        matchedAt: new Date(),
      },
      include: {
        proposer: { select: { id: true, username: true } },
        acceptor: { select: { id: true, username: true } },
      },
    });

    return this.toView(updated, bet.duel, acceptorId);
  }

  async cancelOffer(params: {
    duelId: string;
    betId: string;
    userId: string;
  }) {
    const bet = await this.prisma.spectatorBet.findFirst({
      where: { id: params.betId, duelId: params.duelId },
    });
    if (!bet) throw new NotFoundException('Apuesta no encontrada');
    if (bet.proposerId !== params.userId) {
      throw new ForbiddenException('Solo el proponente puede cancelar');
    }
    if (bet.status !== SpectatorBetStatus.OPEN) {
      throw new BadRequestException('Solo se cancelan ofertas abiertas');
    }

    const amount = toNumber(bet.amount);
    await this.wallet.refundLockedStake(
      params.userId,
      amount,
      params.duelId,
    );
    // re-tag description via credit 0 style - refundLockedStake is fine

    const updated = await this.prisma.spectatorBet.update({
      where: { id: bet.id },
      data: { status: SpectatorBetStatus.CANCELLED },
      include: {
        proposer: { select: { id: true, username: true } },
        acceptor: { select: { id: true, username: true } },
        duel: {
          include: {
            playerA: { select: { id: true, username: true } },
            playerB: { select: { id: true, username: true } },
          },
        },
      },
    });

    return this.toView(updated, updated.duel, params.userId);
  }

  /**
   * Liquidar todas las apuestas al terminar el duelo.
   * - MATCHED + winner → paga al espectador que acertó (pot - 10%)
   * - MATCHED + draw → reembolso ambos
   * - OPEN → cancelar y reembolsar proponente
   */
  async settleForDuel(params: {
    duelId: string;
    duelWinnerId: string | null;
    isDraw: boolean;
  }) {
    const { duelId, duelWinnerId, isDraw } = params;

    const bets = await this.prisma.spectatorBet.findMany({
      where: {
        duelId,
        status: {
          in: [SpectatorBetStatus.OPEN, SpectatorBetStatus.MATCHED],
        },
      },
    });

    for (const bet of bets) {
      try {
        if (bet.status === SpectatorBetStatus.OPEN) {
          await this.wallet.refundLockedStake(
            bet.proposerId,
            toNumber(bet.amount),
            duelId,
          );
          await this.prisma.spectatorBet.update({
            where: { id: bet.id },
            data: {
              status: SpectatorBetStatus.CANCELLED,
              settledAt: new Date(),
            },
          });
          continue;
        }

        // MATCHED
        const amount = toNumber(bet.amount);
        if (isDraw || !duelWinnerId || !bet.acceptorId) {
          await this.wallet.refundLockedStake(bet.proposerId, amount, duelId);
          if (bet.acceptorId) {
            await this.wallet.refundLockedStake(
              bet.acceptorId,
              amount,
              duelId,
            );
          }
          await this.prisma.spectatorBet.update({
            where: { id: bet.id },
            data: {
              status: SpectatorBetStatus.REFUNDED,
              settledAt: new Date(),
            },
          });
          continue;
        }

        const pot = toNumber(bet.pot) || amount * 2;
        const fee =
          toNumber(bet.platformFee) || roundMoney(pot * PLATFORM_FEE_RATE);
        const prize =
          toNumber(bet.winnerPrize) || roundMoney(pot - fee);

        // Proponente gana si pickUserId === duelWinnerId
        const proposerWins = bet.pickUserId === duelWinnerId;
        const winnerSpectatorId = proposerWins
          ? bet.proposerId
          : bet.acceptorId!;
        const loserSpectatorId = proposerWins
          ? bet.acceptorId!
          : bet.proposerId;

        // Consumir stakes bloqueados de ambos
        await this.wallet.unlockAndConsume(
          bet.proposerId,
          amount,
          WalletTxType.SPECTATOR_BET_LOCK,
          `Apuesta consumida: $${amount}`,
          duelId,
        );
        await this.wallet.unlockAndConsume(
          bet.acceptorId!,
          amount,
          WalletTxType.SPECTATOR_BET_LOCK,
          `Apuesta consumida: $${amount}`,
          duelId,
        );

        await this.wallet.credit(
          winnerSpectatorId,
          prize,
          WalletTxType.SPECTATOR_BET_WIN,
          `Apuesta ganada +$${prize} (fee $${fee})`,
          duelId,
        );

        void loserSpectatorId;

        await this.prisma.spectatorBet.update({
          where: { id: bet.id },
          data: {
            status: SpectatorBetStatus.SETTLED,
            winnerSpectatorId,
            pot,
            platformFee: fee,
            winnerPrize: prize,
            settledAt: new Date(),
          },
        });
      } catch (err) {
        this.logger.error(
          `Error liquidando bet ${bet.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    this.logger.log(
      `Spectator bets settled for duel ${duelId}: ${bets.length} processed`,
    );
  }

  private toView(
    bet: {
      id: string;
      duelId: string;
      proposerId: string;
      acceptorId: string | null;
      pickUserId: string;
      amount: unknown;
      pot: unknown;
      platformFee: unknown;
      winnerPrize: unknown;
      status: SpectatorBetStatus;
      winnerSpectatorId: string | null;
      matchedAt: Date | null;
      settledAt: Date | null;
      createdAt: Date;
      proposer: { id: string; username: string };
      acceptor: { id: string; username: string } | null;
    },
    duel: {
      playerAId: string;
      playerBId: string | null;
      playerA: { id: string; username: string };
      playerB: { id: string; username: string } | null;
    },
    viewerId?: string,
  ): SpectatorBetView {
    const pickIsA = bet.pickUserId === duel.playerAId;
    const pickUsername = pickIsA
      ? duel.playerA.username
      : duel.playerB?.username ?? '—';
    const counterPickUserId = pickIsA
      ? (duel.playerBId ?? '')
      : duel.playerAId;
    const counterPickUsername = pickIsA
      ? duel.playerB?.username ?? '—'
      : duel.playerA.username;

    const isParticipant =
      viewerId === duel.playerAId || viewerId === duel.playerBId;

    return {
      id: bet.id,
      duelId: bet.duelId,
      proposerId: bet.proposerId,
      proposerUsername: bet.proposer.username,
      acceptorId: bet.acceptorId,
      acceptorUsername: bet.acceptor?.username ?? null,
      pickUserId: bet.pickUserId,
      pickUsername,
      counterPickUserId,
      counterPickUsername,
      amount: toNumber(bet.amount as Parameters<typeof toNumber>[0]),
      pot: bet.pot != null ? toNumber(bet.pot as Parameters<typeof toNumber>[0]) : null,
      platformFee:
        bet.platformFee != null
          ? toNumber(bet.platformFee as Parameters<typeof toNumber>[0])
          : null,
      winnerPrize:
        bet.winnerPrize != null
          ? toNumber(bet.winnerPrize as Parameters<typeof toNumber>[0])
          : null,
      status: bet.status as SpectatorBetView['status'],
      winnerSpectatorId: bet.winnerSpectatorId,
      matchedAt: bet.matchedAt?.toISOString() ?? null,
      settledAt: bet.settledAt?.toISOString() ?? null,
      createdAt: bet.createdAt.toISOString(),
      isMine: viewerId === bet.proposerId,
      canAccept:
        !!viewerId &&
        !isParticipant &&
        bet.status === SpectatorBetStatus.OPEN &&
        bet.proposerId !== viewerId,
    };
  }
}

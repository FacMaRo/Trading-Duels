import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { DuelMode, MatchType } from '@prisma/client';
import {
  ALL_ASSETS,
  MATCHMAKING_ELO_RANGE,
  type AssetSymbol,
  type DuelModeKey,
  type OpenChallengePublic,
  type SlowSessionWindow,
} from '@trading-duels/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { DuelsService } from '../duels/duels.service';
import { DuelEngineService } from '../duels/duel-engine.service';
import { toNumber } from '../common/utils/decimal';

type MatchFoundHandler = (payload: {
  duelId: string;
  playerAId: string;
  playerBId: string;
}) => void;

@Injectable()
export class MatchmakingService implements OnModuleInit {
  private readonly logger = new Logger(MatchmakingService.name);
  private expandTimer: NodeJS.Timeout | null = null;
  private onMatch: MatchFoundHandler | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly duels: DuelsService,
    private readonly engine: DuelEngineService,
  ) {}

  onModuleInit() {
    // Expandir rango ELO cada 15s (matchmaking suave)
    this.expandTimer = setInterval(() => void this.expandRanges(), 15_000);
  }

  setMatchHandler(handler: MatchFoundHandler) {
    this.onMatch = handler;
  }

  async joinQueue(params: {
    userId: string;
    mode: DuelModeKey;
    stake: number;
    asset: string;
    sessionWindow?: SlowSessionWindow;
  }) {
    const { userId, mode, stake, sessionWindow } = params;
    const asset = params.asset?.toUpperCase();

    if (stake <= 0) throw new BadRequestException('Stake inválido');
    if (!(ALL_ASSETS as readonly string[]).includes(asset)) {
      throw new BadRequestException('Activo no soportado');
    }

    const snap = await this.wallet.getSnapshot(userId);
    if (snap.availableBalance < stake) {
      throw new BadRequestException('Saldo insuficiente');
    }

    // Cancelar tickets previos
    await this.prisma.matchmakingTicket.updateMany({
      where: { userId, status: 'QUEUED' },
      data: { status: 'CANCELLED' },
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    const ticket = await this.prisma.matchmakingTicket.create({
      data: {
        userId,
        mode: mode as DuelMode,
        stake,
        asset,
        elo: user.elo,
        sessionWindow: sessionWindow ?? null,
        eloRange: MATCHMAKING_ELO_RANGE,
        status: 'QUEUED',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // Intentar match inmediato
    const matched = await this.tryMatch(ticket.id);
    if (matched) {
      return { status: 'MATCHED' as const, duelId: matched.duelId };
    }

    return {
      status: 'QUEUED' as const,
      ticketId: ticket.id,
      eloRange: ticket.eloRange,
    };
  }

  async leaveQueue(userId: string) {
    await this.prisma.matchmakingTicket.updateMany({
      where: { userId, status: 'QUEUED' },
      data: { status: 'CANCELLED' },
    });
    return { ok: true };
  }

  private async tryMatch(ticketId: string) {
    const ticket = await this.prisma.matchmakingTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket || ticket.status !== 'QUEUED') return null;

    const candidates = await this.prisma.matchmakingTicket.findMany({
      where: {
        status: 'QUEUED',
        mode: ticket.mode,
        stake: ticket.stake,
        asset: ticket.asset,
        sessionWindow: ticket.sessionWindow,
        userId: { not: ticket.userId },
        id: { not: ticket.id },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const opponent = candidates.find(
      (c) =>
        Math.abs(c.elo - ticket.elo) <=
        Math.max(ticket.eloRange, c.eloRange),
    );

    if (!opponent) return null;

    // Marcar tickets
    await this.prisma.matchmakingTicket.updateMany({
      where: { id: { in: [ticket.id, opponent.id] } },
      data: { status: 'MATCHED' },
    });

    const duel = await this.duels.createMatchedDuel({
      playerAId: ticket.userId,
      playerBId: opponent.userId,
      mode: ticket.mode,
      stake: toNumber(ticket.stake),
      matchType: MatchType.AUTO,
      sessionWindow: ticket.sessionWindow,
      eloA: ticket.elo,
      eloB: opponent.elo,
      primaryAsset: ticket.asset,
    });

    await this.prisma.matchmakingTicket.updateMany({
      where: { id: { in: [ticket.id, opponent.id] } },
      data: { matchedDuelId: duel.id },
    });

    this.engine.scheduleDuel(duel.id);
    this.logger.log(
      `Match AUTO: ${ticket.userId} vs ${opponent.userId} → ${duel.id}`,
    );

    this.onMatch?.({
      duelId: duel.id,
      playerAId: ticket.userId,
      playerBId: opponent.userId,
    });

    return { duelId: duel.id };
  }

  private async expandRanges() {
    await this.prisma.matchmakingTicket.updateMany({
      where: { status: 'QUEUED' },
      data: { eloRange: { increment: 50 } },
    });

    const queued = await this.prisma.matchmakingTicket.findMany({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    for (const t of queued) {
      await this.tryMatch(t.id);
    }
  }

  // ─── Open challenges ─────────────────────────────────────────────────────

  async createChallenge(params: {
    userId: string;
    mode: DuelModeKey;
    stake: number;
    asset: string;
    sessionWindow?: SlowSessionWindow;
  }) {
    const { userId, mode, stake, sessionWindow } = params;
    const asset = params.asset?.toUpperCase();
    if (!(ALL_ASSETS as readonly string[]).includes(asset)) {
      throw new BadRequestException(
        `Activo inválido. Permitidos: ${ALL_ASSETS.join(', ')}`,
      );
    }
    if (stake <= 0) throw new BadRequestException('Stake inválido');

    const snap = await this.wallet.getSnapshot(userId);
    if (snap.availableBalance < stake) {
      throw new BadRequestException('Saldo insuficiente');
    }

    const challenge = await this.prisma.openChallenge.create({
      data: {
        creatorId: userId,
        mode: mode as DuelMode,
        asset,
        stake,
        sessionWindow: sessionWindow ?? null,
        status: 'OPEN',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    return this.toPublicChallenge(challenge, { isMine: true });
  }

  async listChallenges(viewerId?: string): Promise<OpenChallengePublic[]> {
    const list = await this.prisma.openChallenge.findMany({
      where: {
        status: 'OPEN',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return list.map((c) =>
      this.toPublicChallenge(c, {
        isMine: viewerId ? c.creatorId === viewerId : false,
      }),
    );
  }

  async acceptChallenge(challengeId: string, acceptorId: string) {
    const challenge = await this.prisma.openChallenge.findUnique({
      where: { id: challengeId },
      include: { creator: true },
    });
    if (!challenge || challenge.status !== 'OPEN') {
      throw new BadRequestException('Desafío no disponible');
    }
    if (challenge.creatorId === acceptorId) {
      throw new BadRequestException('No puedes aceptar tu propio desafío');
    }

    const stake = toNumber(challenge.stake);
    const snap = await this.wallet.getSnapshot(acceptorId);
    if (snap.availableBalance < stake) {
      throw new BadRequestException('Saldo insuficiente');
    }

    const acceptor = await this.prisma.user.findUniqueOrThrow({
      where: { id: acceptorId },
    });

    await this.prisma.openChallenge.update({
      where: { id: challengeId },
      data: { status: 'ACCEPTED' },
    });

    const duel = await this.duels.createMatchedDuel({
      playerAId: challenge.creatorId,
      playerBId: acceptorId,
      mode: challenge.mode,
      stake,
      matchType: MatchType.OPEN_CHALLENGE,
      sessionWindow: challenge.sessionWindow,
      eloA: challenge.creator.elo,
      eloB: acceptor.elo,
      primaryAsset: challenge.asset,
    });

    await this.prisma.openChallenge.update({
      where: { id: challengeId },
      data: { duelId: duel.id },
    });

    this.engine.scheduleDuel(duel.id);

    this.onMatch?.({
      duelId: duel.id,
      playerAId: challenge.creatorId,
      playerBId: acceptorId,
    });

    return { duelId: duel.id };
  }

  async cancelChallenge(challengeId: string, userId: string) {
    const challenge = await this.prisma.openChallenge.findUnique({
      where: { id: challengeId },
    });
    if (!challenge || challenge.creatorId !== userId) {
      throw new BadRequestException('No puedes cancelar este desafío');
    }
    await this.prisma.openChallenge.update({
      where: { id: challengeId },
      data: { status: 'CANCELLED' },
    });
    return { ok: true };
  }

  private toPublicChallenge(
    c: {
      id: string;
      mode: DuelMode;
      asset: string;
      stake: unknown;
      sessionWindow: string | null;
      createdAt: Date;
      expiresAt?: Date | null;
    },
    opts?: { isMine?: boolean },
  ): OpenChallengePublic {
    return {
      id: c.id,
      mode: c.mode as DuelModeKey,
      asset: c.asset as AssetSymbol,
      stake: toNumber(c.stake as Parameters<typeof toNumber>[0]),
      sessionWindow: c.sessionWindow as SlowSessionWindow | null,
      isMine: opts?.isMine ?? false,
      createdAt: c.createdAt.toISOString(),
      expiresAt: c.expiresAt?.toISOString() ?? null,
    };
  }
}

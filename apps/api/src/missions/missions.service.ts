import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  MissionProgressStatus,
  MissionType,
  WalletTxType,
} from '@prisma/client';
import {
  MISSION_DEFINITIONS,
  MISSION_POOL_FEE_SHARE,
  MISSION_SMALL_DAILY_CAP,
  MISSION_SMALL_MIN_STAKE,
  MISSION_BIG_MIN_STAKE,
  MONTHLY_REWARD_MAX,
  MONTHLY_REWARD_MIN,
  STREAK_CLAIM_COOLDOWN_MS,
  calcMonthlyReward,
  dayKey,
  periodKeyFor,
  roundMoney,
  type MissionTypeId,
  type MissionUiStatus,
  type MissionView,
  type MissionsOverview,
} from '@trading-duels/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { toNumber } from '../common/utils/decimal';

type Meta = {
  cooldownUntil?: string;
  lastClaimedAt?: string;
  lastWinDuelId?: string;
};

@Injectable()
export class MissionsService implements OnModuleInit {
  private readonly logger = new Logger(MissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async onModuleInit() {
    await this.prisma.missionPool.upsert({
      where: { id: 'main' },
      create: { id: 'main', balance: 0 },
      update: {},
    });
  }

  // ─── Hook post-duelo ─────────────────────────────────────────────────────

  /**
   * Llamar al liquidar un duelo.
   * - 10% de la comisión de plataforma → pozo
   * - Actualiza progreso del ganador (y resetea rachas de perdedor)
   */
  async onDuelSettled(params: {
    duelId: string;
    winnerId: string | null;
    playerAId: string;
    playerBId: string;
    stakeA: number;
    stakeB: number;
    platformFee: number;
    isDraw: boolean;
  }) {
    try {
      // Alimentar pozo con 10% de la comisión (también en empates si hubo fee)
      if (params.platformFee > 0) {
        await this.contributeToPool(params.platformFee, params.duelId);
      }

      if (params.isDraw || !params.winnerId) {
        // Empate: rompe racha de ambos
        await this.resetStreak(params.playerAId);
        await this.resetStreak(params.playerBId);
        return;
      }

      const loserId =
        params.winnerId === params.playerAId
          ? params.playerBId
          : params.playerAId;
      const winnerStake =
        params.winnerId === params.playerAId ? params.stakeA : params.stakeB;

      await this.resetStreak(loserId);
      await this.recordWin({
        userId: params.winnerId,
        duelId: params.duelId,
        stake: winnerStake,
        wonAt: new Date(),
      });
    } catch (err) {
      this.logger.error(
        `onDuelSettled failed for ${params.duelId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async contributeToPool(platformFee: number, duelId?: string) {
    const amount = roundMoney(platformFee * MISSION_POOL_FEE_SHARE);
    if (amount <= 0) return;

    await this.prisma.missionPool.upsert({
      where: { id: 'main' },
      create: {
        id: 'main',
        balance: amount,
        lifetimeIn: amount,
      },
      update: {
        balance: { increment: amount },
        lifetimeIn: { increment: amount },
      },
    });
    this.logger.debug(
      `Pool +$${amount} (10% of fee $${platformFee})${duelId ? ` duel=${duelId}` : ''}`,
    );
  }

  private async recordWin(params: {
    userId: string;
    duelId: string;
    stake: number;
    wonAt: Date;
  }) {
    // Idempotencia
    try {
      await this.prisma.missionWinEvent.create({
        data: {
          userId: params.userId,
          duelId: params.duelId,
          stake: params.stake,
          wonAt: params.wonAt,
        },
      });
    } catch {
      this.logger.debug(`Win already recorded ${params.userId}/${params.duelId}`);
      return;
    }

    const { userId, stake, wonAt } = params;

    if (stake >= MISSION_SMALL_MIN_STAKE) {
      await this.incrementMission(userId, 'DAILY_WINS_6', wonAt);
      await this.incrementMission(userId, 'WEEKLY_WINS_18', wonAt);
      await this.incrementStreak(userId, params.duelId, wonAt);
    }

    if (stake >= MISSION_BIG_MIN_STAKE) {
      await this.incrementMission(userId, 'MONTHLY_WINS_35', wonAt);
    }
  }

  private async incrementMission(
    userId: string,
    type: MissionTypeId,
    at: Date,
  ) {
    const def = MISSION_DEFINITIONS[type];
    const periodKey = periodKeyFor(def.period, at);
    const row = await this.ensureProgress(userId, type, periodKey, def.target);

    if (row.status === MissionProgressStatus.CLAIMED) return;
    if (row.status === MissionProgressStatus.COMPLETED) return;

    const next = Math.min(row.progress + 1, def.target);
    const completed = next >= def.target;

    await this.prisma.userMissionProgress.update({
      where: { id: row.id },
      data: {
        progress: next,
        status: completed
          ? MissionProgressStatus.COMPLETED
          : MissionProgressStatus.IN_PROGRESS,
        completedAt: completed ? at : null,
        rewardAmount:
          completed && def.fixedReward != null ? def.fixedReward : row.rewardAmount,
      },
    });
  }

  private async incrementStreak(
    userId: string,
    duelId: string,
    at: Date,
  ) {
    const type: MissionTypeId = 'STREAK_5';
    const def = MISSION_DEFINITIONS[type];
    const periodKey = 'active';
    const row = await this.ensureProgress(userId, type, periodKey, def.target);
    const meta = (row.metadata as Meta) ?? {};

    // Cooldown de claim: se puede seguir sumando racha, pero claim bloqueado
    if (row.status === MissionProgressStatus.CLAIMED) {
      // Nueva racha tras claim: resetear a 1 win
      await this.prisma.userMissionProgress.update({
        where: { id: row.id },
        data: {
          progress: 1,
          status: MissionProgressStatus.IN_PROGRESS,
          completedAt: null,
          claimedAt: row.claimedAt,
          rewardAmount: def.fixedReward,
          metadata: { ...meta, lastWinDuelId: duelId },
        },
      });
      return;
    }

    if (row.status === MissionProgressStatus.COMPLETED) {
      // Ya claimable: no resetear progreso hasta claim
      return;
    }

    const next = Math.min(row.progress + 1, def.target);
    const completed = next >= def.target;

    await this.prisma.userMissionProgress.update({
      where: { id: row.id },
      data: {
        progress: next,
        status: completed
          ? MissionProgressStatus.COMPLETED
          : MissionProgressStatus.IN_PROGRESS,
        completedAt: completed ? at : null,
        rewardAmount: def.fixedReward,
        metadata: { ...meta, lastWinDuelId: duelId },
      },
    });
  }

  private async resetStreak(userId: string) {
    const row = await this.prisma.userMissionProgress.findUnique({
      where: {
        userId_missionType_periodKey: {
          userId,
          missionType: MissionType.STREAK_5,
          periodKey: 'active',
        },
      },
    });
    if (!row) return;
    // No romper si ya está completa y pendiente de claim
    if (row.status === MissionProgressStatus.COMPLETED) return;
    if (row.progress === 0) return;

    await this.prisma.userMissionProgress.update({
      where: { id: row.id },
      data: {
        progress: 0,
        status: MissionProgressStatus.IN_PROGRESS,
        completedAt: null,
      },
    });
  }

  private async ensureProgress(
    userId: string,
    type: MissionTypeId,
    periodKey: string,
    target: number,
  ) {
    const def = MISSION_DEFINITIONS[type];
    return this.prisma.userMissionProgress.upsert({
      where: {
        userId_missionType_periodKey: {
          userId,
          missionType: type as MissionType,
          periodKey,
        },
      },
      create: {
        userId,
        missionType: type as MissionType,
        periodKey,
        progress: 0,
        target,
        status: MissionProgressStatus.IN_PROGRESS,
        rewardAmount: def.fixedReward,
      },
      update: {},
    });
  }

  // ─── Lectura ─────────────────────────────────────────────────────────────

  async getOverview(userId: string): Promise<MissionsOverview> {
    const now = new Date();
    const budget = await this.getDailyBudget(now);
    const pool = await this.getPool();
    const smallRemaining = Math.max(
      0,
      toNumber(budget.cap) - toNumber(budget.paidOut),
    );
    const smallActive = smallRemaining > 0.01;
    const poolBalance = toNumber(pool.balance);
    const canFundMonthly = poolBalance >= MONTHLY_REWARD_MIN;

    const types = Object.keys(MISSION_DEFINITIONS) as MissionTypeId[];
    const missions: MissionView[] = [];

    for (const type of types) {
      missions.push(
        await this.buildMissionView(userId, type, now, {
          smallActive,
          smallRemaining,
          poolBalance,
          canFundMonthly,
        }),
      );
    }

    const cap = toNumber(budget.cap);
    const paid = toNumber(budget.paidOut);
    return {
      smallMissionsActive: smallActive,
      smallDailyUtilizationPct:
        cap > 0 ? Math.min(100, Math.round((paid / cap) * 1000) / 10) : 0,
      pool: {
        monthlyMinReward: MONTHLY_REWARD_MIN,
        monthlyMaxReward: MONTHLY_REWARD_MAX,
        canFundMonthly,
      },
      missions,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * Public mission catalog (no personal progress; cannot claim).
   * Omits pool balance / fee economics.
   */
  async getPublicOverview(): Promise<MissionsOverview> {
    const now = new Date();
    const budget = await this.getDailyBudget(now);
    const pool = await this.getPool();
    const smallRemaining = Math.max(
      0,
      toNumber(budget.cap) - toNumber(budget.paidOut),
    );
    const smallActive = smallRemaining > 0.01;
    const poolBalance = toNumber(pool.balance);
    const canFundMonthly = poolBalance >= MONTHLY_REWARD_MIN;

    const types = Object.keys(MISSION_DEFINITIONS) as MissionTypeId[];
    const missions: MissionView[] = types.map((type) => {
      const def = MISSION_DEFINITIONS[type];
      const periodKey =
        def.period === 'streak' ? 'active' : periodKeyFor(def.period, now);
      let status: MissionUiStatus = 'IN_PROGRESS';
      let statusMessage: string | null =
        'Sign in to track progress and claim rewards.';
      if (def.category === 'SMALL' && !smallActive) {
        status = 'PAUSED_DAILY_CAP';
        statusMessage =
          'Daily small-mission limit reached. Try again tomorrow (UTC).';
      } else if (def.category === 'BIG' && !canFundMonthly) {
        status = 'PAUSED_POOL';
        statusMessage = 'Monthly reward unlocks when available.';
      }
      return {
        type,
        category: def.category,
        title: def.title,
        description: def.description,
        progress: 0,
        target: def.target,
        progressPct: 0,
        // Fixed rewards only for small; monthly shows range until claim (no pool $ leak)
        rewardLabel:
          def.fixedReward != null
            ? `$${def.fixedReward.toFixed(2)}`
            : `$${MONTHLY_REWARD_MIN}–$${MONTHLY_REWARD_MAX}`,
        rewardAmount: def.fixedReward,
        status,
        statusMessage,
        periodKey,
        periodLabel: this.periodLabel(def.period, periodKey),
        minStake: def.minStake,
        canClaim: false,
        cooldownEndsAt: null,
      };
    });

    const cap = toNumber(budget.cap);
    const paid = toNumber(budget.paidOut);
    return {
      smallMissionsActive: smallActive,
      smallDailyUtilizationPct:
        cap > 0 ? Math.min(100, Math.round((paid / cap) * 1000) / 10) : 0,
      pool: {
        monthlyMinReward: MONTHLY_REWARD_MIN,
        monthlyMaxReward: MONTHLY_REWARD_MAX,
        canFundMonthly,
      },
      missions,
      generatedAt: now.toISOString(),
    };
  }

  private async buildMissionView(
    userId: string,
    type: MissionTypeId,
    now: Date,
    ctx: {
      smallActive: boolean;
      smallRemaining: number;
      poolBalance: number;
      canFundMonthly: boolean;
    },
  ): Promise<MissionView> {
    const def = MISSION_DEFINITIONS[type];
    const periodKey =
      def.period === 'streak' ? 'active' : periodKeyFor(def.period, now);
    const progressRow = await this.ensureProgress(
      userId,
      type,
      periodKey,
      def.target,
    );

    const meta = (progressRow.metadata as Meta) ?? {};
    const cooldownEndsAt = meta.cooldownUntil ?? null;
    const inCooldown =
      cooldownEndsAt != null &&
      new Date(cooldownEndsAt).getTime() > now.getTime();

    let status: MissionUiStatus = 'IN_PROGRESS';
    let statusMessage: string | null = null;
    let canClaim = false;
    let rewardAmount = def.fixedReward;
    let rewardLabel =
      def.fixedReward != null
        ? `$${def.fixedReward.toFixed(2)}`
        : `$${MONTHLY_REWARD_MIN}–$${MONTHLY_REWARD_MAX}`;

    const dbStatus = progressRow.status;

    if (dbStatus === MissionProgressStatus.CLAIMED && def.period !== 'streak') {
      status = 'CLAIMED';
      statusMessage = 'Reward already claimed this period.';
    } else if (dbStatus === MissionProgressStatus.COMPLETED) {
      if (type === 'STREAK_5' && inCooldown) {
        status = 'COOLDOWN';
        statusMessage = '3-day cooldown between streak claims.';
      } else if (def.category === 'SMALL') {
        if (!ctx.smallActive) {
          status = 'PAUSED_DAILY_CAP';
          statusMessage =
            'Daily small-mission limit reached. Try again tomorrow (UTC).';
        } else if (
          def.fixedReward != null &&
          def.fixedReward > ctx.smallRemaining + 1e-9
        ) {
          status = 'PAUSED_DAILY_CAP';
          statusMessage =
            'Daily reward capacity is full. Try again tomorrow (UTC).';
        } else {
          status = 'CLAIMABLE';
          canClaim = true;
          statusMessage = 'Ready to claim!';
        }
      } else {
        const estimated = calcMonthlyReward(ctx.poolBalance);
        if (estimated == null) {
          status = 'PAUSED_POOL';
          statusMessage =
            'Monthly reward not available yet. Progress is saved — claim unlocks when available.';
          rewardAmount = null;
        } else {
          status = 'CLAIMABLE';
          canClaim = true;
          rewardAmount = estimated;
          // Exact claim amount only when claimable (UX); no fee/pool copy
          rewardLabel = `$${estimated.toFixed(2)}`;
          statusMessage = 'Ready to claim your monthly reward!';
        }
      }
    } else {
      // IN_PROGRESS / LOCKED / CLAIMED-streak mid-run
      if (def.category === 'SMALL' && !ctx.smallActive) {
        status = 'PAUSED_DAILY_CAP';
        statusMessage =
          'Small missions paused for today. They resume tomorrow (UTC).';
      } else if (def.category === 'BIG' && !ctx.canFundMonthly) {
        status = 'PAUSED_POOL';
        statusMessage =
          'Monthly reward unlocks when available. You can keep progressing.';
      } else if (type === 'STREAK_5' && inCooldown && progressRow.progress === 0) {
        status = 'COOLDOWN';
        statusMessage =
          'Cooldown active after last claim (max 1 every 3 days).';
      } else {
        status = 'IN_PROGRESS';
      }
    }

    const progress = progressRow.progress;
    const target = progressRow.target || def.target;

    return {
      type,
      category: def.category,
      title: def.title,
      description: def.description,
      progress,
      target,
      progressPct: Math.min(100, Math.round((progress / target) * 1000) / 10),
      rewardLabel,
      rewardAmount,
      status,
      statusMessage,
      periodKey: progressRow.periodKey,
      periodLabel: this.periodLabel(def.period, progressRow.periodKey),
      minStake: def.minStake,
      canClaim,
      cooldownEndsAt: inCooldown && cooldownEndsAt ? cooldownEndsAt : null,
    };
  }

  private periodLabel(
    period: string,
    key: string,
  ): string {
    if (period === 'day') return `Day ${key}`;
    if (period === 'week') return `Week ${key}`;
    if (period === 'month') return `Month ${key}`;
    return 'Current streak';
  }

  // ─── Claim ───────────────────────────────────────────────────────────────

  async claim(userId: string, missionType: MissionTypeId) {
    const def = MISSION_DEFINITIONS[missionType];
    if (!def) throw new BadRequestException('Misión desconocida');

    const now = new Date();
    const periodKey = periodKeyFor(def.period, now);
    const key = def.period === 'streak' ? 'active' : periodKey;

    const row = await this.prisma.userMissionProgress.findUnique({
      where: {
        userId_missionType_periodKey: {
          userId,
          missionType: missionType as MissionType,
          periodKey: key,
        },
      },
    });

    if (!row) throw new NotFoundException('Progreso de misión no encontrado');
    if (row.status !== MissionProgressStatus.COMPLETED) {
      throw new BadRequestException('La misión no está lista para reclamar');
    }
    if (row.progress < def.target) {
      throw new BadRequestException('Progreso incompleto');
    }

    const meta = (row.metadata as Meta) ?? {};
    if (missionType === 'STREAK_5' && meta.cooldownUntil) {
      if (new Date(meta.cooldownUntil).getTime() > now.getTime()) {
        throw new BadRequestException(
          'Cooldown de 3 días activo para la racha de 5',
        );
      }
    }

    if (def.category === 'SMALL') {
      return this.claimSmall(userId, row.id, missionType, def.fixedReward!, now, meta);
    }
    return this.claimMonthly(userId, row.id, now);
  }

  private async claimSmall(
    userId: string,
    progressId: string,
    missionType: MissionTypeId,
    amount: number,
    now: Date,
    meta: Meta,
  ) {
    const budget = await this.getDailyBudget(now);
    const remaining = toNumber(budget.cap) - toNumber(budget.paidOut);
    if (remaining < amount - 1e-9) {
      throw new BadRequestException(
        'Tope diario de misiones pequeñas alcanzado o insuficiente',
      );
    }

    // Atomic-ish update budget
    const updatedBudget = await this.prisma.missionDailyBudget.update({
      where: { dateKey: budget.dateKey },
      data: { paidOut: { increment: amount } },
    });
    if (toNumber(updatedBudget.paidOut) > toNumber(updatedBudget.cap) + 0.01) {
      // rollback soft
      await this.prisma.missionDailyBudget.update({
        where: { dateKey: budget.dateKey },
        data: { paidOut: { decrement: amount } },
      });
      throw new BadRequestException('Tope diario superado');
    }

    const cooldownUntil =
      missionType === 'STREAK_5'
        ? new Date(now.getTime() + STREAK_CLAIM_COOLDOWN_MS).toISOString()
        : meta.cooldownUntil;

    await this.prisma.userMissionProgress.update({
      where: { id: progressId },
      data: {
        status: MissionProgressStatus.CLAIMED,
        claimedAt: now,
        rewardAmount: amount,
        // Tras claim de racha, reiniciar contador pero conservar cooldown
        ...(missionType === 'STREAK_5'
          ? {
              progress: 0,
              completedAt: null,
              metadata: {
                ...meta,
                lastClaimedAt: now.toISOString(),
                cooldownUntil,
              },
            }
          : {}),
      },
    });

    await this.prisma.missionClaim.create({
      data: {
        userId,
        progressId,
        missionType: missionType as MissionType,
        amount,
        source: 'SMALL_BUDGET',
      },
    });

    await this.wallet.credit(
      userId,
      amount,
      WalletTxType.MISSION_REWARD,
      `Misión ${missionType}: +$${amount.toFixed(2)}`,
    );

    return {
      ok: true,
      amount,
      missionType,
      source: 'SMALL_BUDGET' as const,
      message: `¡Recompensa de $${amount.toFixed(2)} acreditada!`,
    };
  }

  private async claimMonthly(
    userId: string,
    progressId: string,
    now: Date,
  ) {
    const pool = await this.getPool();
    const amount = calcMonthlyReward(toNumber(pool.balance));
    if (amount == null) {
      throw new BadRequestException(
        'Pozo de misiones insuficiente (mínimo $25). Misión pausada.',
      );
    }

    // Debitar pozo
    const updated = await this.prisma.missionPool.update({
      where: { id: 'main' },
      data: {
        balance: { decrement: amount },
        lifetimeOut: { increment: amount },
      },
    });
    if (toNumber(updated.balance) < -0.01) {
      await this.prisma.missionPool.update({
        where: { id: 'main' },
        data: {
          balance: { increment: amount },
          lifetimeOut: { decrement: amount },
        },
      });
      throw new BadRequestException('Pozo insuficiente al reclamar');
    }

    await this.prisma.userMissionProgress.update({
      where: { id: progressId },
      data: {
        status: MissionProgressStatus.CLAIMED,
        claimedAt: now,
        rewardAmount: amount,
      },
    });

    await this.prisma.missionClaim.create({
      data: {
        userId,
        progressId,
        missionType: MissionType.MONTHLY_WINS_35,
        amount,
        source: 'POOL',
      },
    });

    await this.wallet.credit(
      userId,
      amount,
      WalletTxType.MISSION_REWARD,
      `Misión mensual: +$${amount.toFixed(2)} (Pozo)`,
    );

    return {
      ok: true,
      amount,
      missionType: 'MONTHLY_WINS_35' as const,
      source: 'POOL' as const,
      message: `¡Recompensa mensual de $${amount.toFixed(2)} acreditada desde el Pozo!`,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async getPool() {
    return this.prisma.missionPool.upsert({
      where: { id: 'main' },
      create: { id: 'main', balance: 0 },
      update: {},
    });
  }

  private async getDailyBudget(now: Date) {
    const dateKey = dayKey(now);
    return this.prisma.missionDailyBudget.upsert({
      where: { dateKey },
      create: {
        dateKey,
        paidOut: 0,
        cap: MISSION_SMALL_DAILY_CAP,
      },
      update: {},
    });
  }

  /**
   * Public status — availability only. No balance, lifetime, or fee-share.
   */
  async getPoolStatus() {
    const pool = await this.getPool();
    const budget = await this.getDailyBudget(new Date());
    const cap = toNumber(budget.cap);
    const paid = toNumber(budget.paidOut);
    return {
      pool: {
        monthlyMinReward: MONTHLY_REWARD_MIN,
        monthlyMaxReward: MONTHLY_REWARD_MAX,
        canFundMonthly: toNumber(pool.balance) >= MONTHLY_REWARD_MIN,
      },
      smallDaily: {
        dateKey: budget.dateKey,
        utilizationPct:
          cap > 0 ? Math.min(100, Math.round((paid / cap) * 1000) / 10) : 0,
        active: paid < cap - 0.01,
      },
    };
  }
}

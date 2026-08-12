import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  FreeEntryCreditSource,
  FreeEntryCreditStatus,
  ReferralStatus,
  WalletTxType,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import {
  REFERRAL_CREDIT_EXPIRY_DAYS,
  REFERRAL_REWARD_REFERRED_STAKE,
  REFERRAL_REWARD_REFERRER_STAKE,
} from '@trading-duels/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { toNumber } from '../common/utils/decimal';

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  /** Generate a unique short referral code */
  async generateUniqueCode(): Promise<string> {
    for (let i = 0; i < 12; i++) {
      const code = randomBytes(4).toString('hex').toUpperCase();
      const exists = await this.prisma.user.findUnique({
        where: { referralCode: code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    return randomBytes(6).toString('hex').toUpperCase();
  }

  /** Ensure user has a referral code (lazy backfill for older accounts) */
  async ensureReferralCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (user.referralCode) return user.referralCode;
    for (let i = 0; i < 8; i++) {
      const code = await this.generateUniqueCode();
      try {
        const updated = await this.prisma.user.update({
          where: { id: userId },
          data: { referralCode: code },
          select: { referralCode: true },
        });
        return updated.referralCode!;
      } catch {
        /* unique race — retry */
      }
    }
    throw new BadRequestException('Could not allocate referral code');
  }

  /**
   * Attach referral relationship at signup.
   * Silent no-op if code invalid; throws if self-referral.
   */
  async attachOnSignup(referredUserId: string, codeRaw?: string | null) {
    const code = (codeRaw ?? '').trim().toUpperCase();
    if (!code) return null;

    const referrer = await this.prisma.user.findFirst({
      where: {
        referralCode: { equals: code, mode: 'insensitive' },
        isActive: true,
        isBot: false,
        isDemoGuest: false,
      },
      select: { id: true, username: true },
    });
    if (!referrer) {
      this.logger.warn(`Referral code not found: ${code}`);
      return null;
    }
    if (referrer.id === referredUserId) {
      throw new BadRequestException('You cannot refer yourself');
    }

    const existing = await this.prisma.referral.findUnique({
      where: { referredId: referredUserId },
    });
    if (existing) return existing;

    try {
      return await this.prisma.referral.create({
        data: {
          referrerId: referrer.id,
          referredId: referredUserId,
          status: ReferralStatus.PENDING,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Referral attach failed for ${referredUserId}: ${String(err)}`,
      );
      return null;
    }
  }

  /**
   * After a real (non-demo) BR match settles for the referred user:
   * mark REWARDED once and grant free-entry credits to both sides.
   * Idempotent.
   */
  async tryQualifyOnRealMatch(referredUserId: string, matchId: string) {
    const referral = await this.prisma.referral.findUnique({
      where: { referredId: referredUserId },
    });
    if (!referral) return null;
    if (
      referral.status === ReferralStatus.REWARDED ||
      referral.status === ReferralStatus.QUALIFIED
    ) {
      return referral;
    }

    // Atomic claim: only one concurrent settle can transition PENDING → REWARDED
    const claimed = await this.prisma.referral.updateMany({
      where: {
        id: referral.id,
        status: ReferralStatus.PENDING,
      },
      data: {
        status: ReferralStatus.REWARDED,
        qualifyingMatchId: matchId,
        qualifiedAt: new Date(),
        rewardedAt: new Date(),
      },
    });
    if (claimed.count === 0) return referral;

    const expiresAt =
      REFERRAL_CREDIT_EXPIRY_DAYS > 0
        ? new Date(
            Date.now() + REFERRAL_CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
          )
        : null;

    // Referrer: free $5 entry
    const referrerCredit = await this.prisma.freeEntryCredit.create({
      data: {
        userId: referral.referrerId,
        stake: REFERRAL_REWARD_REFERRER_STAKE,
        source: FreeEntryCreditSource.REFERRAL_REFERRER,
        status: FreeEntryCreditStatus.AVAILABLE,
        referralId: referral.id,
        expiresAt,
      },
    });
    await this.wallet.auditOnly(
      referral.referrerId,
      REFERRAL_REWARD_REFERRER_STAKE,
      WalletTxType.FREE_ENTRY_CREDIT,
      `Referral reward: free $${REFERRAL_REWARD_REFERRER_STAKE} entry`,
      {
        referralId: referral.id,
        creditId: referrerCredit.id,
        role: 'referrer',
        matchId,
      },
    );

    // Referred: free $1 entry
    const referredCredit = await this.prisma.freeEntryCredit.create({
      data: {
        userId: referredUserId,
        stake: REFERRAL_REWARD_REFERRED_STAKE,
        source: FreeEntryCreditSource.REFERRAL_REFERRED,
        status: FreeEntryCreditStatus.AVAILABLE,
        referralId: referral.id,
        expiresAt,
      },
    });
    await this.wallet.auditOnly(
      referredUserId,
      REFERRAL_REWARD_REFERRED_STAKE,
      WalletTxType.FREE_ENTRY_CREDIT,
      `Welcome reward: free $${REFERRAL_REWARD_REFERRED_STAKE} entry`,
      {
        referralId: referral.id,
        creditId: referredCredit.id,
        role: 'referred',
        matchId,
      },
    );

    this.logger.log(
      `Referral rewarded · referrer=${referral.referrerId} · referred=${referredUserId} · match=${matchId}`,
    );

    return this.prisma.referral.findUnique({ where: { id: referral.id } });
  }

  /** Expire past-due AVAILABLE credits (best-effort on read) */
  private async expireStaleCredits(userId: string) {
    await this.prisma.freeEntryCredit.updateMany({
      where: {
        userId,
        status: FreeEntryCreditStatus.AVAILABLE,
        expiresAt: { lt: new Date() },
      },
      data: { status: FreeEntryCreditStatus.EXPIRED },
    });
  }

  /**
   * Spend one AVAILABLE free-entry credit for the given stake.
   * Returns the credit id. Throws if none available.
   */
  async spendCredit(
    userId: string,
    stake: number,
    matchId: string,
    playerId: string,
  ): Promise<string> {
    await this.expireStaleCredits(userId);

    const credit = await this.prisma.freeEntryCredit.findFirst({
      where: {
        userId,
        stake,
        status: FreeEntryCreditStatus.AVAILABLE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!credit) {
      throw new BadRequestException(
        `No free $${stake} entry credit available`,
      );
    }

    const updated = await this.prisma.freeEntryCredit.updateMany({
      where: {
        id: credit.id,
        status: FreeEntryCreditStatus.AVAILABLE,
      },
      data: {
        status: FreeEntryCreditStatus.USED,
        usedMatchId: matchId,
        usedPlayerId: playerId,
        usedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Free entry credit already used');
    }

    await this.wallet.auditOnly(
      userId,
      stake,
      WalletTxType.FREE_ENTRY_USE,
      `Used free $${stake} entry credit`,
      { creditId: credit.id, matchId, playerId },
    );

    return credit.id;
  }

  /** Restore credit if user leaves queue before match starts */
  async restoreCredit(creditId: string, userId: string) {
    const credit = await this.prisma.freeEntryCredit.findUnique({
      where: { id: creditId },
    });
    if (!credit || credit.userId !== userId) return;
    if (credit.status !== FreeEntryCreditStatus.USED) return;

    // Don't restore if match already completed (safety)
    if (credit.usedMatchId) {
      const match = await this.prisma.brMatch.findUnique({
        where: { id: credit.usedMatchId },
        select: { status: true },
      });
      if (
        match &&
        (match.status === 'LIVE' ||
          match.status === 'SETTLING' ||
          match.status === 'COMPLETED')
      ) {
        return;
      }
    }

    await this.prisma.freeEntryCredit.update({
      where: { id: creditId },
      data: {
        status: FreeEntryCreditStatus.AVAILABLE,
        usedMatchId: null,
        usedPlayerId: null,
        usedAt: null,
      },
    });
  }

  async hasAvailableCredit(userId: string, stake: number): Promise<boolean> {
    await this.expireStaleCredits(userId);
    const n = await this.prisma.freeEntryCredit.count({
      where: {
        userId,
        stake,
        status: FreeEntryCreditStatus.AVAILABLE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return n > 0;
  }

  async getOverview(userId: string) {
    const code = await this.ensureReferralCode(userId);
    await this.expireStaleCredits(userId);

    const [given, received, credits] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          referred: {
            select: { username: true, displayName: true },
          },
        },
      }),
      this.prisma.referral.findUnique({
        where: { referredId: userId },
        include: {
          referrer: { select: { username: true } },
        },
      }),
      this.prisma.freeEntryCredit.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
    ]);

    const availableCredits = credits.filter(
      (c) => c.status === FreeEntryCreditStatus.AVAILABLE,
    );
    const byStake: Record<string, number> = {};
    for (const c of availableCredits) {
      const k = String(toNumber(c.stake));
      byStake[k] = (byStake[k] ?? 0) + 1;
    }

    return {
      code,
      // Frontend builds full URL with window.location.origin
      path: `/register?ref=${encodeURIComponent(code)}`,
      pitch:
        'Invite a friend. When they play 1 real match, you get a free $5 entry and they get a free $1 entry.',
      rewards: {
        referrerStake: REFERRAL_REWARD_REFERRER_STAKE,
        referredStake: REFERRAL_REWARD_REFERRED_STAKE,
        expiryDays: REFERRAL_CREDIT_EXPIRY_DAYS || null,
      },
      stats: {
        invited: given.length,
        pending: given.filter((r) => r.status === ReferralStatus.PENDING)
          .length,
        qualified: given.filter(
          (r) =>
            r.status === ReferralStatus.QUALIFIED ||
            r.status === ReferralStatus.REWARDED,
        ).length,
      },
      availableCredits: availableCredits.map((c) => ({
        id: c.id,
        stake: toNumber(c.stake),
        source: c.source,
        expiresAt: c.expiresAt?.toISOString() ?? null,
      })),
      availableByStake: byStake,
      credits: credits.map((c) => ({
        id: c.id,
        stake: toNumber(c.stake),
        source: c.source,
        status: c.status,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        usedAt: c.usedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
      referrals: given.map((r) => ({
        id: r.id,
        status: r.status,
        username: r.referred.username,
        displayName: r.referred.displayName,
        createdAt: r.createdAt.toISOString(),
        qualifiedAt: r.qualifiedAt?.toISOString() ?? null,
        rewardedAt: r.rewardedAt?.toISOString() ?? null,
      })),
      referredBy: received
        ? {
            username: received.referrer.username,
            status: received.status,
            createdAt: received.createdAt.toISOString(),
            qualifiedAt: received.qualifiedAt?.toISOString() ?? null,
          }
        : null,
      generatedAt: new Date().toISOString(),
    };
  }

  async findReferrerByCode(code: string) {
    const c = code.trim().toUpperCase();
    if (!c) throw new NotFoundException('Referral code required');
    const user = await this.prisma.user.findFirst({
      where: {
        referralCode: { equals: c, mode: 'insensitive' },
        isActive: true,
      },
      select: { username: true, displayName: true, referralCode: true },
    });
    if (!user) throw new NotFoundException('Referral code not found');
    return {
      code: user.referralCode,
      username: user.username,
      displayName: user.displayName,
    };
  }
}

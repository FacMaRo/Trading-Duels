import { Injectable, NotFoundException } from '@nestjs/common';
import type { DuelMode, User } from '@prisma/client';
import {
  calcWinrate,
  getNextRank,
  getRankForElo,
  rankProgress,
  type LeaderboardEntry,
  type LeaderboardModeFilter,
  type LeaderboardResponse,
  type PublicProfile,
  type PublicProfileDuel,
  type UserPublic,
} from '@trading-duels/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNumber } from '../common/utils/decimal';

const FINISHED = ['COMPLETED', 'DRAW'] as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    email: string;
    username: string;
    displayName?: string;
    passwordHash: string;
    elo?: number;
    isDemoGuest?: boolean;
    isBot?: boolean;
    referralCode?: string;
  }) {
    return this.prisma.user.create({ data });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async getProfile(id: string) {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return this.toPublic(user);
  }

  toPublic(user: User): UserPublic {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      elo: user.elo,
      avatarUrl: user.avatarUrl,
      wins: user.wins,
      losses: user.losses,
      draws: user.draws,
      isPremium: user.isPremium ?? false,
      isDemoGuest: user.isDemoGuest ?? false,
    };
  }

  async setPremium(userId: string, isPremium: boolean) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { isPremium },
    });
    return this.toPublic(user);
  }

  // ─── Leaderboard ─────────────────────────────────────────────────────────

  async getLeaderboard(
    mode: LeaderboardModeFilter = 'GLOBAL',
    limit = 50,
    offset = 0,
  ): Promise<LeaderboardResponse> {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = Math.max(offset, 0);

    if (mode === 'GLOBAL') {
      return this.leaderboardGlobal(take, skip);
    }
    return this.leaderboardByMode(mode, take, skip);
  }

  private async leaderboardGlobal(
    take: number,
    skip: number,
  ): Promise<LeaderboardResponse> {
    const humanWhere = { isActive: true, isBot: false } as const;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: humanWhere,
        orderBy: [{ elo: 'desc' }, { wins: 'desc' }, { username: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          elo: true,
          wins: true,
          losses: true,
          draws: true,
          isPremium: true,
        },
      }),
      this.prisma.user.count({ where: humanWhere }),
    ]);

    const brMap = await this.brStatsForUsers(users.map((u) => u.id));

    const entries: LeaderboardEntry[] = users.map((u, i) => {
      const games = u.wins + u.losses + u.draws;
      const tier = getRankForElo(u.elo);
      const br = brMap.get(u.id);
      return {
        rank: skip + i + 1,
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        elo: u.elo,
        rankTier: tier.id,
        rankLabel: tier.label,
        wins: u.wins,
        losses: u.losses,
        draws: u.draws,
        games,
        winrate: calcWinrate(u.wins, u.losses, u.draws),
        avgR: null,
        isPremium: u.isPremium ?? false,
        brMatches: br?.matches ?? 0,
        brWins: br?.wins ?? 0,
        brTop5: br?.top5 ?? 0,
        brTop5Rate: br?.top5Rate ?? null,
        brAvgRank: br?.avgRank ?? null,
        brPrizeTotal: br?.prizeTotal ?? 0,
      };
    });

    return {
      mode: 'GLOBAL',
      total,
      entries,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Aggregate BR career stats for leaderboard columns */
  private async brStatsForUsers(userIds: string[]): Promise<
    Map<
      string,
      {
        matches: number;
        wins: number;
        top5: number;
        top5Rate: number | null;
        avgRank: number | null;
        prizeTotal: number;
      }
    >
  > {
    const map = new Map<
      string,
      {
        matches: number;
        wins: number;
        top5: number;
        top5Rate: number | null;
        avgRank: number | null;
        prizeTotal: number;
      }
    >();
    if (userIds.length === 0) return map;

    const rows = await this.prisma.brMatchPlayer.findMany({
      where: {
        userId: { in: userIds },
        status: 'SETTLED',
        match: { status: 'COMPLETED', isDemo: false },
      },
      select: {
        userId: true,
        rank: true,
        prizeAmount: true,
      },
    });

    type Acc = {
      matches: number;
      wins: number;
      top5: number;
      rankSum: number;
      prizeTotal: number;
    };
    const acc = new Map<string, Acc>();
    for (const r of rows) {
      const cur = acc.get(r.userId) ?? {
        matches: 0,
        wins: 0,
        top5: 0,
        rankSum: 0,
        prizeTotal: 0,
      };
      cur.matches += 1;
      if (r.rank === 1) cur.wins += 1;
      if (r.rank != null && r.rank <= 5) cur.top5 += 1;
      if (r.rank != null) cur.rankSum += r.rank;
      if (r.prizeAmount != null) cur.prizeTotal += toNumber(r.prizeAmount);
      acc.set(r.userId, cur);
    }

    for (const uid of userIds) {
      const a = acc.get(uid);
      if (!a || a.matches === 0) {
        map.set(uid, {
          matches: 0,
          wins: 0,
          top5: 0,
          top5Rate: null,
          avgRank: null,
          prizeTotal: 0,
        });
        continue;
      }
      map.set(uid, {
        matches: a.matches,
        wins: a.wins,
        top5: a.top5,
        top5Rate: Math.round((a.top5 / a.matches) * 1000) / 10,
        avgRank: Math.round((a.rankSum / a.matches) * 10) / 10,
        prizeTotal: Math.round(a.prizeTotal * 100) / 100,
      });
    }
    return map;
  }

  private async leaderboardByMode(
    mode: Exclude<LeaderboardModeFilter, 'GLOBAL'>,
    take: number,
    skip: number,
  ): Promise<LeaderboardResponse> {
    const duelMode = mode as DuelMode;

    const duels = await this.prisma.duel.findMany({
      where: {
        mode: duelMode,
        status: { in: [...FINISHED] },
        playerBId: { not: null },
      },
      select: {
        playerAId: true,
        playerBId: true,
        winnerId: true,
        status: true,
        totalRA: true,
        totalRB: true,
      },
    });

    type Acc = {
      wins: number;
      losses: number;
      draws: number;
      rSum: number;
      rCount: number;
    };
    const stats = new Map<string, Acc>();

    const bump = (userId: string, patch: Partial<Acc> & { r?: number | null }) => {
      const cur = stats.get(userId) ?? {
        wins: 0,
        losses: 0,
        draws: 0,
        rSum: 0,
        rCount: 0,
      };
      if (patch.wins) cur.wins += patch.wins;
      if (patch.losses) cur.losses += patch.losses;
      if (patch.draws) cur.draws += patch.draws;
      if (patch.r != null && Number.isFinite(patch.r)) {
        cur.rSum += patch.r;
        cur.rCount += 1;
      }
      stats.set(userId, cur);
    };

    for (const d of duels) {
      if (!d.playerBId) continue;
      const rA = d.totalRA != null ? toNumber(d.totalRA) : null;
      const rB = d.totalRB != null ? toNumber(d.totalRB) : null;

      if (d.status === 'DRAW' || !d.winnerId) {
        bump(d.playerAId, { draws: 1, r: rA });
        bump(d.playerBId, { draws: 1, r: rB });
      } else if (d.winnerId === d.playerAId) {
        bump(d.playerAId, { wins: 1, r: rA });
        bump(d.playerBId, { losses: 1, r: rB });
      } else {
        bump(d.playerBId, { wins: 1, r: rB });
        bump(d.playerAId, { losses: 1, r: rA });
      }
    }

    const userIds = [...stats.keys()];
    if (userIds.length === 0) {
      return {
        mode,
        total: 0,
        entries: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true, isBot: false },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        elo: true,
      },
    });

    const rows = users
      .map((u) => {
        const s = stats.get(u.id)!;
        const games = s.wins + s.losses + s.draws;
        const tier = getRankForElo(u.elo);
        return {
          userId: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          elo: u.elo,
          rankTier: tier.id,
          rankLabel: tier.label,
          wins: s.wins,
          losses: s.losses,
          draws: s.draws,
          games,
          winrate: calcWinrate(s.wins, s.losses, s.draws),
          avgR:
            s.rCount > 0
              ? Math.round((s.rSum / s.rCount) * 10000) / 10000
              : null,
        };
      })
      // Principalmente ELO; desempate por rendimiento en el modo
      .sort((a, b) => {
        if (b.elo !== a.elo) return b.elo - a.elo;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.winrate !== a.winrate) return b.winrate - a.winrate;
        return a.username.localeCompare(b.username);
      });

    const total = rows.length;
    const slice = rows.slice(skip, skip + take);
    const entries: LeaderboardEntry[] = slice.map((row, i) => ({
      rank: skip + i + 1,
      ...row,
    }));

    return {
      mode,
      total,
      entries,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Promedio de R en duelos finalizados por usuario */
  private async avgRForUsers(userIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (userIds.length === 0) return map;

    const duels = await this.prisma.duel.findMany({
      where: {
        status: { in: [...FINISHED] },
        OR: [
          { playerAId: { in: userIds } },
          { playerBId: { in: userIds } },
        ],
      },
      select: {
        playerAId: true,
        playerBId: true,
        totalRA: true,
        totalRB: true,
      },
    });

    const acc = new Map<string, { sum: number; n: number }>();
    const add = (uid: string, r: number | null) => {
      if (r == null || !Number.isFinite(r)) return;
      if (!userIds.includes(uid)) return;
      const cur = acc.get(uid) ?? { sum: 0, n: 0 };
      cur.sum += r;
      cur.n += 1;
      acc.set(uid, cur);
    };

    for (const d of duels) {
      add(d.playerAId, d.totalRA != null ? toNumber(d.totalRA) : null);
      if (d.playerBId) {
        add(d.playerBId, d.totalRB != null ? toNumber(d.totalRB) : null);
      }
    }

    for (const [uid, v] of acc) {
      if (v.n > 0) map.set(uid, Math.round((v.sum / v.n) * 10000) / 10000);
    }
    return map;
  }

  // ─── Public profile ──────────────────────────────────────────────────────

  async getPublicProfile(username: string): Promise<PublicProfile> {
    const user = await this.prisma.user.findFirst({
      where: {
        username: { equals: username, mode: 'insensitive' },
        isActive: true,
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const [avgRMap, globalRank, recentDuels, modeStats] = await Promise.all([
      this.avgRForUsers([user.id]),
      this.getGlobalRank(user.id, user.elo),
      this.getRecentDuels(user.id, 20),
      this.getModeBreakdown(user.id),
    ]);

    const tier = getRankForElo(user.elo);
    const next = getNextRank(user.elo);
    const games = user.wins + user.losses + user.draws;

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      elo: user.elo,
      rankTier: tier.id,
      rankLabel: tier.label,
      rankProgress: rankProgress(user.elo),
      nextRankLabel: next?.label ?? null,
      nextRankElo: next?.minElo ?? null,
      wins: user.wins,
      losses: user.losses,
      draws: user.draws,
      games,
      winrate: calcWinrate(user.wins, user.losses, user.draws),
      avgR: avgRMap.get(user.id) ?? null,
      isPremium: user.isPremium ?? false,
      globalRank,
      createdAt: user.createdAt.toISOString(),
      recentDuels,
      byMode: modeStats,
    };
  }

  private async getGlobalRank(_userId: string, elo: number): Promise<number> {
    const higher = await this.prisma.user.count({
      where: { isActive: true, isBot: false, elo: { gt: elo } },
    });
    return higher + 1;
  }

  private async getRecentDuels(
    userId: string,
    limit: number,
  ): Promise<PublicProfileDuel[]> {
    const duels = await this.prisma.duel.findMany({
      where: {
        OR: [{ playerAId: userId }, { playerBId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        playerA: { select: { id: true, username: true } },
        playerB: { select: { id: true, username: true } },
      },
    });

    return duels.map((d) => {
      const isA = d.playerAId === userId;
      const myR =
        isA
          ? d.totalRA != null
            ? toNumber(d.totalRA)
            : null
          : d.totalRB != null
            ? toNumber(d.totalRB)
            : null;
      const opponentR =
        isA
          ? d.totalRB != null
            ? toNumber(d.totalRB)
            : null
          : d.totalRA != null
            ? toNumber(d.totalRA)
            : null;
      const opponent = isA ? d.playerB : d.playerA;

      let result: PublicProfileDuel['result'] = 'ONGOING';
      if (d.status === 'CANCELLED') result = 'CANCELLED';
      else if (d.status === 'DRAW') result = 'DRAW';
      else if (d.status === 'COMPLETED') {
        result = d.winnerId === userId ? 'WIN' : 'LOSS';
      }

      return {
        id: d.id,
        mode: d.mode,
        status: d.status,
        pot: toNumber(d.pot),
        result,
        myR,
        opponentR,
        opponentUsername: opponent?.username ?? null,
        opponentId: opponent?.id ?? null,
        completedAt: d.completedAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      };
    });
  }

  private async getModeBreakdown(userId: string) {
    const modes: DuelMode[] = ['BLITZ', 'NORMAL', 'SLOW'];
    const result = [];

    for (const mode of modes) {
      const duels = await this.prisma.duel.findMany({
        where: {
          mode,
          status: { in: [...FINISHED] },
          OR: [{ playerAId: userId }, { playerBId: userId }],
        },
        select: {
          playerAId: true,
          playerBId: true,
          winnerId: true,
          status: true,
          totalRA: true,
          totalRB: true,
        },
      });

      let wins = 0;
      let losses = 0;
      let draws = 0;
      let rSum = 0;
      let rCount = 0;

      for (const d of duels) {
        const isA = d.playerAId === userId;
        const r = isA
          ? d.totalRA != null
            ? toNumber(d.totalRA)
            : null
          : d.totalRB != null
            ? toNumber(d.totalRB)
            : null;
        if (r != null) {
          rSum += r;
          rCount += 1;
        }
        if (d.status === 'DRAW' || !d.winnerId) draws += 1;
        else if (d.winnerId === userId) wins += 1;
        else losses += 1;
      }

      const games = wins + losses + draws;
      result.push({
        mode,
        games,
        wins,
        losses,
        draws,
        winrate: calcWinrate(wins, losses, draws),
        avgR: rCount > 0 ? Math.round((rSum / rCount) * 10000) / 10000 : null,
      });
    }

    return result;
  }

  async updateEloStats(params: {
    winnerId: string | null;
    playerAId: string;
    playerBId: string;
    eloA: number;
    eloB: number;
    newEloA: number;
    newEloB: number;
    isDraw: boolean;
  }) {
    const { winnerId, playerAId, playerBId, newEloA, newEloB, isDraw } = params;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: playerAId },
        data: {
          elo: newEloA,
          wins: !isDraw && winnerId === playerAId ? { increment: 1 } : undefined,
          losses: !isDraw && winnerId === playerBId ? { increment: 1 } : undefined,
          draws: isDraw ? { increment: 1 } : undefined,
        },
      }),
      this.prisma.user.update({
        where: { id: playerBId },
        data: {
          elo: newEloB,
          wins: !isDraw && winnerId === playerBId ? { increment: 1 } : undefined,
          losses: !isDraw && winnerId === playerAId ? { increment: 1 } : undefined,
          draws: isDraw ? { increment: 1 } : undefined,
        },
      }),
    ]);
  }
}

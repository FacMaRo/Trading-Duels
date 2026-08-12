import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WalletTxStatus, WalletTxType } from '@prisma/client';
import {
  MIN_DEPOSIT_USD,
  MIN_WITHDRAWAL_USD,
  roundMoney,
} from '@trading-duels/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toNumber } from '../common/utils/decimal';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  createForUser(userId: string) {
    return this.prisma.wallet.create({
      data: { userId, balance: 0, lockedBalance: 0 },
    });
  }

  async getByUserId(userId: string) {
    return this.prisma.wallet.findUnique({ where: { userId } });
  }

  async getSnapshot(userId: string) {
    const wallet = await this.getByUserId(userId);
    if (!wallet) throw new NotFoundException('Wallet no encontrada');
    const balance = toNumber(wallet.balance);
    const lockedBalance = toNumber(wallet.lockedBalance);
    return {
      balance,
      lockedBalance,
      availableBalance: roundMoney(balance - lockedBalance),
    };
  }

  async deposit(userId: string, amount: number) {
    if (amount < MIN_DEPOSIT_USD) {
      throw new BadRequestException(
        `Depósito mínimo: $${MIN_DEPOSIT_USD}`,
      );
    }
    return this.credit(userId, amount, WalletTxType.DEPOSIT, 'Depósito');
  }

  async withdraw(userId: string, amount: number) {
    if (amount < MIN_WITHDRAWAL_USD) {
      throw new BadRequestException(
        `Retiro mínimo: $${MIN_WITHDRAWAL_USD}`,
      );
    }
    const snap = await this.getSnapshot(userId);
    if (snap.availableBalance < amount) {
      throw new BadRequestException('Saldo insuficiente');
    }
    return this.debit(userId, amount, WalletTxType.WITHDRAWAL, 'Retiro');
  }

  /** Bloquea stake para un duelo */
  async lockStake(userId: string, amount: number, duelId: string) {
    const snap = await this.getSnapshot(userId);
    if (snap.availableBalance < amount) {
      throw new BadRequestException('Saldo insuficiente para el stake');
    }

    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });

    const newLocked = roundMoney(toNumber(wallet.lockedBalance) + amount);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: newLocked },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.DUEL_STAKE,
          status: WalletTxStatus.COMPLETED,
          amount,
          balanceAfter: updated.balance,
          duelId,
          description: `Stake bloqueado: $${amount}`,
        },
      });
      return updated;
    });
  }

  /** Incrementa el locked balance (raise accept) debitando disponible */
  async increaseLockedStake(
    userId: string,
    extraAmount: number,
    duelId: string,
  ) {
    if (extraAmount <= 0) return this.getByUserId(userId);
    const snap = await this.getSnapshot(userId);
    if (snap.availableBalance < extraAmount) {
      throw new BadRequestException(
        'Saldo insuficiente para la subida de apuesta',
      );
    }
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });
    const newLocked = roundMoney(toNumber(wallet.lockedBalance) + extraAmount);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: newLocked },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.DUEL_STAKE,
          status: WalletTxStatus.COMPLETED,
          amount: extraAmount,
          balanceAfter: updated.balance,
          duelId,
          description: `Raise: +$${extraAmount} bloqueados`,
        },
      });
      return updated;
    });
  }

  /** Libera stake (cancel / refund) y opcionalmente acredita premio */
  async settleDuelPayout(params: {
    winnerId: string | null;
    playerAId: string;
    playerBId: string;
    stakeA: number;
    stakeB: number;
    winnerPrize: number;
    platformFee: number;
    duelId: string;
    isDraw: boolean;
  }) {
    const {
      winnerId,
      playerAId,
      playerBId,
      stakeA,
      stakeB,
      winnerPrize,
      platformFee,
      duelId,
      isDraw,
    } = params;

    await this.unlockAndDebitStake(playerAId, stakeA, duelId);
    await this.unlockAndDebitStake(playerBId, stakeB, duelId);

    if (isDraw || !winnerId) {
      // Empate total: reembolso de stakes (sin fee, o fee split — MVP reembolsa full)
      await this.credit(
        playerAId,
        stakeA,
        WalletTxType.DUEL_REFUND,
        'Reembolso por empate',
        duelId,
      );
      await this.credit(
        playerBId,
        stakeB,
        WalletTxType.DUEL_REFUND,
        'Reembolso por empate',
        duelId,
      );
      return;
    }

    await this.credit(
      winnerId,
      winnerPrize,
      WalletTxType.DUEL_WIN,
      `Premio duelo (fee plataforma $${platformFee})`,
      duelId,
    );
  }

  private async unlockAndDebitStake(
    userId: string,
    stake: number,
    duelId: string,
  ) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });
    const balance = toNumber(wallet.balance);
    const locked = toNumber(wallet.lockedBalance);
    const newBalance = roundMoney(balance - stake);
    const newLocked = roundMoney(Math.max(0, locked - stake));

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance, lockedBalance: newLocked },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.DUEL_STAKE,
          status: WalletTxStatus.COMPLETED,
          amount: -stake,
          balanceAfter: updated.balance,
          duelId,
          description: `Stake consumido: $${stake}`,
        },
      });
    });
  }

  async credit(
    userId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    duelId?: string,
  ) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });
    const newBalance = roundMoney(toNumber(wallet.balance) + amount);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type,
          status: WalletTxStatus.COMPLETED,
          amount,
          balanceAfter: updated.balance,
          duelId,
          description,
        },
      });
      return updated;
    });
  }

  /**
   * Ledger-only row (no balance change). Used for free-entry vouchers
   * that are not withdrawable cash.
   */
  async auditOnly(
    userId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    metadata?: object,
  ) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });
    return this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type,
        status: WalletTxStatus.COMPLETED,
        amount,
        balanceAfter: wallet.balance,
        description,
        ...(metadata != null
          ? { metadata: metadata as object }
          : {}),
      },
    });
  }

  async debit(
    userId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    duelId?: string,
  ) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });
    const balance = toNumber(wallet.balance);
    const locked = toNumber(wallet.lockedBalance);
    if (balance - locked < amount) {
      throw new BadRequestException('Saldo insuficiente');
    }
    const newBalance = roundMoney(balance - amount);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type,
          status: WalletTxStatus.COMPLETED,
          amount: -amount,
          balanceAfter: updated.balance,
          duelId,
          description,
        },
      });
      return updated;
    });
  }

  /**
   * Bloquea fondos genéricos (apuestas de espectadores).
   * Usa el mismo lockedBalance que el stake de duelo.
   */
  async lockFunds(
    userId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    duelId?: string,
  ) {
    if (amount <= 0) throw new BadRequestException('Monto inválido');
    const snap = await this.getSnapshot(userId);
    if (snap.availableBalance < amount) {
      throw new BadRequestException('Saldo insuficiente');
    }
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });
    const newLocked = roundMoney(toNumber(wallet.lockedBalance) + amount);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: newLocked },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type,
          status: WalletTxStatus.COMPLETED,
          amount,
          balanceAfter: updated.balance,
          duelId,
          description,
        },
      });
      return updated;
    });
  }

  /** Desbloquea y debita (consume stake bloqueado) */
  async unlockAndConsume(
    userId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    duelId?: string,
  ) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });
    const balance = toNumber(wallet.balance);
    const locked = toNumber(wallet.lockedBalance);
    const newBalance = roundMoney(balance - amount);
    const newLocked = roundMoney(Math.max(0, locked - amount));

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance, lockedBalance: newLocked },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type,
          status: WalletTxStatus.COMPLETED,
          amount: -amount,
          balanceAfter: updated.balance,
          duelId,
          description,
        },
      });
      return updated;
    });
  }

  /** Dev stake bloqueado sin consumir (cancelación de duelo) */
  async refundLockedStake(userId: string, amount: number, duelId: string) {
    return this.unlockFunds(
      userId,
      amount,
      WalletTxType.DUEL_REFUND,
      `Stake liberado (cancelación): $${amount}`,
      duelId,
    );
  }

  /**
   * Libera fondos bloqueados sin debitar balance (cancel cola BR / refund).
   */
  async unlockFunds(
    userId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    duelId?: string,
  ) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { userId },
    });
    const newLocked = roundMoney(
      Math.max(0, toNumber(wallet.lockedBalance) - amount),
    );

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: newLocked },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type,
          status: WalletTxStatus.COMPLETED,
          amount: 0,
          balanceAfter: updated.balance,
          duelId,
          description,
          metadata: undefined,
        },
      });
      return updated;
    });
  }
}

/**
 * Motor de duelos — lógica pura, sin I/O.
 * Estados, validaciones de trades, riesgo y liquidación.
 */

import {
  DUEL_MODE_CONFIG,
  type DuelModeKey,
  PLATFORM_FEE_RATE,
  RAISE_RESPONSE_TIMEOUT_MS,
  VIRTUAL_CAPITAL,
} from './constants';
import type {
  DuelStatus,
  OrderType,
  TradeInput,
  TradeSide,
  TradeStatus,
} from './types';
import {
  calcPnlFromR,
  calcPlatformFee,
  calcRiskAmount,
  calcRMultiple,
  calcWinnerPrize,
  resolveWinner,
  roundMoney,
  roundR,
  validateRaiseAmount,
} from './utils';

// ─── Transiciones de estado ────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<DuelStatus, DuelStatus[]> = {
  WAITING: ['MATCHED', 'CANCELLED'],
  MATCHED: ['PREPARATION', 'CANCELLED'],
  PREPARATION: ['DEVELOPMENT', 'CANCELLED'],
  DEVELOPMENT: ['SETTLING', 'CANCELLED'],
  SETTLING: ['COMPLETED', 'DRAW'],
  COMPLETED: [],
  CANCELLED: [],
  DRAW: [],
};

export function canTransition(from: DuelStatus, to: DuelStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: DuelStatus, to: DuelStatus): void {
  if (!canTransition(from, to)) {
    throw new DuelEngineError(
      `Transición inválida: ${from} → ${to}`,
      'INVALID_TRANSITION',
    );
  }
}

/** Fases en las que se puede abrir/cerrar trades */
export function isTradingPhase(status: DuelStatus): boolean {
  return status === 'PREPARATION' || status === 'DEVELOPMENT';
}

/** Subidas solo en desarrollo */
export function canProposeRaise(status: DuelStatus): boolean {
  return status === 'DEVELOPMENT';
}

// ─── Temporizadores ────────────────────────────────────────────────────────

export interface PhaseTimers {
  prepSeconds: number;
  developSeconds: number;
  prepEndsAt: Date;
  developEndsAt: Date;
}

export function createPhaseTimers(
  mode: DuelModeKey,
  from: Date = new Date(),
): PhaseTimers {
  const cfg = DUEL_MODE_CONFIG[mode];
  const prepEndsAt = new Date(from.getTime() + cfg.prepSeconds * 1000);
  const developEndsAt = new Date(
    prepEndsAt.getTime() + cfg.developSeconds * 1000,
  );
  return {
    prepSeconds: cfg.prepSeconds,
    developSeconds: cfg.developSeconds,
    prepEndsAt,
    developEndsAt,
  };
}

export function getRemainingMs(endsAt: Date | string, now = new Date()): number {
  const end = typeof endsAt === 'string' ? new Date(endsAt) : endsAt;
  return Math.max(0, end.getTime() - now.getTime());
}

export function isPhaseExpired(endsAt: Date | string, now = new Date()): boolean {
  return getRemainingMs(endsAt, now) <= 0;
}

// ─── Validación de trades ──────────────────────────────────────────────────

export interface PlayerTradeContext {
  tradeCount: number;
  totalRiskUsedPct: number;
  openTradeIds: string[];
}

export interface ValidateTradeResult {
  ok: true;
  riskAmount: number;
  riskPct: number;
}

export interface ValidateTradeError {
  ok: false;
  code: string;
  message: string;
}

export function validateTradeOpen(
  mode: DuelModeKey,
  status: DuelStatus,
  player: PlayerTradeContext,
  input: TradeInput,
): ValidateTradeResult | ValidateTradeError {
  if (!isTradingPhase(status)) {
    return {
      ok: false,
      code: 'PHASE_LOCKED',
      message: 'Solo se pueden abrir trades en preparación o desarrollo',
    };
  }

  const cfg = DUEL_MODE_CONFIG[mode];

  if (player.tradeCount >= cfg.maxTrades) {
    return {
      ok: false,
      code: 'MAX_TRADES',
      message: `Máximo ${cfg.maxTrades} trades en modo ${cfg.label}`,
    };
  }

  if (input.riskPct <= 0) {
    return {
      ok: false,
      code: 'INVALID_RISK',
      message: 'El riesgo debe ser mayor a 0%',
    };
  }

  const newTotalRisk = player.totalRiskUsedPct + input.riskPct;
  if (newTotalRisk > cfg.maxTotalRiskPct + 1e-9) {
    return {
      ok: false,
      code: 'MAX_RISK',
      message: `Riesgo total máximo ${cfg.maxTotalRiskPct}% (usado ${player.totalRiskUsedPct.toFixed(2)}%)`,
    };
  }

  if (input.orderType === 'LIMIT' && (input.entryPrice == null || input.entryPrice <= 0)) {
    return {
      ok: false,
      code: 'LIMIT_PRICE_REQUIRED',
      message: 'Las órdenes limit requieren precio de entrada',
    };
  }

  if (input.stopLoss <= 0) {
    return {
      ok: false,
      code: 'SL_REQUIRED',
      message: 'Stop Loss es obligatorio',
    };
  }

  // Validar dirección del SL respecto al side (para market usamos precio ref si hay)
  if (input.orderType === 'LIMIT' && input.entryPrice != null) {
    const slOk = isStopLossValid(input.side, input.entryPrice, input.stopLoss);
    if (!slOk) {
      return {
        ok: false,
        code: 'INVALID_SL',
        message:
          input.side === 'LONG'
            ? 'En LONG el stop loss debe estar por debajo del entry'
            : 'En SHORT el stop loss debe estar por encima del entry',
      };
    }
    if (input.takeProfit != null) {
      const tpOk = isTakeProfitValid(
        input.side,
        input.entryPrice,
        input.takeProfit,
      );
      if (!tpOk) {
        return {
          ok: false,
          code: 'INVALID_TP',
          message:
            input.side === 'LONG'
              ? 'En LONG el take profit debe estar por encima del entry'
              : 'En SHORT el take profit debe estar por debajo del entry',
        };
      }
    }
  }

  return {
    ok: true,
    riskAmount: calcRiskAmount(input.riskPct),
    riskPct: input.riskPct,
  };
}

export function isStopLossValid(
  side: TradeSide,
  entry: number,
  stopLoss: number,
): boolean {
  return side === 'LONG' ? stopLoss < entry : stopLoss > entry;
}

export function isTakeProfitValid(
  side: TradeSide,
  entry: number,
  takeProfit: number,
): boolean {
  return side === 'LONG' ? takeProfit > entry : takeProfit < entry;
}

// ─── Activación de limit y hits de SL/TP ───────────────────────────────────

export interface PriceTick {
  bid: number;
  ask: number;
  mid: number;
}

/**
 * ¿Se activa una limit?
 * LONG limit: ask <= entry (compramos al precio o mejor)
 * SHORT limit: bid >= entry
 */
export function shouldActivateLimit(
  side: TradeSide,
  entryPrice: number,
  tick: PriceTick,
): boolean {
  if (side === 'LONG') return tick.ask <= entryPrice;
  return tick.bid >= entryPrice;
}

/**
 * ¿Hit de SL o TP con el tick actual?
 * Usa bid para cerrar LONG, ask para cerrar SHORT (conservador).
 */
export function checkSlTpHit(
  side: TradeSide,
  stopLoss: number,
  takeProfit: number | null | undefined,
  tick: PriceTick,
): 'SL' | 'TP' | null {
  if (side === 'LONG') {
    if (tick.bid <= stopLoss) return 'SL';
    if (takeProfit != null && tick.bid >= takeProfit) return 'TP';
  } else {
    if (tick.ask >= stopLoss) return 'SL';
    if (takeProfit != null && tick.ask <= takeProfit) return 'TP';
  }
  return null;
}

export function exitPriceForClose(
  side: TradeSide,
  reason: 'SL' | 'TP' | 'MARKET' | 'TIME',
  stopLoss: number,
  takeProfit: number | null | undefined,
  tick: PriceTick,
): number {
  if (reason === 'SL') return stopLoss;
  if (reason === 'TP' && takeProfit != null) return takeProfit;
  // Market / time: precio de salida realista
  return side === 'LONG' ? tick.bid : tick.ask;
}

// ─── Cierre y scoring ──────────────────────────────────────────────────────

export interface ClosedTradeScore {
  rMultiple: number;
  pnl: number;
  status: TradeStatus;
}

/** Limit no activada al final → 0R */
export function scoreExpiredLimit(): ClosedTradeScore {
  return { rMultiple: 0, pnl: 0, status: 'EXPIRED' };
}

export function scoreClosedTrade(params: {
  side: TradeSide;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  riskAmount: number;
}): ClosedTradeScore {
  const rMultiple = calcRMultiple({
    side: params.side,
    entryPrice: params.entryPrice,
    exitPrice: params.exitPrice,
    stopLoss: params.stopLoss,
  });
  return {
    rMultiple,
    pnl: calcPnlFromR(rMultiple, params.riskAmount),
    status: 'CLOSED',
  };
}

export interface PlayerScore {
  userId: string;
  totalR: number;
  totalPnl: number;
  tradeCount: number;
}

export function aggregatePlayerScore(
  userId: string,
  trades: Array<{ rMultiple: number | null; pnl: number | null; status: TradeStatus }>,
): PlayerScore {
  let totalR = 0;
  let totalPnl = 0;
  let tradeCount = 0;

  for (const t of trades) {
    if (t.status === 'CANCELLED') continue;
    // PENDING al liquidar se trata como EXPIRED (0R) — el caller debe haber convertido
    if (t.rMultiple != null) totalR += t.rMultiple;
    if (t.pnl != null) totalPnl += t.pnl;
    tradeCount += 1;
  }

  return {
    userId,
    totalR: roundR(totalR),
    totalPnl: roundMoney(totalPnl),
    tradeCount,
  };
}

export interface SettlementResult {
  winnerId: string | null;
  isDraw: boolean;
  pot: number;
  platformFee: number;
  winnerPrize: number;
  playerA: PlayerScore;
  playerB: PlayerScore;
}

export function settleDuel(params: {
  playerAId: string;
  playerBId: string;
  stakeA: number;
  stakeB: number;
  tradesA: Array<{ rMultiple: number | null; pnl: number | null; status: TradeStatus }>;
  tradesB: Array<{ rMultiple: number | null; pnl: number | null; status: TradeStatus }>;
}): SettlementResult {
  const pot = roundMoney(params.stakeA + params.stakeB);
  const platformFee = calcPlatformFee(pot);
  const winnerPrize = calcWinnerPrize(pot);

  const playerA = aggregatePlayerScore(params.playerAId, params.tradesA);
  const playerB = aggregatePlayerScore(params.playerBId, params.tradesB);

  const winnerId = resolveWinner({
    playerAId: params.playerAId,
    playerBId: params.playerBId,
    aR: playerA.totalR,
    bR: playerB.totalR,
    aPnl: playerA.totalPnl,
    bPnl: playerB.totalPnl,
  });

  return {
    winnerId,
    isDraw: winnerId == null,
    pot,
    platformFee,
    winnerPrize,
    playerA,
    playerB,
  };
}

// ─── Subidas de apuesta ────────────────────────────────────────────────────

export interface RaiseValidationOk {
  ok: true;
  expiresAt: Date;
}

export interface RaiseValidationErr {
  ok: false;
  code: string;
  message: string;
}

export function validateRaiseProposal(params: {
  status: DuelStatus;
  mode: DuelModeKey;
  raisesUsedByProposer: number;
  currentStake: number;
  newStake: number;
  hasPendingRaise: boolean;
  now?: Date;
}): RaiseValidationOk | RaiseValidationErr {
  if (!canProposeRaise(params.status)) {
    return {
      ok: false,
      code: 'RAISE_PHASE',
      message: 'Las subidas solo están permitidas en la fase de desarrollo',
    };
  }

  if (params.hasPendingRaise) {
    return {
      ok: false,
      code: 'RAISE_PENDING',
      message: 'Ya hay una subida pendiente de respuesta',
    };
  }

  const maxRaises = DUEL_MODE_CONFIG[params.mode].maxRaises;
  if (params.raisesUsedByProposer >= maxRaises) {
    return {
      ok: false,
      code: 'MAX_RAISES',
      message: `Máximo ${maxRaises} subidas en este modo`,
    };
  }

  const amountCheck = validateRaiseAmount(params.currentStake, params.newStake);
  if (!amountCheck.ok) {
    return {
      ok: false,
      code: 'RAISE_AMOUNT',
      message: amountCheck.message,
    };
  }

  const now = params.now ?? new Date();
  return {
    ok: true,
    expiresAt: new Date(now.getTime() + RAISE_RESPONSE_TIMEOUT_MS),
  };
}

// ─── Helpers de configuración ──────────────────────────────────────────────

export function getModeConfig(mode: DuelModeKey) {
  return DUEL_MODE_CONFIG[mode];
}

export function getVirtualCapital(): number {
  return VIRTUAL_CAPITAL;
}

export function getPlatformFeeRate(): number {
  return PLATFORM_FEE_RATE;
}

// ─── Error tipado ──────────────────────────────────────────────────────────

export class DuelEngineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DuelEngineError';
  }
}

// ─── Simulación de entry market ────────────────────────────────────────────

export function marketEntryPrice(side: TradeSide, tick: PriceTick): number {
  // LONG paga ask, SHORT vende al bid
  return side === 'LONG' ? tick.ask : tick.bid;
}

export function validateMarketSlTp(
  side: TradeSide,
  entry: number,
  stopLoss: number,
  takeProfit?: number | null,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!isStopLossValid(side, entry, stopLoss)) {
    return {
      ok: false,
      code: 'INVALID_SL',
      message:
        side === 'LONG'
          ? 'On LONG, stop loss must be below the entry price'
          : 'On SHORT, stop loss must be above the entry price',
    };
  }
  if (takeProfit != null && !isTakeProfitValid(side, entry, takeProfit)) {
    return {
      ok: false,
      code: 'INVALID_TP',
      message:
        side === 'LONG'
          ? 'On LONG, take profit must be above the entry price'
          : 'On SHORT, take profit must be below the entry price',
    };
  }
  return { ok: true };
}

export type { OrderType };

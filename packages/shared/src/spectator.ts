export type SpectatorBetStatus =
  | 'OPEN'
  | 'MATCHED'
  | 'SETTLED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface SpectatorBetView {
  id: string;
  duelId: string;
  proposerId: string;
  proposerUsername: string;
  acceptorId: string | null;
  acceptorUsername: string | null;
  /** userId del jugador del duelo por el que apuesta el proponente */
  pickUserId: string;
  pickUsername: string;
  /** Lado contrario (para quien acepta) */
  counterPickUserId: string;
  counterPickUsername: string;
  amount: number;
  pot: number | null;
  platformFee: number | null;
  winnerPrize: number | null;
  status: SpectatorBetStatus;
  winnerSpectatorId: string | null;
  matchedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  /** Si el viewer puede aceptar esta oferta */
  canAccept?: boolean;
  isMine?: boolean;
}

export interface LiveDuelCard {
  id: string;
  mode: string;
  status: string;
  primaryAsset: string | null;
  pot: number;
  playerA: { userId: string; username: string; totalR: number };
  playerB: { userId: string; username: string; totalR: number } | null;
  phaseEndsAt: string | null;
  openBets: number;
  spectatorFriendly: boolean;
  createdAt: string;
}

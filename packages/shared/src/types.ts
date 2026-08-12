import type {
  AssetSymbol,
  ChartTimeframe,
  DuelModeKey,
  SlowSessionWindow,
} from './constants';

// ─── Enums de dominio (espejo de Prisma) ───────────────────────────────────

export type UserRole = 'USER' | 'ADMIN';

export type DuelStatus =
  | 'WAITING' // esperando rival / en cola
  | 'MATCHED' // match hecho, apostando / confirmando
  | 'PREPARATION' // fase de preparación
  | 'DEVELOPMENT' // fase de desarrollo (trading activo)
  | 'SETTLING' // cierre de posiciones y cálculo
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DRAW'; // empate sin desempate aplicable (raro)

export type MatchType = 'AUTO' | 'OPEN_CHALLENGE' | 'DIRECT';

export type TradeSide = 'LONG' | 'SHORT';

export type TradeStatus =
  | 'PENDING' // limit no activada
  | 'OPEN'
  | 'CLOSED'
  | 'CANCELLED'
  | 'EXPIRED'; // limit no tocada → 0R

export type OrderType = 'MARKET' | 'LIMIT';

export type RaiseStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'RE_RAISED'
  | 'EXPIRED';

export type WalletTxType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'DUEL_STAKE'
  | 'DUEL_WIN'
  | 'DUEL_REFUND'
  | 'PLATFORM_FEE'
  | 'ADJUSTMENT';

export type WalletTxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

// ─── DTOs de dominio ───────────────────────────────────────────────────────

export interface UserPublic {
  id: string;
  username: string;
  displayName: string | null;
  elo: number;
  avatarUrl: string | null;
  wins: number;
  losses: number;
  draws: number;
  /** Plan Premium (9,99 €/mes) */
  isPremium: boolean;
  /** Sesión demo sin registro (nickname) */
  isDemoGuest?: boolean;
}

export type LeaderboardModeFilter = 'GLOBAL' | 'BLITZ' | 'NORMAL' | 'SLOW';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  elo: number;
  rankTier: string;
  rankLabel: string;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  winrate: number;
  /** @deprecated Prefer BR metrics below */
  avgR: number | null;
  isPremium?: boolean;
  /** Battle Royale completed matches */
  brMatches?: number;
  /** #1 finishes in BR */
  brWins?: number;
  /** Top 5 finishes in BR */
  brTop5?: number;
  /** Top 5 rate % (0–100) */
  brTop5Rate?: number | null;
  /** Average finish rank in BR (lower better) */
  brAvgRank?: number | null;
  /** Total BR prize $ won */
  brPrizeTotal?: number;
}

export interface LeaderboardResponse {
  mode: LeaderboardModeFilter;
  total: number;
  entries: LeaderboardEntry[];
  generatedAt: string;
}

export interface PublicProfileDuel {
  id: string;
  mode: string;
  status: string;
  pot: number;
  result: 'WIN' | 'LOSS' | 'DRAW' | 'CANCELLED' | 'ONGOING';
  myR: number | null;
  opponentR: number | null;
  opponentUsername: string | null;
  opponentId: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  elo: number;
  rankTier: string;
  rankLabel: string;
  rankProgress: number;
  nextRankLabel: string | null;
  nextRankElo: number | null;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  winrate: number;
  avgR: number | null;
  isPremium: boolean;
  /** Posición global por ELO (1-based), null si no ranking */
  globalRank: number | null;
  createdAt: string;
  recentDuels: PublicProfileDuel[];
  byMode: Array<{
    mode: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    winrate: number;
    avgR: number | null;
  }>;
}

export interface WalletSnapshot {
  balance: number;
  lockedBalance: number;
  availableBalance: number;
}

export interface TradeInput {
  asset: AssetSymbol;
  side: TradeSide;
  orderType: OrderType;
  entryPrice?: number; // required for LIMIT
  stopLoss: number;
  takeProfit?: number | null;
  riskPct: number; // % del capital virtual
}

export interface TradeResult {
  id: string;
  duelId: string;
  userId: string;
  asset: AssetSymbol;
  side: TradeSide;
  orderType: OrderType;
  status: TradeStatus;
  entryPrice: number | null;
  exitPrice: number | null;
  stopLoss: number;
  takeProfit: number | null;
  riskPct: number;
  riskAmount: number;
  rMultiple: number | null;
  pnl: number | null;
  /** SL | TP | MARKET | TIME | EXPIRED */
  closeReason?: string | null;
  openedAt: string | null;
  closedAt: string | null;
}

export interface DuelPlayerState {
  userId: string;
  username: string;
  elo?: number; // oculto en open challenges hasta aceptar
  stake: number;
  totalRiskUsedPct: number;
  tradeCount: number;
  openTrades: number;
  totalR: number;
  totalPnl: number;
  isReady: boolean;
}

export interface DuelStateSnapshot {
  id: string;
  mode: DuelModeKey;
  status: DuelStatus;
  matchType: MatchType;
  sessionWindow?: SlowSessionWindow | null;
  /** Si está definido, el duelo se juega sobre este activo */
  primaryAsset?: AssetSymbol | string | null;
  pot: number;
  platformFee: number;
  winnerPrize: number;
  playerA: DuelPlayerState;
  playerB: DuelPlayerState | null;
  phaseStartedAt: string | null;
  phaseEndsAt: string | null;
  prepEndsAt: string | null;
  developEndsAt: string | null;
  raisesUsed: { [userId: string]: number };
  pendingRaise: PendingRaiseSnapshot | null;
  /** Trades del duelo (ambos jugadores) para la UI de arena */
  trades: TradeResult[];
  /** Si el viewer es jugador o solo espectador */
  viewerRole?: 'PLAYER' | 'SPECTATOR';
  createdAt: string;
}

export interface PendingRaiseSnapshot {
  id: string;
  fromUserId: string;
  toUserId: string;
  previousStake: number;
  proposedStake: number;
  expiresAt: string;
  status: RaiseStatus;
}

export interface MatchmakingTicket {
  userId: string;
  mode: DuelModeKey;
  stake: number;
  elo: number;
  assetFilter?: AssetSymbol[];
  sessionWindow?: SlowSessionWindow;
  enqueuedAt: string;
}

export interface OpenChallengePublic {
  id: string;
  mode: DuelModeKey;
  /** Activo del desafío (visible en lobby) */
  asset: AssetSymbol | string;
  stake: number;
  sessionWindow?: SlowSessionWindow | null;
  /** true si el viewer es el creador (sin revelar identidad a terceros) */
  isMine?: boolean;
  /** ELO y username del creador ocultos hasta aceptar */
  createdAt: string;
  expiresAt?: string | null;
}

// ─── Eventos Socket.io ─────────────────────────────────────────────────────

export type ClientToServerEvents = {
  'matchmaking:join': (payload: {
    mode: DuelModeKey;
    stake: number;
    sessionWindow?: SlowSessionWindow;
  }) => void;
  'matchmaking:leave': () => void;
  'challenge:create': (payload: {
    mode: DuelModeKey;
    stake: number;
    asset: AssetSymbol | string;
    sessionWindow?: SlowSessionWindow;
  }) => void;
  'challenge:accept': (payload: { challengeId: string }) => void;
  'challenge:cancel': (payload: { challengeId: string }) => void;
  'duel:ready': (payload: { duelId: string }) => void;
  'duel:subscribe': (payload: { duelId: string }) => void;
  'duel:unsubscribe': (payload: { duelId: string }) => void;
  'trade:open': (payload: { duelId: string; trade: TradeInput }) => void;
  'trade:close': (payload: { duelId: string; tradeId: string }) => void;
  'trade:cancel': (payload: { duelId: string; tradeId: string }) => void;
  'raise:propose': (payload: { duelId: string; newStake: number }) => void;
  'raise:respond': (payload: {
    duelId: string;
    raiseId: string;
    action: 'ACCEPT' | 'REJECT' | 'RE_RAISE';
    newStake?: number;
  }) => void;
  'chart:timeframe': (payload: {
    duelId: string;
    timeframe: ChartTimeframe;
    asset?: AssetSymbol | string;
  }) => void;
  /** Suscripción a stream de precios de un activo (gráfico / feed) */
  'market:subscribe': (payload: { asset: string }) => void;
  'market:unsubscribe': (payload: { asset: string }) => void;
  /** Chat del duelo */
  'duel:chat': (payload: { duelId: string; message: string }) => void;
  /** Espectador: suscribirse en modo lectura */
  'duel:spectate': (payload: { duelId: string }) => void;
  'spectator_bet:create': (payload: {
    duelId: string;
    pickUserId: string;
    amount: number;
  }) => void;
  'spectator_bet:accept': (payload: { duelId: string; betId: string }) => void;
  'spectator_bet:cancel': (payload: { duelId: string; betId: string }) => void;
};

export type ServerToClientEvents = {
  'matchmaking:queued': (payload: { position: number; eloRange: number }) => void;
  'matchmaking:matched': (payload: { duelId: string }) => void;
  'matchmaking:error': (payload: { message: string }) => void;
  'challenge:created': (payload: OpenChallengePublic) => void;
  'challenge:list': (payload: OpenChallengePublic[]) => void;
  'challenge:matched': (payload: { duelId: string }) => void;
  'duel:state': (payload: DuelStateSnapshot) => void;
  'duel:phase': (payload: {
    duelId: string;
    status: DuelStatus;
    phaseEndsAt: string | null;
  }) => void;
  'duel:trade': (payload: TradeResult) => void;
  'duel:trade_update': (payload: TradeResult) => void;
  'duel:raise': (payload: PendingRaiseSnapshot) => void;
  'duel:raise_result': (payload: {
    raiseId: string;
    status: RaiseStatus;
    pot: number;
  }) => void;
  'duel:finished': (payload: {
    duelId: string;
    winnerId: string | null;
    playerA: { totalR: number; totalPnl: number };
    playerB: { totalR: number; totalPnl: number };
    pot: number;
    platformFee: number;
    winnerPrize: number;
  }) => void;
  'duel:error': (payload: { message: string; code?: string }) => void;
  'duel:chat_message': (payload: {
    duelId: string;
    userId: string;
    username: string;
    message: string;
    ts: number;
  }) => void;
  'spectator_bet:update': (payload: unknown) => void;
  'spectator_bet:list': (payload: unknown[]) => void;
  'price:tick': (payload: {
    asset: AssetSymbol;
    bid: number;
    ask: number;
    mid: number;
    ts: number;
  }) => void;
  'wallet:update': (payload: WalletSnapshot) => void;
};

// ─── Auth ──────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  role: UserRole;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: string;
}

export interface RegisterDto {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

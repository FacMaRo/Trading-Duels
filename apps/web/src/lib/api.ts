/** Public API origin (no trailing slash, no /api). Baked in at build time. */
function resolveApiBase(): string {
  let url = (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  if (url.endsWith('/api')) url = url.slice(0, -4);
  if (!url) {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      if (host !== 'localhost' && host !== '127.0.0.1') {
        console.error(
          '[api] NEXT_PUBLIC_API_URL is missing. Set it on the WEB service and rebuild.',
        );
      }
    }
    return 'http://localhost:3001';
  }
  return url;
}

const API_URL = resolveApiBase();

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('td_token');
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem('td_token', token);
  else localStorage.removeItem('td_token');
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  // Auth uses Bearer token in localStorage — no cookies.
  // credentials:'omit' avoids CORS credential preflight edge cases on Railway.
  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    method: options.method || 'GET',
    headers,
    credentials: 'omit',
    mode: 'cors',
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'message' in data
        ? Array.isArray((data as { message: unknown }).message)
          ? ((data as { message: string[] }).message).join(', ')
          : String((data as { message: string }).message)
        : `Error ${res.status}`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

export const authApi = {
  register: (body: {
    email: string;
    username: string;
    password: string;
    displayName?: string;
    referralCode?: string;
  }) =>
    api<{
      user: UserDto;
      accessToken: string;
      expiresIn: string;
    }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  login: (body: { email: string; password: string }) =>
    api<{
      user: UserDto;
      accessToken: string;
      expiresIn: string;
    }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  me: () =>
    api<{ user: UserDto; wallet: WalletDto | null }>('/auth/me'),

  /** Guest DEMO: solo nickname */
  demo: (nickname: string) =>
    api<{
      user: UserDto;
      accessToken: string;
      expiresIn: string;
    }>('/auth/demo', {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    }),
};

/** Toggle Premium (dev / sin pasarela) */
export const premiumApi = {
  set: (isPremium: boolean) =>
    api<UserDto>('/users/me/premium', {
      method: 'PATCH',
      body: JSON.stringify({ isPremium }),
    }),
};

export const walletApi = {
  get: () => api<WalletDto>('/wallet'),
  deposit: (amount: number) =>
    api('/wallet/deposit', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  withdraw: (amount: number) =>
    api('/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
};

/** Battle Royale API */
export const brApi = {
  joinQueue: (body: {
    stake: number;
    asset: string;
    useFreeEntry?: boolean;
    useFreeEntryCredit?: boolean;
  }) =>
    api<BrQueueSnapshot>('/br/queue', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  joinDemoQueue: (body: { asset: string }) =>
    api<BrQueueSnapshot>('/br/demo/queue', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  leaveQueue: () =>
    api<{ ok: boolean }>('/br/queue/leave', { method: 'POST' }),
  freeEntry: () => api<BrFreeEntryStatus>('/br/free-entry'),
  me: () => api<BrQueueSnapshot | BrMatchSnapshot | null>('/br/me'),
  getMatch: (id: string) => api<BrMatchSnapshot>(`/br/matches/${id}`),
  history: () => api<BrHistoryResponse>('/br/history'),
  stats: () => api<BrStatsResponse>('/br/stats'),
  chatHistory: (matchId: string) =>
    api<BrChatMessage[]>(`/br/matches/${matchId}/chat`),
  postChat: (matchId: string, body: string) =>
    api<BrChatMessage>(`/br/matches/${matchId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  openTrade: (matchId: string, trade: BrTradeBody) =>
    api<BrTradeDto>(`/br/matches/${matchId}/trades`, {
      method: 'POST',
      body: JSON.stringify({ trade }),
    }),
  closeTrade: (matchId: string, tradeId: string) =>
    api(`/br/matches/${matchId}/trades/${tradeId}/close`, {
      method: 'POST',
    }),
  cancelTrade: (matchId: string, tradeId: string) =>
    api(`/br/matches/${matchId}/trades/${tradeId}/cancel`, {
      method: 'POST',
    }),
  /** Edit SL / TP on open or pending trade */
  updateTradeLevels: (
    matchId: string,
    tradeId: string,
    body: { stopLoss: number; takeProfit?: number | null },
  ) =>
    api<BrTradeDto>(`/br/matches/${matchId}/trades/${tradeId}/levels`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** DEMO only: force settlement */
  forceEnd: (matchId: string) =>
    api<BrMatchSnapshot>(`/br/matches/${matchId}/force-end`, {
      method: 'POST',
    }),
};

export interface BrChatMessage {
  id: string;
  matchId: string;
  userId: string;
  username: string;
  isPremium: boolean;
  body: string;
  createdAt: string;
}

/** Entrada gratis semanal Premium — semana ISO UTC + referral credits */
export interface BrFreeEntryStatus {
  isPremium: boolean;
  available: boolean;
  stakeOnly: number;
  weekKey: string;
  usedAt: string | null;
  daysUntilNext: number;
  nextAvailableAt: string | null;
  timezone: string;
  credits?: {
    availableByStake: Record<string, number>;
    availableCredits: Array<{
      id: string;
      stake: number;
      source: string;
      expiresAt: string | null;
    }>;
  };
}

export interface ReferralOverviewDto {
  code: string;
  path: string;
  pitch: string;
  rewards: {
    referrerStake: number;
    referredStake: number;
    expiryDays: number | null;
  };
  stats: {
    invited: number;
    pending: number;
    qualified: number;
  };
  availableCredits: Array<{
    id: string;
    stake: number;
    source: string;
    expiresAt: string | null;
  }>;
  availableByStake: Record<string, number>;
  credits: Array<{
    id: string;
    stake: number;
    source: string;
    status: string;
    expiresAt: string | null;
    usedAt: string | null;
    createdAt: string;
  }>;
  referrals: Array<{
    id: string;
    status: string;
    username: string;
    displayName: string | null;
    createdAt: string;
    qualifiedAt: string | null;
    rewardedAt: string | null;
  }>;
  referredBy: {
    username: string;
    status: string;
    createdAt: string;
    qualifiedAt: string | null;
  } | null;
  generatedAt: string;
}

export const referralsApi = {
  me: () => api<ReferralOverviewDto>('/referrals/me'),
  byCode: (code: string) =>
    api<{
      code: string | null;
      username: string;
      displayName: string | null;
    }>(`/referrals/code/${encodeURIComponent(code)}`),
};

export interface BrHistoryResponse {
  isPremium: boolean;
  limit: number;
  totalShown: number;
  truncated: boolean;
  matches: Array<{
    matchId: string;
    asset: string;
    stake: number;
    playerCount: number;
    rank: number | null;
    totalPnl: number;
    prizeAmount: number;
    tradeCount: number;
    settledAt: string | null;
    startedAt: string | null;
  }>;
}

export interface BrStatsResponse {
  isPremium: boolean;
  games: number;
  wins: number;
  top5: number;
  top5Rate: number;
  totalPrize: number;
  avgPnl: number;
  avgRank: number;
  advanced: {
    totalPnl: number;
    bestFinish: number | null;
    bestTop5Streak: number;
    profitFactor: number | null;
    byAsset: Array<{
      asset: string;
      games: number;
      top5: number;
      avgPnl: number;
      prizeTotal?: number;
    }>;
    byStake?: Array<{
      stake: number;
      games: number;
      top5: number;
      avgPnl: number;
      prizeTotal: number;
    }>;
    recentForm?: Array<{
      rank: number | null;
      pnl: number;
      prize: number;
      asset: string;
      stake: number;
    }>;
  } | null;
  upgradeHint: string | null;
}

export interface BrTradeBody {
  side: 'LONG' | 'SHORT';
  orderType: 'MARKET' | 'LIMIT';
  entryPrice?: number;
  stopLoss: number;
  takeProfit?: number | null;
  riskPct: number;
}

export interface BrTradeDto {
  id: string;
  matchId: string;
  userId: string;
  asset: string;
  side: string;
  orderType: string;
  status: string;
  entryPrice: number | null;
  exitPrice: number | null;
  stopLoss: number;
  takeProfit: number | null;
  riskPct: number;
  riskAmount: number;
  rMultiple: number | null;
  pnl: number | null;
  closeReason?: string | null;
  openedAt: string | null;
  closedAt: string | null;
}

export type BrPrizeZone = 'PRIZE' | 'REFUND' | 'OUT';

export interface BrPrizeStructureDto {
  playerCount: number;
  stake: number;
  pot: number;
  platformFee: number;
  prizePool: number;
  strongCount: number;
  refundFrom: number | null;
  refundTo: number | null;
  refundSlots: number;
  refundReserve: number;
  strongPool: number;
  footer: string;
  prizeLine: string;
  refundLine: string;
  payouts: Array<{ rank: number; kind: 'PRIZE' | 'REFUND'; amount: number }>;
}

export interface BrQueueSnapshot {
  phase: 'queue';
  matchId: string;
  status: string;
  asset: string;
  stake: number;
  isDemo?: boolean;
  demoBotsEnabled?: boolean;
  playerCount: number;
  maxPlayers: number;
  minPlayers: number;
  pot: number;
  prizePool: number;
  countdownEndsAt: string | null;
  premiumCount?: number;
  priorityNote?: string;
  prizeStructure?: BrPrizeStructureDto;
  players: {
    username: string;
    joinedAt: string;
    isPremium?: boolean;
    isBot?: boolean;
  }[];
  me?: { userId: string; inQueue: boolean; isPremium?: boolean } | null;
}

export interface BrLeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  isPremium?: boolean;
  isBot?: boolean;
  totalPnl: number;
  tradeCount: number;
  openTrades: number;
  prizeAmount: number | null;
  zone?: BrPrizeZone;
  isMe: boolean;
}

export interface BrMatchSnapshot {
  phase: 'match';
  matchId: string;
  status: string;
  asset: string;
  stake: number;
  isDemo?: boolean;
  demoBotsEnabled?: boolean;
  playerCount: number;
  maxPlayers: number;
  pot: number;
  platformFee: number;
  prizePool: number;
  prizeStructure?: BrPrizeStructureDto;
  liveStartedAt: string | null;
  liveEndsAt: string | null;
  settledAt: string | null;
  countdownEndsAt: string | null;
  leaderboard: BrLeaderboardRow[];
  me: BrLeaderboardRow | null;
  myStats: {
    virtualCapital: number;
    totalRiskUsedPct: number;
    tradeCount: number;
    maxTrades: number;
    maxRiskPct: number;
    openTrades: number;
  } | null;
  trades: BrTradeDto[];
}

/** @deprecated 1v1 — disabled */
export const matchmakingApi = {
  joinQueue: () =>
    Promise.reject(new Error('1v1 disabled — use Battle Royale')),
  leaveQueue: () => Promise.reject(new Error('1v1 disabled')),
  listChallenges: () => Promise.resolve([] as ChallengeDto[]),
  createChallenge: () => Promise.reject(new Error('1v1 disabled')),
  acceptChallenge: () => Promise.reject(new Error('1v1 disabled')),
  cancelChallenge: () => Promise.reject(new Error('1v1 disabled')),
};

export const duelsApi = {
  list: () => api<DuelListItem[]>('/duels'),
  listLive: () => api<LiveDuelCardDto[]>('/duels/live'),
  get: (id: string) => api<DuelSnapshot>('/duels/' + id),
  ready: (id: string) => api<DuelSnapshot>(`/duels/${id}/ready`, { method: 'POST' }),
  openTrade: (id: string, trade: TradeBody) =>
    api(`/duels/${id}/trades`, {
      method: 'POST',
      body: JSON.stringify({ trade }),
    }),
  closeTrade: (id: string, tradeId: string) =>
    api(`/duels/${id}/trades/${tradeId}/close`, { method: 'POST' }),
  cancelTrade: (id: string, tradeId: string) =>
    api(`/duels/${id}/trades/${tradeId}/cancel`, { method: 'POST' }),
  proposeRaise: (id: string, newStake: number) =>
    api(`/duels/${id}/raises`, {
      method: 'POST',
      body: JSON.stringify({ newStake }),
    }),
  respondRaise: (
    id: string,
    raiseId: string,
    action: 'ACCEPT' | 'REJECT' | 'RE_RAISE',
    newStake?: number,
  ) =>
    api(`/duels/${id}/raises/${raiseId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action, newStake }),
    }),
};

export const marketApi = {
  candles: (asset: string, tf = '1m', count = 120) =>
    api<CandleDto[]>(
      `/market/candles/${asset}?tf=${tf}&count=${count}`,
    ),
  prices: () => api<PriceTickDto[]>('/market/prices'),
  price: (asset: string) =>
    api<PriceTickDto>(`/market/prices/${encodeURIComponent(asset)}`),
};

export type LeaderboardMode = 'GLOBAL' | 'BLITZ' | 'NORMAL' | 'SLOW';

export const leaderboardApi = {
  get: (mode: LeaderboardMode = 'GLOBAL', limit = 50, offset = 0) =>
    api<LeaderboardResponse>(
      `/leaderboard?mode=${mode}&limit=${limit}&offset=${offset}`,
    ),
};

export const profileApi = {
  byUsername: (username: string) =>
    api<PublicProfileDto>(
      `/profile/${encodeURIComponent(username)}`,
    ),
  byId: (id: string) => api<PublicProfileDto>(`/users/${id}`),
};

export type MissionTypeId =
  | 'DAILY_WINS_6'
  | 'WEEKLY_WINS_18'
  | 'STREAK_5'
  | 'MONTHLY_WINS_35';

export type MissionUiStatus =
  | 'IN_PROGRESS'
  | 'CLAIMABLE'
  | 'CLAIMED'
  | 'PAUSED_DAILY_CAP'
  | 'PAUSED_POOL'
  | 'COOLDOWN';

export interface MissionViewDto {
  type: MissionTypeId;
  category: 'SMALL' | 'BIG';
  title: string;
  description: string;
  progress: number;
  target: number;
  progressPct: number;
  rewardLabel: string;
  rewardAmount: number | null;
  status: MissionUiStatus;
  statusMessage: string | null;
  periodKey: string;
  periodLabel: string;
  minStake: number;
  canClaim: boolean;
  cooldownEndsAt: string | null;
}

export interface MissionsOverviewDto {
  smallMissionsActive: boolean;
  /** 0–100; no raw daily $ exposed */
  smallDailyUtilizationPct: number;
  pool: {
    monthlyMinReward: number;
    monthlyMaxReward: number;
    canFundMonthly: boolean;
  };
  missions: MissionViewDto[];
  generatedAt: string;
}

export const missionsApi = {
  overview: () => api<MissionsOverviewDto>('/missions'),
  pool: () =>
    api<{
      pool: MissionsOverviewDto['pool'];
      smallDaily: {
        dateKey: string;
        utilizationPct: number;
        active: boolean;
      };
    }>('/missions/pool'),
  claim: (missionType: MissionTypeId) =>
    api<{
      ok: boolean;
      amount: number;
      missionType: string;
      source: string;
      message: string;
    }>('/missions/claim', {
      method: 'POST',
      body: JSON.stringify({ missionType }),
    }),
};

export interface UserDto {
  id: string;
  username: string;
  displayName: string | null;
  elo: number;
  avatarUrl: string | null;
  wins: number;
  losses: number;
  draws: number;
  isPremium: boolean;
  isDemoGuest?: boolean;
}

export interface LeaderboardEntryDto {
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
  avgR: number | null;
  isPremium?: boolean;
  brMatches?: number;
  brWins?: number;
  brTop5?: number;
  brTop5Rate?: number | null;
  brAvgRank?: number | null;
  brPrizeTotal?: number;
}

export interface LeaderboardResponse {
  mode: LeaderboardMode;
  total: number;
  entries: LeaderboardEntryDto[];
  generatedAt: string;
}

export interface PublicProfileDuelDto {
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

export interface PublicProfileDto {
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
  globalRank: number | null;
  createdAt: string;
  recentDuels: PublicProfileDuelDto[];
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

export interface WalletDto {
  balance: number;
  lockedBalance: number;
  availableBalance: number;
}

export interface ChallengeDto {
  id: string;
  mode: string;
  asset: string;
  stake: number;
  sessionWindow?: string | null;
  /** Creador oculto; solo se indica si es tuyo */
  isMine?: boolean;
  createdAt: string;
  expiresAt?: string | null;
}

export interface DuelListItem {
  id: string;
  mode: string;
  status: string;
  pot: string | number;
  createdAt: string;
  playerA: { id: string; username: string; elo: number };
  playerB: { id: string; username: string; elo: number } | null;
  winnerId: string | null;
}

export interface LiveDuelCardDto {
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

export interface SpectatorBetDto {
  id: string;
  duelId: string;
  proposerId: string;
  proposerUsername: string;
  acceptorId: string | null;
  acceptorUsername: string | null;
  pickUserId: string;
  pickUsername: string;
  counterPickUserId: string;
  counterPickUsername: string;
  amount: number;
  pot: number | null;
  platformFee: number | null;
  winnerPrize: number | null;
  status: string;
  winnerSpectatorId: string | null;
  matchedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  canAccept?: boolean;
  isMine?: boolean;
}

export const spectatorBetsApi = {
  list: (duelId: string) =>
    api<SpectatorBetDto[]>(`/duels/${duelId}/bets`),
  create: (duelId: string, body: { pickUserId: string; amount: number }) =>
    api<SpectatorBetDto>(`/duels/${duelId}/bets`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  accept: (duelId: string, betId: string) =>
    api<SpectatorBetDto>(`/duels/${duelId}/bets/${betId}/accept`, {
      method: 'POST',
    }),
  cancel: (duelId: string, betId: string) =>
    api<SpectatorBetDto>(`/duels/${duelId}/bets/${betId}/cancel`, {
      method: 'POST',
    }),
};

export interface DuelSnapshot {
  id: string;
  mode: string;
  status: string;
  matchType: string;
  primaryAsset?: string | null;
  viewerRole?: 'PLAYER' | 'SPECTATOR';
  pot: number;
  platformFee: number;
  winnerPrize: number;
  playerA: PlayerState;
  playerB: PlayerState | null;
  phaseEndsAt: string | null;
  prepEndsAt: string | null;
  developEndsAt: string | null;
  raisesUsed: Record<string, number>;
  pendingRaise: {
    id: string;
    fromUserId: string;
    toUserId: string;
    previousStake: number;
    proposedStake: number;
    expiresAt: string;
    status: string;
  } | null;
  trades?: ArenaTradeDto[];
  createdAt: string;
}

export interface ArenaTradeDto {
  id: string;
  duelId: string;
  userId: string;
  asset: string;
  side: 'LONG' | 'SHORT' | string;
  orderType: string;
  status: string;
  entryPrice: number | null;
  exitPrice: number | null;
  stopLoss: number;
  takeProfit: number | null;
  riskPct: number;
  riskAmount: number;
  rMultiple: number | null;
  pnl: number | null;
  closeReason?: string | null;
  openedAt: string | null;
  closedAt: string | null;
}

export interface PlayerState {
  userId: string;
  username: string;
  elo?: number;
  stake: number;
  totalRiskUsedPct: number;
  tradeCount: number;
  openTrades: number;
  totalR: number;
  totalPnl: number;
  isReady: boolean;
}

export interface TradeBody {
  asset: string;
  side: 'LONG' | 'SHORT';
  orderType: 'MARKET' | 'LIMIT';
  entryPrice?: number;
  stopLoss: number;
  takeProfit?: number | null;
  riskPct: number;
}

export interface CandleDto {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PriceTickDto {
  asset: string;
  bid: number;
  ask: number;
  mid: number;
  ts: number;
}

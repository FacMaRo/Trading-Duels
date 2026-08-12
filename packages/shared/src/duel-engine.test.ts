/**
 * Tests manuales / jest-ready del motor de duelos.
 * Ejecutar con: npx ts-node packages/shared/src/duel-engine.test.ts
 * (o integrar en jest cuando se añada)
 */

import {
  calcRMultiple,
  calcPlatformFee,
  calcWinnerPrize,
  resolveWinner,
  settleDuel,
  validateRaiseAmount,
  validateTradeOpen,
  canTransition,
  scoreExpiredLimit,
} from './index';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

console.log('Duel engine tests\n');

// R-múltiplo LONG: entry 100, SL 90, exit 120 → risk 10, pnl 20 → 2R
assert(
  calcRMultiple({
    side: 'LONG',
    entryPrice: 100,
    exitPrice: 120,
    stopLoss: 90,
  }) === 2,
  'LONG +2R',
);

// SHORT: entry 100, SL 110, exit 80 → risk 10, pnl 20 → 2R
assert(
  calcRMultiple({
    side: 'SHORT',
    entryPrice: 100,
    exitPrice: 80,
    stopLoss: 110,
  }) === 2,
  'SHORT +2R',
);

// Fee 10%
assert(calcPlatformFee(100) === 10, 'platform fee 10%');
assert(calcWinnerPrize(100) === 90, 'winner prize 90%');

// Desempate por R
assert(
  resolveWinner({
    playerAId: 'a',
    playerBId: 'b',
    aR: 1.5,
    bR: 1.2,
    aPnl: 100,
    bPnl: 500,
  }) === 'a',
  'winner by R',
);

// Empate R → mayor PnL
assert(
  resolveWinner({
    playerAId: 'a',
    playerBId: 'b',
    aR: 1,
    bR: 1,
    aPnl: 50,
    bPnl: 80,
  }) === 'b',
  'winner by absolute profit on R tie',
);

// Limit expirada = 0R
assert(scoreExpiredLimit().rMultiple === 0, 'expired limit is 0R');

// Raise > 10%
assert(validateRaiseAmount(100, 110).ok === false, 'raise exactly +10% rejected');
assert(validateRaiseAmount(100, 111).ok === true, 'raise >10% accepted');

// Max trades blitz
const maxTrades = validateTradeOpen(
  'BLITZ',
  'DEVELOPMENT',
  { tradeCount: 2, totalRiskUsedPct: 0, openTradeIds: [] },
  {
    asset: 'EURUSD',
    side: 'LONG',
    orderType: 'MARKET',
    stopLoss: 1.0,
    riskPct: 1,
  },
);
assert(maxTrades.ok === false, 'blitz max 2 trades');

// Transiciones
assert(canTransition('PREPARATION', 'DEVELOPMENT'), 'prep → develop');
assert(!canTransition('COMPLETED', 'DEVELOPMENT'), 'no reopen completed');

// Settlement
const settlement = settleDuel({
  playerAId: 'a',
  playerBId: 'b',
  stakeA: 50,
  stakeB: 50,
  tradesA: [{ rMultiple: 1.5, pnl: 1500, status: 'CLOSED' }],
  tradesB: [{ rMultiple: 0.5, pnl: 500, status: 'CLOSED' }],
});
assert(settlement.winnerId === 'a', 'settlement winner A');
assert(settlement.pot === 100, 'pot = 100');
assert(settlement.platformFee === 10, 'fee = 10');
assert(settlement.winnerPrize === 90, 'prize = 90');

console.log('\nAll tests passed.');

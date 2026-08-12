'use client';

import { useEffect, useState } from 'react';
import { duelsApi, type TradeBody } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  PriceInput,
  parsePrice,
  validateStopLossSide,
  validateTakeProfitSide,
} from '@/components/ui/price-input';
import { cn } from '@/lib/utils';

interface TradeFormProps {
  duelId: string;
  disabled?: boolean;
  maxRiskLeft: number;
  tradesLeft: number;
  /** Fixed match asset (required in arena) */
  asset: string;
  /** Current mid for SL/TP side validation on market orders */
  livePrice?: number | null;
  onOpened?: () => void;
}

export function TradeForm({
  duelId,
  disabled,
  maxRiskLeft,
  tradesLeft,
  asset,
  livePrice,
  onOpened,
}: TradeFormProps) {
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [riskPct, setRiskPct] = useState('1');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Clear error when side / key fields change
  useEffect(() => {
    setError('');
  }, [side, orderType]);

  async function submit() {
    setError('');

    const sl = parsePrice(stopLoss);
    if (sl == null) {
      setError('Invalid stop loss. Enter the exact price (e.g. 1.08450).');
      return;
    }

    const tpRaw = takeProfit.trim();
    let tp: number | null = null;
    if (tpRaw) {
      tp = parsePrice(tpRaw);
      if (tp == null) {
        setError(
          'Invalid take profit. Enter the exact price or leave empty.',
        );
        return;
      }
    }

    let entry: number | undefined;
    if (orderType === 'LIMIT') {
      const e = parsePrice(entryPrice);
      if (e == null) {
        setError('Invalid entry. Enter the exact limit price.');
        return;
      }
      entry = e;
    }

    // Reference for SL/TP side validation:
    // LIMIT → entry; MARKET → live mid (if available)
    const ref =
      orderType === 'LIMIT' && entry != null
        ? entry
        : livePrice != null && Number.isFinite(livePrice) && livePrice > 0
          ? livePrice
          : null;

    if (ref != null) {
      const slCheck = validateStopLossSide(side, sl, ref);
      if (!slCheck.ok) {
        setError(slCheck.message);
        return;
      }
      if (tp != null) {
        const tpCheck = validateTakeProfitSide(side, tp, ref);
        if (!tpCheck.ok) {
          setError(tpCheck.message);
          return;
        }
      }
    }

    const risk = parsePrice(riskPct);
    if (risk == null || risk <= 0) {
      setError('Invalid risk %');
      return;
    }

    setLoading(true);
    try {
      const trade: TradeBody = {
        asset,
        side,
        orderType,
        stopLoss: sl,
        riskPct: risk,
        takeProfit: tp,
      };
      if (orderType === 'LIMIT' && entry != null) {
        trade.entryPrice = entry;
      }
      await duelsApi.openTrade(duelId, trade);
      setStopLoss('');
      setTakeProfit('');
      setEntryPrice('');
      onOpened?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    !disabled &&
    !loading &&
    tradesLeft > 0 &&
    stopLoss.trim().length > 0 &&
    (orderType !== 'LIMIT' || entryPrice.trim().length > 0);

  const slHint =
    side === 'LONG' ? 'Below entry' : 'Above entry';
  const tpHint =
    side === 'LONG' ? 'Above entry' : 'Below entry';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="label-caps">New order</h3>
        <div className="flex gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="rounded border border-border bg-secondary/40 px-1.5 py-0.5">
            {tradesLeft} left
          </span>
          <span className="rounded border border-border bg-secondary/40 px-1.5 py-0.5">
            {maxRiskLeft.toFixed(1)}% risk
          </span>
        </div>
      </div>

      <div className="flex h-9 items-center rounded-md border border-border bg-secondary/40 px-3 font-mono text-sm font-semibold text-foreground">
        {asset}
        <span className="label-caps ml-auto">Fixed</span>
      </div>

      {livePrice != null && Number.isFinite(livePrice) && livePrice > 0 && (
        <p className="font-mono text-[11px] text-muted-foreground">
          Current mid:{' '}
          <span className="text-primary">{formatHint(livePrice)}</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setSide('LONG')}
          className={cn(
            'h-9 rounded-md text-xs font-bold tracking-wide transition-colors',
            side === 'LONG'
              ? 'bg-success text-success-foreground'
              : 'border border-border bg-transparent text-muted-foreground hover:border-success/40 hover:text-success',
          )}
        >
          LONG
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setSide('SHORT')}
          className={cn(
            'h-9 rounded-md text-xs font-bold tracking-wide transition-colors',
            side === 'SHORT'
              ? 'bg-destructive text-destructive-foreground'
              : 'border border-border bg-transparent text-muted-foreground hover:border-destructive/40 hover:text-destructive',
          )}
        >
          SHORT
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {(['MARKET', 'LIMIT'] as const).map((ot) => (
          <button
            key={ot}
            type="button"
            disabled={disabled}
            onClick={() => setOrderType(ot)}
            className={cn(
              'h-8 rounded-md text-[11px] font-semibold transition-colors',
              orderType === ot
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary/50',
            )}
          >
            {ot}
          </button>
        ))}
      </div>

      {orderType === 'LIMIT' && (
        <Field label="Entry">
          <PriceInput
            className="h-8 text-sm"
            value={entryPrice}
            onChange={setEntryPrice}
            disabled={disabled}
            placeholder="1.08500"
            name="entry-price"
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Stop Loss *" hint={slHint}>
          <PriceInput
            className="h-8 text-sm"
            value={stopLoss}
            onChange={setStopLoss}
            disabled={disabled}
            placeholder="1.08450"
            name="stop-loss"
          />
        </Field>
        <Field label="Take Profit" hint={tpHint}>
          <PriceInput
            className="h-8 text-sm"
            value={takeProfit}
            onChange={setTakeProfit}
            disabled={disabled}
            placeholder="opt."
            name="take-profit"
          />
        </Field>
      </div>

      <Field label="Risk % of capital">
        <PriceInput
          className="h-8 text-sm"
          value={riskPct}
          onChange={setRiskPct}
          disabled={disabled}
          placeholder="1"
          name="risk-pct"
        />
      </Field>

      {error && (
        <p className="rounded bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      )}

      <Button
        type="button"
        className={cn(
          'w-full font-semibold',
          side === 'LONG' ? 'bg-success hover:bg-success/90' : '',
          side === 'SHORT' ? 'bg-destructive hover:bg-destructive/90' : '',
        )}
        disabled={!canSubmit}
        onClick={submit}
      >
        {loading
          ? 'Submitting…'
          : `Open ${side} ${orderType === 'LIMIT' ? 'Limit' : 'Market'}`}
      </Button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        {hint && (
          <span className="text-[9px] text-muted-foreground/80">{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function formatHint(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 10) return n.toFixed(3);
  return n.toFixed(5);
}

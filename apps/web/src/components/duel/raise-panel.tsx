'use client';

import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatUsd } from '@/lib/utils';
import { MODE_MAX_RAISES } from '@/lib/arena';

interface RaisePanelProps {
  mode: string;
  currentStake: number;
  raisesUsed: number;
  disabled?: boolean;
  busy?: boolean;
  onPropose: (newStake: number) => void;
}

export function RaisePanel({
  mode,
  currentStake,
  raisesUsed,
  disabled,
  busy,
  onPropose,
}: RaisePanelProps) {
  const maxRaises = MODE_MAX_RAISES[mode] ?? 3;
  const minStake = Math.ceil(currentStake * 1.1 * 100) / 100 + 0.01;
  const [amount, setAmount] = useState('');

  const left = Math.max(0, maxRaises - raisesUsed);

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5" />
          Raise stake
        </h3>
        <span className="font-mono text-[10px] text-muted-foreground">
          {left}/{maxRaises} raises
        </span>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Min. &gt; +10% of stake ({formatUsd(currentStake)} → &gt;{' '}
        {formatUsd(currentStake * 1.1)})
      </p>
      <div className="flex gap-2">
        <Input
          type="number"
          step="0.01"
          min={minStake}
          placeholder={String(Math.ceil(minStake))}
          className="h-9 font-mono"
          value={amount}
          disabled={disabled || left <= 0}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button
          className="shrink-0"
          disabled={disabled || busy || left <= 0 || !amount}
          onClick={() => onPropose(Number(amount))}
        >
          Raise
        </Button>
      </div>
    </div>
  );
}

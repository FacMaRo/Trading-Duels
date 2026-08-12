'use client';

import { useState } from 'react';
import { Check, ChevronRight, Plus, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatUsd } from '@/lib/utils';
import {
  LOBBY_MODES,
  SESSIONS,
  STAKE_PRESETS,
  type LobbyMode,
  type SessionWindow,
} from '@/lib/lobby';

const ASSETS = [
  { symbol: 'EURUSD', group: 'Forex' },
  { symbol: 'GBPUSD', group: 'Forex' },
  { symbol: 'USDJPY', group: 'Forex' },
  { symbol: 'AUDUSD', group: 'Forex' },
  { symbol: 'USDCAD', group: 'Forex' },
  { symbol: 'USDCHF', group: 'Forex' },
  { symbol: 'NAS100', group: 'Indices' },
  { symbol: 'US30', group: 'Indices' },
  { symbol: 'SPX500', group: 'Indices' },
  { symbol: 'XAUUSD', group: 'Metals' },
  { symbol: 'BTCUSD', group: 'Crypto' },
  { symbol: 'ETHUSD', group: 'Crypto' },
] as const;

interface CreateChallengePanelProps {
  available: number;
  busy: boolean;
  onCreate: (params: {
    mode: LobbyMode;
    asset: string;
    stake: number;
    sessionWindow?: SessionWindow;
  }) => Promise<void>;
  onCreated?: () => void;
}

/** 1 mode · 2 asset · 3 stake · 4 publish */
type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: 'Mode',
  2: 'Asset',
  3: 'Stake',
  4: 'Publish',
};

export function CreateChallengePanel({
  available,
  busy,
  onCreate,
  onCreated,
}: CreateChallengePanelProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<LobbyMode>('NORMAL');
  const [asset, setAsset] = useState('EURUSD');
  const [stake, setStake] = useState(10);
  const [session, setSession] = useState<SessionWindow>('LONDON');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  function reset() {
    setStep(1);
    setMode('NORMAL');
    setAsset('EURUSD');
    setStake(10);
    setSession('LONDON');
    setError('');
    setSuccess(false);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function publish() {
    setError('');
    if (stake < 1) {
      setError('Minimum stake $1');
      return;
    }
    if (stake > available) {
      setError('Insufficient balance');
      return;
    }
    if (!asset) {
      setError('Select an asset');
      return;
    }
    try {
      await onCreate({
        mode,
        asset,
        stake,
        sessionWindow: mode === 'SLOW' ? session : undefined,
      });
      setSuccess(true);
      onCreated?.();
      setTimeout(() => close(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish');
    }
  }

  if (!open) {
    return (
      <Button
        variant="secondary"
        className="w-full sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4" />
        Create challenge
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-panel animate-slide-up">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="label-caps mb-1">New challenge</p>
          <h3 className="text-lg font-semibold tracking-tight">
            Publish to lobby
          </h3>
        </div>
        <button
          type="button"
          onClick={close}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="mb-5 flex items-center gap-1.5 overflow-x-auto pb-1">
        {([1, 2, 3, 4] as Step[]).map((s) => (
          <div key={s} className="flex shrink-0 items-center gap-1.5">
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
                step === s
                  ? 'bg-primary text-primary-foreground'
                  : step > s
                    ? 'bg-success/20 text-success'
                    : 'bg-secondary text-muted-foreground',
              )}
            >
              {step > s ? <Check className="h-3.5 w-3.5" /> : s}
            </div>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              {STEP_LABELS[s]}
            </span>
            {s < 4 && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
            )}
          </div>
        ))}
      </div>

      {success ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="h-6 w-6" />
          </div>
          <p className="font-semibold text-success">Challenge published</p>
          <p className="text-xs text-muted-foreground">
            {mode} · {asset} · {formatUsd(stake)} · identity hidden
          </p>
        </div>
      ) : (
        <>
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Choose the match pace.
              </p>
              <div className="grid gap-2">
                {LOBBY_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    className={cn(
                      'flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all',
                      mode === m.id
                        ? m.ring + ' ring-1'
                        : 'border-border hover:bg-secondary/40',
                    )}
                  >
                    <div>
                      <p className={cn('font-bold', mode === m.id && m.accent)}>
                        {m.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {m.tagline} · {m.duration}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              {mode === 'SLOW' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {SESSIONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSession(s.id)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-xs font-semibold',
                        session === s.id
                          ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-border text-muted-foreground',
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
              <Button className="w-full" onClick={() => setStep(2)}>
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Match asset. Both players trade this pair only.
              </p>
              <div className="grid max-h-[240px] grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4">
                {ASSETS.map((a) => (
                  <button
                    key={a.symbol}
                    type="button"
                    onClick={() => setAsset(a.symbol)}
                    className={cn(
                      'rounded-lg border px-2 py-2.5 text-center transition-all',
                      asset === a.symbol
                        ? 'border-primary bg-primary/15 ring-1 ring-primary/40'
                        : 'border-border hover:bg-secondary/40',
                    )}
                  >
                    <p className="font-mono text-xs font-bold">{a.symbol}</p>
                    <p className="text-[9px] text-muted-foreground">{a.group}</p>
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep(1)}
                >
                  Back
                </Button>
                <Button className="flex-1" onClick={() => setStep(3)}>
                  Continue
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Challenge stake. Available: {formatUsd(available)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STAKE_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setStake(p)}
                    className={cn(
                      'min-w-[3rem] rounded-md border px-2.5 py-1.5 font-mono text-xs font-semibold',
                      stake === p
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:bg-secondary',
                    )}
                  >
                    ${p}
                  </button>
                ))}
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted-foreground">
                  $
                </span>
                <Input
                  type="number"
                  min={1}
                  value={stake}
                  onChange={(e) => setStake(Number(e.target.value))}
                  className="h-11 pl-7 font-mono text-base"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep(2)}
                >
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={stake < 1 || stake > available}
                  onClick={() => setStep(4)}
                >
                  Continue
                </Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Summary
                </p>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Mode</dt>
                    <dd className="font-semibold">{mode}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Asset</dt>
                    <dd className="font-mono font-semibold text-primary">
                      {asset}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Stake</dt>
                    <dd className="font-mono font-semibold">
                      {formatUsd(stake)}
                    </dd>
                  </div>
                  {mode === 'SLOW' && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Session</dt>
                      <dd className="font-semibold">{session}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Privacy</dt>
                    <dd className="text-xs text-primary">
                      ELO and name hidden
                    </dd>
                  </div>
                </dl>
              </div>
              {error && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep(3)}
                  disabled={busy}
                >
                  Back
                </Button>
                <Button
                  className="flex-1 font-bold"
                  disabled={busy}
                  onClick={publish}
                >
                  <Rocket className="h-4 w-4" />
                  {busy ? 'Publishing…' : 'Publish'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

'use client';

import { Loader2, Radar, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ASSETS } from '@/lib/arena';
import { cn, formatUsd } from '@/lib/utils';
import {
  LOBBY_MODES,
  SESSIONS,
  STAKE_PRESETS,
  estimateWaitLabel,
  formatSearchElapsed,
  type LobbyMode,
  type SessionWindow,
} from '@/lib/lobby';

interface MatchmakingPanelProps {
  mode: LobbyMode;
  stake: number;
  asset: string;
  session: SessionWindow;
  available: number;
  queuing: boolean;
  searchElapsedMs: number;
  eloRange: number;
  busy: boolean;
  error: string;
  onModeChange: (m: LobbyMode) => void;
  onStakeChange: (n: number) => void;
  onAssetChange: (a: string) => void;
  onSessionChange: (s: SessionWindow) => void;
  onSearch: () => void;
  onCancel: () => void;
}

export function MatchmakingPanel({
  mode,
  stake,
  asset,
  session,
  available,
  queuing,
  searchElapsedMs,
  eloRange,
  busy,
  error,
  onModeChange,
  onStakeChange,
  onAssetChange,
  onSessionChange,
  onSearch,
  onCancel,
}: MatchmakingPanelProps) {
  const insufficient = stake > available + 1e-9;
  const invalidStake = !Number.isFinite(stake) || stake < 1;
  const invalidAsset = !(ASSETS as readonly string[]).includes(asset);

  return (
    <section className="rounded-lg border border-border bg-card shadow-panel">
      <div className="space-y-6 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label-caps mb-2 flex items-center gap-1.5">
              <Radar className="h-3 w-3 text-primary" />
              Matchmaking
            </p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-[1.35rem]">
              Find opponent
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Matched by ELO. Range expands if search takes longer.
            </p>
          </div>
          <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-right">
            <p className="label-caps">Available</p>
            <p className="mono-num mt-0.5 text-sm font-semibold">
              {formatUsd(available)}
            </p>
          </div>
        </div>

        <div>
          <p className="label-caps mb-2">Mode</p>
          <div className="grid grid-cols-3 gap-2">
            {LOBBY_MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={queuing}
                  onClick={() => onModeChange(m.id)}
                  className={cn(
                    'rounded-md border px-2.5 py-3 text-left transition-colors sm:px-3',
                    active
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-border bg-secondary/20 hover:bg-secondary/50',
                    queuing && 'opacity-50',
                  )}
                >
                  <p
                    className={cn(
                      'text-sm font-semibold',
                      active ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    {m.label}
                  </p>
                  <p className="mt-0.5 hidden text-[11px] text-muted-foreground sm:block">
                    {m.duration}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="label-caps mb-2">Asset</p>
          <select
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 font-mono text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            value={asset}
            disabled={queuing}
            onChange={(e) => onAssetChange(e.target.value)}
          >
            {ASSETS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[12px] text-muted-foreground">
            Both trade this asset only. Fixed for the match.
          </p>
        </div>

        {mode === 'SLOW' && (
          <div>
            <p className="label-caps mb-2">Opening session</p>
            <div className="flex flex-wrap gap-2">
              {SESSIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={queuing}
                  onClick={() => onSessionChange(s.id)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    session === s.id
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {s.label}
                  <span className="ml-1 font-normal opacity-60">{s.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="label-caps mb-2">Stake</p>
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {STAKE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={queuing}
                onClick={() => onStakeChange(p)}
                className={cn(
                  'min-w-[3rem] rounded-md border px-2.5 py-1.5 font-mono text-xs font-medium transition-colors',
                  stake === p
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                ${p}
              </button>
            ))}
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
              $
            </span>
            <Input
              type="number"
              min={1}
              step={1}
              disabled={queuing}
              value={stake}
              onChange={(e) => onStakeChange(Number(e.target.value))}
              className="h-11 pl-7 font-mono text-base"
            />
          </div>
          {insufficient && (
            <p className="mt-2 text-xs text-destructive">
              Insufficient balance for this stake.
            </p>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {queuing ? (
          <div className="space-y-4 rounded-md border border-border bg-secondary/30 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-card">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Finding opponent…</p>
                <p className="mono-num text-xs text-muted-foreground">
                  {formatSearchElapsed(searchElapsedMs)} · ±{eloRange} ELO ·{' '}
                  {estimateWaitLabel(eloRange)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              <span className="rounded border border-border bg-card px-2 py-1">
                {mode}
              </span>
              <span className="rounded border border-border bg-card px-2 py-1 font-mono font-medium text-foreground">
                {asset}
              </span>
              <span className="rounded border border-border bg-card px-2 py-1 font-mono">
                {formatUsd(stake)}
              </span>
            </div>
            <Button variant="outline" className="w-full" size="lg" onClick={onCancel}>
              <X className="h-4 w-4" />
              Cancel search
            </Button>
          </div>
        ) : (
          <Button
            size="lg"
            className="h-12 w-full text-[15px]"
            disabled={busy || insufficient || invalidStake || invalidAsset}
            onClick={onSearch}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing…
              </>
            ) : (
              <>
                <Radar className="h-4 w-4" />
                Find opponent · {asset} · {formatUsd(stake)}
              </>
            )}
          </Button>
        )}
      </div>
    </section>
  );
}

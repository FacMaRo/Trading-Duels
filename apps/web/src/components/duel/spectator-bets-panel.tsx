'use client';

import { useCallback, useEffect, useState } from 'react';
import { Handshake, Plus, X } from 'lucide-react';
import {
  spectatorBetsApi,
  type SpectatorBetDto,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn, formatUsd } from '@/lib/utils';

interface SpectatorBetsPanelProps {
  duelId: string;
  playerA: { userId: string; username: string };
  playerB: { userId: string; username: string };
  disabled?: boolean;
  availableBalance: number;
  onBalanceChange?: () => void;
  /** If set, called before create/accept when session is required */
  onRequireAuth?: () => boolean;
}

export function SpectatorBetsPanel({
  duelId,
  playerA,
  playerB,
  disabled,
  availableBalance,
  onBalanceChange,
  onRequireAuth,
}: SpectatorBetsPanelProps) {
  const [bets, setBets] = useState<SpectatorBetDto[]>([]);
  const [pickUserId, setPickUserId] = useState(playerA.userId);
  const [amount, setAmount] = useState(5);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await spectatorBetsApi.list(duelId);
      setBets(list);
    } catch {
      setBets([]);
    }
  }, [duelId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 6_000);
    return () => clearInterval(t);
  }, [load]);

  async function create() {
    if (onRequireAuth && !onRequireAuth()) return;
    setError('');
    setOk('');
    setBusy(true);
    try {
      await spectatorBetsApi.create(duelId, { pickUserId, amount });
      setOk('Offer published. Funds locked.');
      onBalanceChange?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function accept(betId: string) {
    if (onRequireAuth && !onRequireAuth()) return;
    setError('');
    setBusy(true);
    try {
      await spectatorBetsApi.accept(duelId, betId);
      setOk('Bet matched. Funds locked until settlement.');
      onBalanceChange?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(betId: string) {
    if (onRequireAuth && !onRequireAuth()) return;
    setBusy(true);
    try {
      await spectatorBetsApi.cancel(duelId, betId);
      onBalanceChange?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  const open = bets.filter((b) => b.status === 'OPEN');
  const matched = bets.filter((b) => b.status === 'MATCHED');
  const history = bets.filter(
    (b) =>
      b.status === 'SETTLED' ||
      b.status === 'REFUNDED' ||
      b.status === 'CANCELLED',
  );

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card">
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 text-amber-300" />
          <div>
            <h3 className="text-sm font-bold">P2P Bets</h3>
            <p className="text-[10px] text-muted-foreground">
              Peer-to-peer · 10% fee on settlement · house takes no risk
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* Create offer */}
        {!disabled && (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              New offer
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <PickBtn
                active={pickUserId === playerA.userId}
                onClick={() => setPickUserId(playerA.userId)}
                label={`@${playerA.username}`}
                side="A"
              />
              <PickBtn
                active={pickUserId === playerB.userId}
                onClick={() => setPickUserId(playerB.userId)}
                label={`@${playerB.username}`}
                side="B"
              />
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                $
              </span>
              <Input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="h-9 pl-6 font-mono text-sm"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Available {formatUsd(availableBalance)} · counterparty takes the
              other side for the same amount
            </p>
            <Button
              size="sm"
              className="w-full font-semibold"
              disabled={busy || amount < 1 || amount > availableBalance}
              onClick={create}
            >
              <Plus className="h-3.5 w-3.5" />
              Publish offer {formatUsd(amount)}
            </Button>
          </div>
        )}

        {error && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        )}
        {ok && (
          <p className="rounded-md bg-success/10 px-2 py-1.5 text-xs text-success">
            {ok}
          </p>
        )}

        {/* Open offers */}
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Open offers ({open.length})
          </p>
          {open.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-muted-foreground">
              No offers yet. Be the first.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {open.map((b) => (
                <li
                  key={b.id}
                  className="rounded-lg border border-border bg-background/50 px-2.5 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-xs">
                      <p className="font-medium">
                        @{b.proposerUsername}{' '}
                        <span className="text-muted-foreground">bets on</span>{' '}
                        <span className="text-primary">@{b.pickUsername}</span>
                      </p>
                      <p className="mt-0.5 font-mono text-sm font-bold">
                        {formatUsd(b.amount)}
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                          each · pot {formatUsd(b.amount * 2)}
                        </span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        You take @{b.counterPickUsername}
                      </p>
                    </div>
                    {b.isMine ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        disabled={busy}
                        onClick={() => cancel(b.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    ) : b.canAccept && !disabled ? (
                      <Button
                        size="sm"
                        className="h-8 shrink-0 text-xs font-bold"
                        disabled={busy}
                        onClick={() => accept(b.id)}
                      >
                        Accept
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Matched */}
        {matched.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Matched ({matched.length})
            </p>
            <ul className="space-y-1.5">
              {matched.map((b) => (
                <li
                  key={b.id}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs"
                >
                  <Badge variant="outline" className="mb-1 text-[9px]">
                    MATCHED
                  </Badge>
                  <p>
                    @{b.proposerUsername} → @{b.pickUsername} vs @
                    {b.acceptorUsername} → @{b.counterPickUsername}
                  </p>
                  <p className="font-mono font-semibold">
                    pot {formatUsd(b.pot ?? b.amount * 2)} · prize{' '}
                    {formatUsd(b.winnerPrize ?? b.amount * 2 * 0.9)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              History
            </p>
            <ul className="space-y-1">
              {history.slice(0, 8).map((b) => (
                <li
                  key={b.id}
                  className="flex justify-between rounded border border-border/50 px-2 py-1 text-[10px] text-muted-foreground"
                >
                  <span>
                    {b.status} · @{b.pickUsername}
                  </span>
                  <span className="font-mono">{formatUsd(b.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function PickBtn({
  active,
  onClick,
  label,
  side,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  side: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-2 py-2 text-left text-xs transition-colors',
        active
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-border text-muted-foreground hover:bg-secondary',
      )}
    >
      <span className="text-[9px] font-bold uppercase opacity-70">
        Player {side}
      </span>
      <p className="truncate font-semibold">{label}</p>
    </button>
  );
}

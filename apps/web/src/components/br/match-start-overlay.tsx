'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/copy';

interface MatchStartOverlayProps {
  /** When trading clock starts (ISO). Intro ends at this instant. */
  liveStartedAt: string | null;
  asset?: string;
  playerCount?: number;
  /** Called once when intro fully ends (after LIVE flash). */
  onFinished?: () => void;
}

/**
 * Professional 5s MATCH STARTING intro (5→1→LIVE).
 * Driven by server liveStartedAt so refresh mid-intro stays consistent.
 */
export function MatchStartOverlay({
  liveStartedAt,
  asset,
  playerCount,
  onFinished,
}: MatchStartOverlayProps) {
  const [now, setNow] = useState(() => Date.now());
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const startMs = liveStartedAt ? new Date(liveStartedAt).getTime() : NaN;
  const remaining = Number.isFinite(startMs) ? startMs - now : -Infinity;

  // Dismiss after LIVE flash (~700ms past trade start)
  useEffect(() => {
    if (!liveStartedAt || done) return;
    if (remaining <= -700) {
      setDone(true);
      onFinished?.();
    }
  }, [remaining, liveStartedAt, done, onFinished]);

  // Already past intro on mount (reconnect mid-match) — never show
  useEffect(() => {
    if (!liveStartedAt) return;
    const s = new Date(liveStartedAt).getTime();
    if (Number.isFinite(s) && Date.now() >= s + 700) {
      setDone(true);
    }
  }, [liveStartedAt]);

  if (!liveStartedAt || done || !Number.isFinite(startMs)) return null;
  if (remaining <= -700) return null;

  const inLiveFlash = remaining <= 0;
  const sec = inLiveFlash ? 0 : Math.max(1, Math.ceil(remaining / 1000));

  return (
    <div
      className="absolute inset-0 z-[70] flex items-center justify-center bg-background/70 backdrop-blur-[3px] animate-fade-in"
      role="dialog"
      aria-label={COPY.arena.matchStarting}
      aria-live="assertive"
    >
      <div className="pointer-events-none mx-4 flex max-w-sm flex-col items-center text-center">
        <p className="label-caps mb-3 tracking-[0.22em] text-muted-foreground">
          {COPY.arena.matchStarting}
        </p>

        <div
          key={inLiveFlash ? 'live' : sec}
          className={cn(
            'mono-num font-black tabular-nums tracking-tight transition-opacity',
            'animate-fade-up',
            inLiveFlash
              ? 'text-4xl text-primary sm:text-5xl'
              : 'text-6xl text-foreground sm:text-7xl',
          )}
        >
          {inLiveFlash ? COPY.arena.live : sec}
        </div>

        {(asset || playerCount != null) && (
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
            {asset}
            {asset && playerCount != null ? ' · ' : ''}
            {playerCount != null
              ? `${playerCount} ${COPY.arena.players.toLowerCase()}`
              : ''}
          </p>
        )}
      </div>
    </div>
  );
}

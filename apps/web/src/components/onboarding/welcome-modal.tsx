'use client';

import { useRouter } from 'next/navigation';
import { Crosshair, Swords, Zap, Clock, Mountain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface WelcomeModalProps {
  username: string;
  onSkip: () => void;
  onContinue: () => void;
}

const MODES = [
  {
    icon: Zap,
    title: 'Blitz',
    desc: '10 min · quick matches',
    color: 'text-amber-300',
  },
  {
    icon: Clock,
    title: 'Normal',
    desc: '20 min · balanced',
    color: 'text-primary',
  },
  {
    icon: Mountain,
    title: 'Slow',
    desc: 'Full session · more depth',
    color: 'text-emerald-300',
  },
];

export function WelcomeModal({
  username,
  onSkip,
  onContinue,
}: WelcomeModalProps) {
  const router = useRouter();

  function goPlay() {
    onContinue();
    router.push('/lobby');
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onSkip}
      />
      <div className="relative w-full max-w-lg animate-slide-up overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(199_89%_48%_/_0.15),_transparent_60%)]" />

        <div className="relative space-y-5 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Crosshair className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                Welcome
              </p>
              <h2
                id="welcome-title"
                className="text-xl font-bold tracking-tight sm:text-2xl"
              >
                Hello, {username}
              </h2>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-secondary/30 p-4">
            <p className="text-sm leading-relaxed text-foreground">
              <strong className="text-primary">Trading Duels</strong> is
              real-time 1v1 competition. Both trade equal virtual capital:
              highest <strong>R-multiple</strong> wins.
            </p>
            <p className="text-xs text-muted-foreground">
              Platform takes 10% of the pot. Skill, not casino.
            </p>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Three modes
            </p>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => {
                const Icon = m.icon;
                return (
                  <div
                    key={m.title}
                    className="rounded-xl border border-border bg-background/50 px-2 py-3 text-center"
                  >
                    <Icon className={cn('mx-auto h-4 w-4', m.color)} />
                    <p className={cn('mt-1.5 text-sm font-bold', m.color)}>
                      {m.title}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                      {m.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              size="lg"
              className="h-12 flex-1 font-bold shadow-glow"
              onClick={goPlay}
            >
              <Swords className="h-4 w-4" />
              Play my first match
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 sm:w-auto"
              onClick={onSkip}
            >
              Explore first
            </Button>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            Tip: fund your Wallet, then find an opponent in the Lobby. Under a
            minute.
          </p>
        </div>
      </div>
    </div>
  );
}

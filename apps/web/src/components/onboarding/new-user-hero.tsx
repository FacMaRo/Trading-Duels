'use client';

import Link from 'next/link';
import { ArrowRight, Swords, Wallet, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NewUserHeroProps {
  username: string;
  hasBalance: boolean;
  className?: string;
}

export function NewUserHero({
  username,
  hasBalance,
  className,
}: NewUserHeroProps) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-6 sm:p-8',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(199_89%_48%_/_0.18),_transparent_55%)]" />
      <div className="relative space-y-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            Getting started
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Ready for your first match, {username}?
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground leading-relaxed">
            Compete 1v1 with equal virtual capital. Highest{' '}
            <span className="text-foreground font-medium">R-multiple</span> wins.
            Choose a mode, stake, and trade.
          </p>
        </div>

        <ol className="grid gap-2 sm:grid-cols-3">
          {[
            {
              n: '1',
              title: 'Balance',
              desc: hasBalance ? 'Ready' : 'Deposit from Wallet',
              done: hasBalance,
            },
            {
              n: '2',
              title: 'Lobby',
              desc: 'Find opponent or create challenge',
              done: false,
            },
            {
              n: '3',
              title: 'Arena',
              desc: 'Trade and win on R',
              done: false,
            },
          ].map((s) => (
            <li
              key={s.n}
              className={cn(
                'flex items-start gap-2.5 rounded-xl border px-3 py-2.5',
                s.done
                  ? 'border-success/30 bg-success/5'
                  : 'border-border bg-background/40',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                  s.done
                    ? 'bg-success text-success-foreground'
                    : 'bg-secondary text-muted-foreground',
                )}
              >
                {s.n}
              </span>
              <div>
                <p className="text-sm font-semibold">{s.title}</p>
                <p className="text-[11px] text-muted-foreground">{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild size="lg" className="h-12 font-bold shadow-glow">
            <Link href="/lobby">
              <Swords className="h-4 w-4" />
              Play my first match
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          {!hasBalance && (
            <Button asChild size="lg" variant="outline" className="h-12">
              <Link href="/wallet">
                <Wallet className="h-4 w-4" />
                Fund balance first
              </Link>
            </Button>
          )}
          <Button asChild size="lg" variant="ghost" className="h-12">
            <Link href="/lobby?mode=BLITZ">
              <Zap className="h-4 w-4 text-amber-300" />
              Try Blitz
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

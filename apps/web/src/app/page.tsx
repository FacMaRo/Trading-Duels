'use client';

import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  Crosshair,
  Play,
  Swords,
  Timer,
  Trophy,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';
import { cn } from '@/lib/utils';

/** Investor / visitor landing — demo-first, terminal aesthetic */
export default function HomePage() {
  return (
    <div className="relative pb-20 md:pb-16">
      {/* Terminal grid backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="absolute left-1/2 top-0 h-[480px] w-[800px] -translate-x-1/2 rounded-full bg-primary/[0.06] blur-3xl" />
      </div>

      {/* ── A) HERO ─────────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-4 pb-16 pt-10 text-center sm:pt-14">
        <div className="animate-fade-up mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card text-primary shadow-panel">
          <Crosshair className="h-6 w-6" />
        </div>

        <p className="animate-fade-up label-caps mb-3 inline-flex items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1 text-primary">
          {COPY.home.badge}
        </p>

        <h1 className="animate-fade-up-delay-1 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-[2.65rem] md:leading-[1.15]">
          {COPY.home.title}
          <span className="mt-1 block text-muted-foreground">
            {COPY.home.titleAccent}
          </span>
        </h1>

        <p className="animate-fade-up-delay-2 mx-auto mt-4 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
          {COPY.home.subtitle}
        </p>

        <div className="animate-fade-up-delay-3 mt-8 flex w-full max-w-md flex-col items-center gap-3">
          <Button
            asChild
            size="lg"
            className="h-14 w-full text-base font-bold tracking-wide shadow-glow transition-transform active:scale-[0.99] sm:h-16 sm:text-lg"
          >
            <Link href="/demo">
              <Play className="h-5 w-5 fill-current" />
              {COPY.home.ctaDemoArrow}
            </Link>
          </Button>
          <a
            href="#how-it-works"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {COPY.home.howItWorksLink}
            <ArrowDown className="h-3.5 w-3.5" />
          </a>
          <p className="text-xs text-muted-foreground">
            {COPY.home.ctaDemoHint}
          </p>
        </div>
      </section>

      {/* ── B) HOW IT WORKS ─────────────────────────────────────────────── */}
      <section
        id="how-it-works"
        className="relative z-10 mx-auto max-w-5xl scroll-mt-20 px-4 pb-16"
      >
        <h2 className="animate-fade-up mb-6 text-center text-lg font-semibold tracking-tight sm:text-xl">
          {COPY.home.howTitle}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {COPY.home.howSteps.map((step, i) => (
            <div
              key={step.title}
              className={cn(
                'rounded-xl border border-border bg-card/80 p-5 shadow-panel',
                i === 0 && 'animate-fade-up',
                i === 1 && 'animate-fade-up-delay-1',
                i === 2 && 'animate-fade-up-delay-2',
              )}
            >
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary font-mono text-sm font-bold text-primary">
                {i + 1}
              </div>
              <h3 className="text-sm font-semibold text-foreground">
                {step.title}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground sm:text-[13px]">
                {step.body}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          {COPY.home.prizeSplit}:{' '}
          <span className="mono-num text-foreground/80">
            {COPY.home.prizeShares}
          </span>
        </p>
      </section>

      {/* ── C) SEE THE ARENA (mock product chrome) ─────────────────────── */}
      <section className="relative z-10 mx-auto max-w-5xl px-4 pb-16">
        <h2 className="animate-fade-up mb-2 text-center text-lg font-semibold tracking-tight sm:text-xl">
          {COPY.home.arenaTitle}
        </h2>
        <p className="animate-fade-up mb-6 text-center text-sm text-muted-foreground">
          {COPY.home.arenaCaption}
        </p>

        <div className="animate-fade-up-delay-1 overflow-hidden rounded-xl border border-border bg-card shadow-panel">
          {/* Fake arena header */}
          <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/30 px-3 py-2 sm:px-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                Demo
              </span>
              <span className="font-mono font-semibold text-foreground">
                EURUSD
              </span>
              <span className="hidden sm:inline">· 50 players</span>
            </div>
            <div className="text-right">
              <p className="label-caps !text-[8px]">Time</p>
              <p className="mono-num text-lg font-black tabular-nums text-foreground sm:text-xl">
                7:42
              </p>
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[1fr_220px]">
            {/* Chart mock */}
            <div className="relative min-h-[200px] border-b border-border p-3 sm:min-h-[240px] lg:border-b-0 lg:border-r">
              <div className="mb-2 flex gap-1">
                {['1m', '5m', '15m'].map((tf, i) => (
                  <span
                    key={tf}
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-[10px]',
                      i === 0
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {tf}
                  </span>
                ))}
              </div>
              {/* Synthetic candle bars */}
              <div className="flex h-[140px] items-end gap-1 px-1 sm:h-[160px]">
                {[
                  40, 55, 48, 62, 58, 70, 65, 72, 68, 80, 74, 78, 85, 82, 90,
                  88, 92, 86, 94, 91,
                ].map((h, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex-1 rounded-sm',
                      i % 3 === 0 ? 'bg-destructive/50' : 'bg-success/45',
                    )}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                <span className="rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-success">
                  Open PnL +$42.10
                </span>
                <span className="rounded border border-border bg-secondary/40 px-1.5 py-0.5 text-muted-foreground">
                  My trades 1/2
                </span>
              </div>
            </div>

            {/* Ranking mock */}
            <div className="p-3">
              <p className="label-caps mb-2 !text-[9px]">
                <Trophy className="mr-1 inline h-3 w-3 text-primary" />
                Live ranking
              </p>
              <ul className="space-y-1 font-mono text-[11px]">
                {[
                  { r: 1, n: 'you', p: '+$128.40', me: true },
                  { r: 2, n: 'nova', p: '+$96.20', me: false },
                  { r: 3, n: 'apex', p: '+$71.05', me: false },
                  { r: 4, n: 'kite', p: '+$44.10', me: false },
                  { r: 5, n: 'flux', p: '+$28.90', me: false },
                ].map((row) => (
                  <li
                    key={row.r}
                    className={cn(
                      'flex items-center justify-between rounded px-1.5 py-1',
                      row.me && 'bg-primary/10 font-semibold',
                    )}
                  >
                    <span className="text-muted-foreground">
                      #{row.r}{' '}
                      <span className="text-foreground">@{row.n}</span>
                    </span>
                    <span className="text-success">{row.p}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-border pt-2 text-center text-[10px] text-muted-foreground">
                Your position #1 · prize zone
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── D) RULES AT A GLANCE ────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-5xl px-4 pb-16">
        <h2 className="animate-fade-up mb-6 text-center text-lg font-semibold tracking-tight sm:text-xl">
          {COPY.home.rulesTitle}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {COPY.home.rules.map((rule, i) => {
            const Icon =
              i === 0 ? Users : i === 1 ? Timer : i === 2 ? BarChart3 : Swords;
            return (
              <div
                key={rule.label}
                className={cn(
                  'flex gap-3 rounded-xl border border-border bg-card/70 p-4',
                  i % 2 === 0 ? 'animate-fade-up' : 'animate-fade-up-delay-1',
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="label-caps !text-[9px] text-muted-foreground">
                    {rule.label}
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    {rule.value}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {rule.hint}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── E) FINAL CTA ───────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-lg px-4 pb-8 text-center">
        <div className="animate-fade-up rounded-2xl border border-border bg-card/80 px-6 py-8 shadow-panel">
          <Button
            asChild
            size="lg"
            className="h-14 w-full text-base font-bold shadow-glow sm:text-lg"
          >
            <Link href="/demo">
              <Play className="h-5 w-5 fill-current" />
              {COPY.home.finalCta}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            {COPY.home.finalTrust}
          </p>
        </div>

        <div className="mt-10 border-t border-border pt-6">
          <p className="mb-3 text-xs text-muted-foreground">
            {COPY.home.realEyebrow}
          </p>
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            <Button asChild variant="outline" size="sm" className="h-10">
              <Link href="/login?next=/lobby">{COPY.home.ctaSignIn}</Link>
            </Button>
            <Button asChild variant="secondary" size="sm" className="h-10">
              <Link href="/register?next=/lobby">{COPY.home.ctaReal}</Link>
            </Button>
          </div>
          <p className="mt-6 text-[11px] text-muted-foreground/70">
            {COPY.home.footerNote}
          </p>
        </div>
      </section>
    </div>
  );
}

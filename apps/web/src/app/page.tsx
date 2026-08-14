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
        <div className="animate-fade-up mb-8 text-center">
          <p className="label-caps mb-2 text-primary">Process</p>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {COPY.home.howTitle}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {COPY.home.howSubtitle}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {COPY.home.howSteps.map((step, i) => (
            <div
              key={step.title}
              className={cn(
                'rounded-xl border border-border/90 bg-card p-5 shadow-panel sm:p-6',
                'ring-1 ring-inset ring-white/[0.03]',
                i === 0 && 'animate-fade-up',
                i === 1 && 'animate-fade-up-delay-1',
                i === 2 && 'animate-fade-up-delay-2',
              )}
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 font-mono text-base font-bold text-primary">
                {i + 1}
              </div>
              <h3 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
              {i === 2 && (
                <div className="mt-4 rounded-md border border-border bg-secondary/30 px-3 py-2.5">
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {COPY.home.prizeSplit}
                  </p>
                  <p className="mono-num mt-1 text-sm font-semibold tabular-nums text-foreground">
                    {COPY.home.prizeShares}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── C) RULES AT A GLANCE ────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-5xl px-4 pb-16">
        <h2 className="animate-fade-up mb-6 text-center text-xl font-semibold tracking-tight sm:text-2xl">
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
                  'flex gap-3 rounded-xl border border-border bg-card/80 p-4',
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

      {/* ── D) FINAL CTA ───────────────────────────────────────────────── */}
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

'use client';

import Link from 'next/link';
import { ArrowRight, Crosshair, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';

/** Conversion home — demo CTA first, real money secondary */
export default function HomePage() {
  return (
    <div className="relative flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center px-4 pb-24 pt-10 md:pb-16">
      {/* Subtle terminal grid + glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="absolute left-1/2 top-0 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-xl text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-panel">
          <Crosshair className="h-7 w-7" />
        </div>

        <p className="label-caps mb-3 text-primary">{COPY.home.eyebrow}</p>

        <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-[2.75rem] md:leading-[1.15]">
          {COPY.home.title}
          <span className="mt-1 block text-muted-foreground">
            {COPY.home.titleAccent}
          </span>
        </h1>

        <p className="mx-auto mt-4 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
          {COPY.home.subtitle}
        </p>

        <div className="mt-10 space-y-3">
          <Button
            asChild
            size="lg"
            className="h-16 w-full max-w-md text-lg font-bold tracking-wide shadow-glow transition-transform active:scale-[0.99] sm:h-[4.25rem] sm:text-xl"
          >
            <Link href="/demo">
              <Play className="h-6 w-6 fill-current" />
              {COPY.home.ctaDemo}
              <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {COPY.home.ctaDemoHint}
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-md border-t border-border pt-8">
          <p className="mb-3 text-xs text-muted-foreground">
            {COPY.home.realEyebrow}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              asChild
              variant="outline"
              className="h-11 flex-1 sm:flex-none sm:min-w-[160px]"
            >
              <Link href="/login?next=/lobby">{COPY.home.ctaSignIn}</Link>
            </Button>
            <Button
              asChild
              variant="secondary"
              className="h-11 flex-1 sm:flex-none sm:min-w-[160px]"
            >
              <Link href="/register?next=/lobby">{COPY.home.ctaReal}</Link>
            </Button>
          </div>
        </div>

        <p className="mt-10 text-[11px] text-muted-foreground/70">
          {COPY.home.footerNote}
        </p>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { Check, ChevronDown, ChevronUp, ListChecks, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChecklistStep } from '@/lib/onboarding';

interface GettingStartedProps {
  steps: ChecklistStep[];
  completedCount: number;
  collapsed: boolean;
  onToggle: () => void;
  onDismiss: () => void;
}

export function GettingStartedChecklist({
  steps,
  completedCount,
  collapsed,
  onToggle,
  onDismiss,
}: GettingStartedProps) {
  const total = steps.length;
  const pct = Math.round((completedCount / total) * 100);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full border border-primary/40 bg-card/95 px-4 py-2.5 shadow-glow backdrop-blur-md transition-transform hover:scale-[1.02] md:bottom-6"
      >
        <ListChecks className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">
          Getting started · {completedCount}/{total}
        </span>
        <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    );
  }

  return (
    <aside
      className="fixed bottom-20 right-4 z-40 w-[min(100vw-2rem,20rem)] animate-slide-up rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-md md:bottom-6"
      aria-label="Getting started"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
            Quick guide
          </p>
          <p className="text-sm font-semibold">
            Getting started · {completedCount}/{total}
          </p>
        </div>
        <div className="flex gap-0.5">
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Minimize"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Hide guide"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-4 pt-2">
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="space-y-1 p-3">
        {steps.map((step, i) => (
          <li key={step.id}>
            <div
              className={cn(
                'rounded-xl border px-3 py-2.5 transition-colors',
                step.done
                  ? 'border-success/20 bg-success/5'
                  : 'border-border bg-secondary/20',
              )}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    step.done
                      ? 'bg-success text-success-foreground'
                      : 'border border-border bg-background text-muted-foreground',
                  )}
                >
                  {step.done ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      step.done && 'text-muted-foreground line-through',
                    )}
                  >
                    {step.title}
                  </p>
                  {!step.done && (
                    <>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {step.description}
                      </p>
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs"
                      >
                        <Link href={step.href}>{step.cta}</Link>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="border-t border-border px-4 py-2 text-center text-[10px] text-muted-foreground">
        You can hide this guide at any time
      </p>
    </aside>
  );
}

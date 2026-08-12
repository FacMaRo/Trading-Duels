'use client';

import { Crown, MessageCircle, Ticket, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PremiumBadge } from '@/components/ui/premium-badge';
import { COPY } from '@/lib/copy';

interface PremiumUpsellCardProps {
  onActivate: () => void | Promise<void>;
  busy?: boolean;
}

/** Compact Premium conversion card (€9.99/mo) */
export function PremiumUpsellCard({ onActivate, busy }: PremiumUpsellCardProps) {
  const icons = [Zap, Ticket, MessageCircle, Crown] as const;

  return (
    <section className="rounded-lg border border-amber-500/25 bg-gradient-to-br from-amber-500/[0.07] to-transparent p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-300" />
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              {COPY.premium.title}
            </h2>
            <PremiumBadge size="sm" />
          </div>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {COPY.premium.benefits.map((benefit, i) => {
              const Icon = icons[i] ?? Crown;
              return (
                <li key={benefit} className="flex items-center gap-1.5">
                  <Icon className="h-3 w-3 shrink-0 text-amber-200/70" />
                  {benefit}
                </li>
              );
            })}
          </ul>
        </div>
        <Button
          size="sm"
          className="shrink-0 border border-amber-500/30 bg-amber-500/15 font-semibold text-amber-100 hover:bg-amber-500/25"
          disabled={busy}
          onClick={() => void onActivate()}
        >
          {COPY.premium.ctaDev}
        </Button>
      </div>
    </section>
  );
}

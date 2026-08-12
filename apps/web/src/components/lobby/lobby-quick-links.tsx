'use client';

import Link from 'next/link';
import { Target, Trophy, Wallet } from 'lucide-react';
import { cn, formatUsd } from '@/lib/utils';

interface LobbyQuickLinksProps {
  available?: number;
}

const links = [
  {
    href: '/missions',
    label: 'Missions',
    hint: 'Rewards',
    icon: Target,
  },
  {
    href: '/leaderboard',
    label: 'Leaderboard',
    hint: 'Global ELO',
    icon: Trophy,
  },
  {
    href: '/wallet',
    label: 'Wallet',
    hint: 'Funds',
    icon: Wallet,
  },
];

export function LobbyQuickLinks({ available }: LobbyQuickLinksProps) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {links.map((l) => {
        const Icon = l.icon;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              'flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-3 transition-colors hover:bg-secondary/40 sm:flex-row sm:items-center sm:gap-3',
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary/50">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">{l.label}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {l.href === '/wallet' && available != null
                  ? formatUsd(available)
                  : l.hint}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

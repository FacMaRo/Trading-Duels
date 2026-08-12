'use client';

import Link from 'next/link';
import { Swords, Target, Trophy, Wallet } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { isNewPlayer } from '@/lib/onboarding';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatUsd } from '@/lib/utils';
import { COPY } from '@/lib/copy';
import { BR_ASSETS, BR_STAKES } from '@trading-duels/shared';

export default function DashboardPage() {
  const { user, wallet, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex justify-center py-24 text-sm text-muted-foreground">
        {COPY.dashboard.loading}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg space-y-6 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{COPY.dashboard.guestTitle}</h1>
        <p className="text-muted-foreground">
          {COPY.dashboard.guestHint}
        </p>
        <Button asChild className="font-semibold">
          <Link href="/login?next=/dashboard">{COPY.nav.signIn}</Link>
        </Button>
      </div>
    );
  }

  const isNew = isNewPlayer(user);

  return (
    <div className="space-y-8 pb-20 md:pb-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {COPY.dashboard.hello(user.displayName || user.username)}
          </h1>
          <p className="text-muted-foreground">
            {isNew ? COPY.dashboard.newHint : COPY.dashboard.returningHint}
          </p>
        </div>
        <Button asChild size="lg" className="font-semibold">
          <Link href="/lobby">
            <Swords className="h-4 w-4" />
            {COPY.dashboard.goLobby}
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{COPY.wallet.balance}</CardDescription>
            <CardTitle className="mono-num text-2xl">
              {formatUsd(wallet?.availableBalance ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>ELO</CardDescription>
            <CardTitle className="mono-num text-2xl">{user.elo}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>W / L</CardDescription>
            <CardTitle className="mono-num text-2xl">
              {user.wins}/{user.losses}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Battle Royale</CardTitle>
          <CardDescription>
            {COPY.dashboard.brDesc(
              `$${BR_STAKES.join(' / $')}`,
              BR_ASSETS.join(', '),
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/lobby">{COPY.dashboard.findMatch}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/wallet">
              <Wallet className="h-4 w-4" />
              {COPY.nav.wallet}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/missions">
              <Target className="h-4 w-4" />
              {COPY.nav.missions}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/leaderboard">
              <Trophy className="h-4 w-4" />
              {COPY.nav.leaderboard}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

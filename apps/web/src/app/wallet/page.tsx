'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, ArrowUpFromLine, Swords, Wallet } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { walletApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatUsd } from '@/lib/utils';
import { AUTH_REASONS, buildLoginUrl, buildRegisterUrl } from '@/lib/auth-redirect';
import { COPY } from '@/lib/copy';

export default function WalletPage() {
  const { user, wallet, refreshWallet, refreshMe, loading: authLoading } =
    useAuth();
  const [amount, setAmount] = useState(50);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(false);

  async function handle(action: 'deposit' | 'withdraw', e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError('');
    setOk('');
    setLoading(true);
    try {
      if (action === 'deposit') await walletApi.deposit(amount);
      else await walletApi.withdraw(amount);
      await refreshWallet();
      await refreshMe();
      setOk(
        action === 'deposit'
          ? COPY.wallet.depositOk(formatUsd(amount))
          : COPY.wallet.withdrawOk(formatUsd(amount)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.common.error);
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <div className="flex justify-center py-24 text-sm text-muted-foreground">
        {COPY.common.loading}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg space-y-6 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Wallet className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{COPY.wallet.title}</h1>
        <p className="text-muted-foreground">
          {COPY.wallet.signInHint}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild className="font-semibold shadow-glow">
            <Link href={buildLoginUrl('/wallet', AUTH_REASONS.wallet)}>
              {COPY.nav.signIn}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={buildRegisterUrl('/wallet', AUTH_REASONS.wallet)}>
              {COPY.wallet.createAccount}
            </Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <Link href="/lobby" className="underline hover:text-foreground">
            {COPY.wallet.backLobby}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-20 md:pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{COPY.wallet.title}</h1>
        <p className="text-muted-foreground">
          {COPY.wallet.subtitle}
        </p>
      </div>

      {(wallet?.availableBalance ?? 0) < 10 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">{COPY.wallet.needBalance}</p>
              <p className="text-sm text-muted-foreground">
                {COPY.wallet.needBalanceHint}
              </p>
            </div>
          </div>
          <Button
            className="shrink-0 font-semibold shadow-glow"
            disabled={loading}
            onClick={(e) => {
              setAmount(50);
              handle('deposit', e);
            }}
          >
            <ArrowDownToLine className="h-4 w-4" />
            {COPY.wallet.deposit50}
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase text-muted-foreground">{COPY.wallet.balance}</p>
            <p className="mt-1 font-mono text-2xl font-semibold">
              {formatUsd(wallet?.balance ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase text-muted-foreground">{COPY.wallet.available}</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-success">
              {formatUsd(wallet?.availableBalance ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase text-muted-foreground">{COPY.wallet.locked}</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-amber-400">
              {formatUsd(wallet?.lockedBalance ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{COPY.wallet.moveFunds}</CardTitle>
          <CardDescription>
            {COPY.wallet.moveFundsHint}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount">{COPY.wallet.amount}</Label>
              <Input
                id="amount"
                type="number"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            {ok && (
              <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
                {ok}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="flex-1"
                disabled={loading}
                onClick={(e) => handle('deposit', e)}
              >
                <ArrowDownToLine className="h-4 w-4" />
                {COPY.wallet.deposit}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={loading}
                onClick={(e) => handle('withdraw', e)}
              >
                <ArrowUpFromLine className="h-4 w-4" />
                {COPY.wallet.withdraw}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {(wallet?.availableBalance ?? 0) >= 10 && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {COPY.wallet.ready}
          </p>
          <Button asChild size="sm" className="font-semibold">
            <Link href="/lobby">
              <Swords className="h-4 w-4" />
              {COPY.wallet.goLobby}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

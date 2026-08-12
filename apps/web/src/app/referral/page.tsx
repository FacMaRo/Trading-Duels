'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Gift, Ticket, Users } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { referralsApi, type ReferralOverviewDto } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { buildLoginUrl } from '@/lib/auth-redirect';

export default function ReferralPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ReferralOverviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setData(await referralsApi.me());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : COPY.referral.loadError,
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const fullLink = useMemo(() => {
    if (!data) return '';
    if (typeof window === 'undefined') return data.path;
    return `${window.location.origin}${data.path}`;
  }, [data]);

  async function copy(kind: 'code' | 'link', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* ignore */
    }
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <Gift className="mx-auto h-10 w-10 text-primary" />
        <h1 className="text-2xl font-semibold">{COPY.referral.title}</h1>
        <p className="text-sm text-muted-foreground">{COPY.referral.pitch}</p>
        <Button asChild>
          <Link href={buildLoginUrl('/referral')}>
            {COPY.referral.signIn}
          </Link>
        </Button>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex justify-center py-24 text-sm text-muted-foreground">
        {COPY.referral.loading}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" onClick={() => void load()}>
          {COPY.common.retry}
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const available = data.availableCredits.filter(Boolean);

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-20 md:pb-8">
      <div>
        <p className="label-caps mb-1.5 flex items-center gap-1.5 text-primary">
          <Gift className="h-3.5 w-3.5" />
          {COPY.referral.eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {COPY.referral.title}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{data.pitch}</p>
      </div>

      {data.referredBy && (
        <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
          {COPY.referral.referredBy(data.referredBy.username)}
          <span className="ml-2 text-xs text-muted-foreground">
            · {statusLabel(data.referredBy.status)}
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{COPY.referral.yourCode}</CardTitle>
          <CardDescription>{COPY.referral.yourLink}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-lg font-bold tracking-wider">
              {data.code}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void copy('code', data.code)}
            >
              {copied === 'code' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied === 'code' ? COPY.referral.copied : COPY.referral.copy}
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              readOnly
              value={fullLink}
              className="h-10 w-full flex-1 rounded-md border border-border bg-secondary/30 px-3 font-mono text-xs text-muted-foreground"
            />
            <Button
              size="sm"
              className="shrink-0"
              onClick={() => void copy('link', fullLink)}
            >
              {copied === 'link' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied === 'link' ? COPY.referral.copied : COPY.referral.copy}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          icon={<Users className="h-4 w-4" />}
          label={COPY.referral.statsInvited}
          value={String(data.stats.invited)}
        />
        <StatTile
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          label={COPY.referral.statsPending}
          value={String(data.stats.pending)}
        />
        <StatTile
          icon={<Ticket className="h-4 w-4 text-success" />}
          label={COPY.referral.statsQualified}
          value={String(data.stats.qualified)}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ticket className="h-4 w-4 text-amber-300" />
            {COPY.referral.creditsTitle}
          </CardTitle>
          <CardDescription>{COPY.referral.creditsHint}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {COPY.referral.creditsEmpty}
            </p>
          ) : (
            <ul className="space-y-2">
              {available.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/25 bg-success/5 px-3 py-2 text-sm"
                >
                  <span className="font-semibold text-success">
                    {COPY.referral.stakeLabel(String(c.stake))}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {c.expiresAt
                      ? COPY.referral.expires(
                          new Date(c.expiresAt).toLocaleDateString(),
                        )
                      : COPY.referral.noExpiry}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {available.length > 0 && (
            <Button asChild size="sm" className="w-full sm:w-auto">
              <Link href="/lobby">{COPY.referral.goLobby}</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {COPY.referral.referralsTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {COPY.referral.referralsEmpty}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.referrals.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <div>
                    <p className="font-medium">@{r.username}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant={
                        r.status === 'PENDING' ? 'muted' : 'success'
                      }
                      className="text-[10px]"
                    >
                      {statusLabel(r.status)}
                    </Badge>
                    {r.status === 'PENDING' && (
                      <p className="mt-1 max-w-[14rem] text-[10px] text-muted-foreground">
                        {COPY.referral.pendingHint}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{COPY.referral.howTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            {COPY.referral.howSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function statusLabel(status: string) {
  if (status === 'PENDING') return COPY.referral.statusPending;
  if (status === 'QUALIFIED') return COPY.referral.statusQualified;
  if (status === 'REWARDED') return COPY.referral.statusRewarded;
  return status;
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mono-num mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}

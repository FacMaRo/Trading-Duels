'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { Crosshair } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
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
import {
  AUTH_REASONS,
  buildLoginUrl,
  safeReturnPath,
} from '@/lib/auth-redirect';
import { COPY } from '@/lib/copy';
import { referralsApi } from '@/lib/api';

export default function RegisterPage() {
  const { register, user, loading: authLoading } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const next = safeReturnPath(search.get('next'));
  const reasonKey = search.get('reason');
  const reasonText =
    reasonKey && reasonKey in AUTH_REASONS
      ? AUTH_REASONS[reasonKey as keyof typeof AUTH_REASONS]
      : reasonKey;
  const refCode = (search.get('ref') || '').trim().toUpperCase();

  const [form, setForm] = useState({
    email: '',
    username: '',
    password: '',
    displayName: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [referrerName, setReferrerName] = useState<string | null>(null);

  useEffect(() => {
    if (!refCode) return;
    referralsApi
      .byCode(refCode)
      .then((r) => setReferrerName(r.username))
      .catch(() => setReferrerName(null));
  }, [refCode]);

  useEffect(() => {
    if (!authLoading && user) {
      router.replace(next);
    }
  }, [authLoading, user, router, next]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register({
        email: form.email,
        username: form.username,
        password: form.password,
        displayName: form.displayName || undefined,
        referralCode: refCode || undefined,
      });
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.auth.registerError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-md animate-slide-up border-border/80 shadow-glow">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Crosshair className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">{COPY.auth.createTitle}</CardTitle>
          <CardDescription>
            {reasonText || COPY.auth.createDesc}
          </CardDescription>
          {referrerName && (
            <p className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-left text-xs text-primary">
              {COPY.referral.invitedBanner(referrerName)}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{COPY.auth.email}</Label>
              <Input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">{COPY.auth.username}</Label>
              <Input
                id="username"
                required
                minLength={3}
                maxLength={24}
                pattern="[a-zA-Z0-9_]+"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder={COPY.auth.usernameHint}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">{COPY.auth.displayName}</Label>
              <Input
                id="displayName"
                value={form.displayName}
                onChange={(e) =>
                  setForm({ ...form, displayName: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{COPY.auth.password}</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? COPY.auth.creating : COPY.auth.createTitle}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {COPY.auth.hasAccount}{' '}
            <Link
              href={buildLoginUrl(next, reasonKey)}
              className="text-primary hover:underline"
            >
              {COPY.auth.signInLink}
            </Link>
          </p>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            <Link href="/lobby" className="hover:text-foreground hover:underline">
              {COPY.auth.exploreFree}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

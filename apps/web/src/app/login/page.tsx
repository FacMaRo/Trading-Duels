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
  buildRegisterUrl,
  safeReturnPath,
} from '@/lib/auth-redirect';
import { COPY } from '@/lib/copy';

export default function LoginPage() {
  const { login, user, loading: authLoading } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const next = safeReturnPath(search.get('next'));
  const reasonKey = search.get('reason');
  const reasonText =
    reasonKey && reasonKey in AUTH_REASONS
      ? AUTH_REASONS[reasonKey as keyof typeof AUTH_REASONS]
      : reasonKey;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      await login(email, password);
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.auth.signInError);
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
          <CardTitle className="text-2xl">{COPY.auth.signInTitle}</CardTitle>
          <CardDescription>
            {reasonText || COPY.auth.signInDesc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{COPY.auth.email}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={COPY.auth.emailPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{COPY.auth.password}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? COPY.auth.signingIn : COPY.auth.signInTitle}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {COPY.auth.noAccount}{' '}
            <Link
              href={buildRegisterUrl(next, reasonKey)}
              className="text-primary hover:underline"
            >
              {COPY.auth.register}
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

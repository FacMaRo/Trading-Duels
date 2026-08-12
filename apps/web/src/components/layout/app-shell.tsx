'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Crosshair,
  Gift,
  LayoutDashboard,
  LogIn,
  LogOut,
  Swords,
  Target,
  Trophy,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { OnboardingHost } from '@/components/onboarding/onboarding-host';
import { Button } from '@/components/ui/button';
import { PremiumBadge } from '@/components/ui/premium-badge';
import { buildLoginUrl } from '@/lib/auth-redirect';
import { COPY } from '@/lib/copy';
import { cn, formatUsd } from '@/lib/utils';

const publicNav = [
  { href: '/lobby', label: COPY.nav.lobby, icon: Swords },
  { href: '/missions', label: COPY.nav.missions, icon: Target },
  { href: '/leaderboard', label: COPY.nav.leaderboard, icon: Trophy },
];

const authNav = [
  { href: '/dashboard', label: COPY.nav.dashboard, icon: LayoutDashboard },
  { href: '/lobby', label: COPY.nav.lobby, icon: Swords },
  { href: '/stats', label: COPY.nav.stats, icon: BarChart3 },
  { href: '/missions', label: COPY.nav.missions, icon: Target },
  { href: '/leaderboard', label: COPY.nav.leaderboard, icon: Trophy },
  { href: '/referral', label: COPY.nav.referral, icon: Gift },
  { href: '/wallet', label: COPY.nav.wallet, icon: Wallet },
];

const AUTH_PATHS = ['/login', '/register'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, wallet, logout, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isAuthPath = AUTH_PATHS.some((p) => pathname.startsWith(p));
  const isArena =
    pathname.startsWith('/duel/') || pathname.startsWith('/br/');
  const isDemoGuest = !!user?.isDemoGuest;
  // Demo guest: minimal nav (no wallet/money)
  const nav = !user
    ? publicNav
    : isDemoGuest
      ? [{ href: '/demo', label: COPY.nav.demo, icon: Swords }]
      : authNav;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card">
            <Crosshair className="h-5 w-5 text-primary animate-pulse-soft" />
          </div>
          <p className="text-sm text-muted-foreground">{COPY.common.loading}</p>
        </div>
      </div>
    );
  }

  if (isAuthPath) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <header className="glass">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
            <Link
              href="/lobby"
              className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-primary">
                <Crosshair className="h-4 w-4" />
              </span>
              <span>
                Trading
                <span className="font-semibold text-foreground/90">Duels</span>
              </span>
            </Link>
            <Link
              href="/lobby"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {COPY.nav.explore}
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header
        className={cn(
          'sticky top-0 z-50 glass',
          isArena && 'bg-background/90',
        )}
      >
        <div
          className={cn(
            'mx-auto flex h-14 items-center justify-between gap-4 px-4',
            !isArena && 'max-w-7xl',
          )}
        >
          <div className="flex min-w-0 items-center gap-5 lg:gap-8">
            <Link
              href={
                user?.isDemoGuest
                  ? '/demo'
                  : user
                    ? '/dashboard'
                    : '/'
              }
              className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-primary">
                <Crosshair className="h-4 w-4" />
              </span>
              <span className={cn(isArena && 'hidden sm:inline')}>
                Trading
                <span className="text-foreground/90">Duels</span>
              </span>
            </Link>

            {!isArena && (
              <nav className="hidden items-center gap-0.5 md:flex">
                {nav.map((item) => {
                  const Icon = item.icon;
                  const active = pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                        active
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 opacity-80" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            )}

            {isArena && (
              <span className="label-caps rounded border border-border bg-secondary/50 px-2 py-1 text-muted-foreground">
                {COPY.nav.arena}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {user ? (
              <>
                {user.isDemoGuest ? (
                  <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                    Demo · @{user.username}
                  </span>
                ) : (
                  <>
                    {wallet && (
                      <div className="hidden items-center gap-2 sm:flex">
                        <div className="rounded-md border border-border bg-secondary/40 px-2.5 py-1">
                          <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                            Balance
                          </p>
                          <p className="mono-num text-xs font-semibold text-foreground">
                            {formatUsd(wallet.availableBalance)}
                          </p>
                        </div>
                        {wallet.lockedBalance > 0 && (
                          <div className="rounded-md border border-border bg-secondary/30 px-2.5 py-1">
                            <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                              Locked
                            </p>
                            <p className="mono-num text-xs text-muted-foreground">
                              {formatUsd(wallet.lockedBalance)}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    <Link
                      href={`/profile/${encodeURIComponent(user.username)}`}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 transition-colors hover:bg-secondary/50"
                      title={COPY.nav.myProfile}
                    >
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-[11px] font-semibold text-foreground">
                        {user.username.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="hidden leading-tight sm:block pr-1">
                        <p className="flex items-center gap-1 text-[13px] font-medium">
                          {user.username}
                          {user.isPremium && <PremiumBadge />}
                        </p>
                        <p className="mono-num text-[11px] text-muted-foreground">
                          ELO {user.elo}
                          <span className="mx-1 opacity-40">·</span>
                          {user.wins}W/{user.losses}L
                        </p>
                      </div>
                    </Link>
                  </>
                )}
                {user.isDemoGuest ? (
                  <Button size="sm" asChild>
                    <Link href="/register?next=/lobby">{COPY.nav.playReal}</Link>
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    logout();
                    router.push(user.isDemoGuest ? '/' : '/lobby');
                  }}
                  title={COPY.nav.signOut}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="hidden sm:inline-flex"
                >
                  <Link href={buildLoginUrl(pathname)}>
                    <LogIn className="h-3.5 w-3.5" />
                    {COPY.nav.signIn}
                  </Link>
                </Button>
                <Button size="sm" asChild>
                  <Link href="/demo">{COPY.nav.playFree}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main
        className={cn(
          'w-full flex-1',
          isArena ? 'max-w-none px-0 py-0' : 'mx-auto max-w-7xl px-4 py-8',
        )}
      >
        {children}
      </main>

      {!isArena && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-xl md:hidden">
          <div className="flex justify-around py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-medium',
                    active ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </Link>
              );
            })}
            {!user && (
              <Link
                href={buildLoginUrl(pathname)}
                className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-medium text-primary"
              >
                <LogIn className="h-5 w-5" />
                {COPY.nav.signIn}
              </Link>
            )}
          </div>
        </nav>
      )}

      {!isArena && user && !user.isDemoGuest && <OnboardingHost />}
    </div>
  );
}

'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { buildLoginUrl } from '@/lib/auth-redirect';

/**
 * Devuelve true si hay sesión.
 * Si no, redirige a /login?next=… y retorna false.
 */
export function useRequireAuth() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  return useCallback(
    (reason?: string): boolean => {
      if (user) return true;
      const qs = search?.toString();
      const returnTo = qs ? `${pathname}?${qs}` : pathname;
      router.push(buildLoginUrl(returnTo, reason));
      return false;
    },
    [user, router, pathname, search],
  );
}

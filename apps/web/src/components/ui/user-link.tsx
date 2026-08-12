'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

interface UserLinkProps {
  username: string;
  className?: string;
  children?: React.ReactNode;
  /** Prefijo @ */
  withAt?: boolean;
}

export function UserLink({
  username,
  className,
  children,
  withAt = true,
}: UserLinkProps) {
  return (
    <Link
      href={`/profile/${encodeURIComponent(username)}`}
      className={cn(
        'font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-2',
        className,
      )}
    >
      {children ?? (withAt ? `@${username}` : username)}
    </Link>
  );
}

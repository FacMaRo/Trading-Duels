'use client';

import { Crown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PremiumBadgeProps {
  className?: string;
  /** compact = solo corona; default = PRO */
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

/** Badge discreto de plan Premium */
export function PremiumBadge({
  className,
  size = 'sm',
  showLabel = true,
}: PremiumBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded border border-amber-500/25 bg-amber-500/10 font-semibold text-amber-200/90',
        size === 'sm' && 'px-1 py-0 text-[9px] tracking-wide',
        size === 'md' && 'px-1.5 py-0.5 text-[10px] tracking-wide',
        className,
      )}
      title="Premium"
    >
      <Crown
        className={cn(size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3')}
        strokeWidth={2.25}
      />
      {showLabel && <span>PRO</span>}
    </span>
  );
}

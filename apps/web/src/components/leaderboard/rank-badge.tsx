'use client';

import { cn } from '@/lib/utils';
import { RANK_TONE_STYLES, toneForTier } from '@/lib/ranks';

interface RankBadgeProps {
  tierId: string;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function RankBadge({
  tierId,
  label,
  size = 'sm',
  className,
}: RankBadgeProps) {
  const tone = toneForTier(tierId);
  const styles = RANK_TONE_STYLES[tone];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-semibold tracking-wide',
        styles.badge,
        size === 'sm' && 'px-2 py-0.5 text-[10px] uppercase',
        size === 'md' && 'px-2.5 py-1 text-xs uppercase',
        className,
      )}
    >
      {label}
    </span>
  );
}

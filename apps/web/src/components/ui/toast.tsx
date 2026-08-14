'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastTone = 'info' | 'success' | 'danger' | 'neutral';

export interface ToastItem {
  id: string;
  message: string;
  tone?: ToastTone;
  /** Override auto-dismiss ms (default ~2.8s; prize/rank can use up to 4s) */
  durationMs?: number;
}

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  /**
   * Layout slot for arena — never bottom-right over the order form.
   * @default 'top-right'
   */
  position?: 'top-right' | 'top-center' | 'bottom-right';
  /** Max cards shown (older dropped). @default 3 */
  maxVisible?: number;
}

const TONE: Record<ToastTone, string> = {
  info: 'border-primary/35 bg-primary/12 text-primary',
  success: 'border-success/35 bg-success/12 text-success',
  danger: 'border-destructive/35 bg-destructive/12 text-destructive',
  neutral: 'border-border/80 bg-card/95 text-foreground',
};

const POSITION: Record<NonNullable<ToastStackProps['position']>, string> = {
  // Under header/timer — clear of order form + My trades
  'top-right':
    'fixed top-14 right-2 z-[60] sm:top-16 sm:right-3',
  'top-center':
    'fixed top-14 left-1/2 z-[60] -translate-x-1/2 sm:top-16',
  'bottom-right': 'fixed bottom-4 right-4 z-[60]',
};

/** Compact fixed toast stack for arena feedback (non-blocking) */
export function ToastStack({
  toasts,
  onDismiss,
  position = 'top-right',
  maxVisible = 3,
}: ToastStackProps) {
  if (toasts.length === 0) return null;
  const visible = toasts.slice(-maxVisible);

  return (
    <div
      className={cn(
        // pointer-events-none on stack → only cards capture clicks
        'pointer-events-none flex w-[min(100vw-1rem,16.5rem)] flex-col gap-1.5',
        POSITION[position],
      )}
      aria-live="polite"
    >
      {visible.map((t) => (
        <ToastCard
          key={t.id}
          item={t}
          onDismiss={() => onDismiss(t.id)}
        />
      ))}
    </div>
  );
}

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  const duration =
    item.durationMs ??
    (item.tone === 'success' || item.tone === 'danger' ? 3200 : 2800);

  useEffect(() => {
    const t = setTimeout(onDismiss, Math.min(Math.max(duration, 2000), 4000));
    return () => clearTimeout(t);
  }, [onDismiss, duration]);

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] leading-snug shadow-sm backdrop-blur-sm animate-slide-up',
        TONE[item.tone ?? 'neutral'],
      )}
      role="status"
    >
      <p className="min-w-0 flex-1 truncate font-medium text-foreground/95">
        {item.message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

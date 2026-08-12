'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastTone = 'info' | 'success' | 'danger' | 'neutral';

export interface ToastItem {
  id: string;
  message: string;
  tone?: ToastTone;
}

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const TONE: Record<ToastTone, string> = {
  info: 'border-primary/40 bg-primary/15 text-primary',
  success: 'border-success/40 bg-success/15 text-success',
  danger: 'border-destructive/40 bg-destructive/15 text-destructive',
  neutral: 'border-border bg-card text-foreground',
};

/** Lightweight fixed toast stack for arena feedback */
export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(100vw-2rem,20rem)] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
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
  useEffect(() => {
    const t = setTimeout(onDismiss, 4200);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm shadow-panel animate-slide-up',
        TONE[item.tone ?? 'neutral'],
      )}
      role="status"
    >
      <p className="flex-1 leading-snug text-foreground">{item.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

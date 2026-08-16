'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface PriceInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'onChange' | 'inputMode' | 'defaultValue'
  > {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Free-text price field for trading (SL / TP / Entry).
 * Native type="text" only — never type="number" (breaks controlled decimals).
 */
export const PriceInput = React.forwardRef<HTMLInputElement, PriceInputProps>(
  (
    {
      value,
      onChange,
      className,
      disabled,
      placeholder = '0.00000',
      id,
      name,
      onBlur,
      onFocus,
      onKeyDown,
      ...rest
    },
    ref,
  ) => {
    // Drop number-input attrs if a parent passes them
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { step, min, max, ...inputRest } = rest as typeof rest & {
      step?: unknown;
      min?: unknown;
      max?: unknown;
    };

    return (
      <input
        {...inputRest}
        ref={ref}
        id={id}
        name={name}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        // Siempre texto libre — después de rest para no ser pisado
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => {
          onChange(normalizePriceTyping(e.target.value));
        }}
        onKeyDown={(e) => {
          // Bloquear flechas arriba/abajo que en algunos browsers mutan números
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
          }
          onKeyDown?.(e);
        }}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm',
          'font-mono tabular-nums tracking-wide',
          'ring-offset-background placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      />
    );
  },
);
PriceInput.displayName = 'PriceInput';

/**
 * Normaliza lo que el usuario escribe SIN parsear a Number.
 * - Coma → punto
 * - Solo dígitos y un separador decimal
 * - Mantiene borradores válidos: "", "1", "1.", "1.08", ".5"
 */
export function normalizePriceTyping(raw: string): string {
  if (raw == null) return '';
  const s = String(raw).replace(/\s/g, '').replace(/,/g, '.');

  let out = '';
  let seenDot = false;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
      continue;
    }
    if (ch === '.' && !seenDot) {
      out += '.';
      seenDot = true;
    }
  }
  return out;
}

/** Parsea precio final al enviar; null si vacío o inválido */
export function parsePrice(raw: string): number | null {
  const s = String(raw ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/,/g, '.');
  if (!s || s === '.') return null;
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Validate SL direction vs a reference price.
 * OPEN trade edits pass **current mid** (entry is not a barrier — break-even / profit SL allowed).
 * New orders / PENDING pass **entry**.
 * LONG → SL < ref · SHORT → SL > ref
 */
export function validateStopLossSide(
  side: 'LONG' | 'SHORT',
  stopLoss: number,
  referencePrice: number,
  opts?: { vsCurrentPrice?: boolean },
): { ok: true } | { ok: false; message: string } {
  if (!(referencePrice > 0) || !(stopLoss > 0)) {
    return { ok: false, message: 'Invalid reference price or stop loss' };
  }
  const vsMid = !!opts?.vsCurrentPrice;
  if (side === 'LONG') {
    if (!(stopLoss < referencePrice)) {
      return {
        ok: false,
        message: vsMid
          ? 'Stop loss must be below current price for LONG'
          : `On LONG, stop loss must be below price (${formatPriceHint(referencePrice)})`,
      };
    }
  } else if (!(stopLoss > referencePrice)) {
    return {
      ok: false,
      message: vsMid
        ? 'Stop loss must be above current price for SHORT'
        : `On SHORT, stop loss must be above price (${formatPriceHint(referencePrice)})`,
    };
  }
  return { ok: true };
}

export function validateTakeProfitSide(
  side: 'LONG' | 'SHORT',
  takeProfit: number,
  referencePrice: number,
  opts?: { vsCurrentPrice?: boolean },
): { ok: true } | { ok: false; message: string } {
  if (!(referencePrice > 0) || !(takeProfit > 0)) {
    return { ok: false, message: 'Invalid reference price or take profit' };
  }
  const vsMid = !!opts?.vsCurrentPrice;
  if (side === 'LONG') {
    if (!(takeProfit > referencePrice)) {
      return {
        ok: false,
        message: vsMid
          ? 'Take profit must be above current price for LONG'
          : `On LONG, take profit must be above price (${formatPriceHint(referencePrice)})`,
      };
    }
  } else if (!(takeProfit < referencePrice)) {
    return {
      ok: false,
      message: vsMid
        ? 'Take profit must be below current price for SHORT'
        : `On SHORT, take profit must be below price (${formatPriceHint(referencePrice)})`,
    };
  }
  return { ok: true };
}

function formatPriceHint(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 10) return n.toFixed(3);
  return n.toFixed(5);
}

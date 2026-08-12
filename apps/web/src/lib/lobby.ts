/** Lobby UI config */

export type LobbyMode = 'BLITZ' | 'NORMAL' | 'SLOW';
export type SessionWindow = 'TOKYO' | 'LONDON' | 'NY';

export const LOBBY_MODES: {
  id: LobbyMode;
  label: string;
  tagline: string;
  duration: string;
  accent: string;
  ring: string;
}[] = [
  {
    id: 'BLITZ',
    label: 'Blitz',
    tagline: 'Quick match',
    duration: '2+8 min · 2 trades',
    accent: 'text-foreground',
    ring: 'border-border bg-secondary/60 ring-1 ring-border',
  },
  {
    id: 'NORMAL',
    label: 'Normal',
    tagline: 'Balanced',
    duration: '5+15 min · 3 trades',
    accent: 'text-primary',
    ring: 'border-primary/35 bg-primary/8 ring-1 ring-primary/25',
  },
  {
    id: 'SLOW',
    label: 'Slow',
    tagline: 'Full session',
    duration: '30m+2h · 5 trades',
    accent: 'text-foreground',
    ring: 'border-border bg-secondary/60 ring-1 ring-border',
  },
];

export const STAKE_PRESETS = [3, 5, 10, 25, 50, 100] as const;

export const SESSIONS: { id: SessionWindow; label: string; hint: string }[] = [
  { id: 'TOKYO', label: 'Tokyo', hint: 'Asia' },
  { id: 'LONDON', label: 'London', hint: 'Europe' },
  { id: 'NY', label: 'New York', hint: 'US' },
];

export function modeMeta(mode: string) {
  return LOBBY_MODES.find((m) => m.id === mode) ?? LOBBY_MODES[1];
}

export function formatSearchElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Soft wait estimate based on expanded ELO range */
export function estimateWaitLabel(eloRange: number): string {
  if (eloRange <= 200) return '~30–90 s';
  if (eloRange <= 400) return '~1–3 min';
  return 'expanding range…';
}

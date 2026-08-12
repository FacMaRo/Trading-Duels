/**
 * Minimal professional SFX hooks for BR arena.
 * Muted by default — enable via localStorage td_sfx=1 or setSfxEnabled(true).
 * Uses Web Audio beeps (no asset files).
 */

let enabled: boolean | null = null;
let ctx: AudioContext | null = null;

export function isSfxEnabled(): boolean {
  if (enabled != null) return enabled;
  if (typeof window === 'undefined') return false;
  try {
    enabled = localStorage.getItem('td_sfx') === '1';
  } catch {
    enabled = false;
  }
  return enabled;
}

export function setSfxEnabled(on: boolean) {
  enabled = on;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('td_sfx', on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function beep(freq: number, durMs: number, gain = 0.04, type: OscillatorType = 'sine') {
  if (!isSfxEnabled()) return;
  try {
    const ac = getCtx();
    if (!ac) return;
    void ac.resume();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(ac.destination);
    const t0 = ac.currentTime;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + durMs / 1000);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000);
  } catch {
    /* ignore */
  }
}

export const arenaSfx = {
  zoneUp: () => {
    beep(520, 80, 0.035);
    setTimeout(() => beep(720, 90, 0.03), 70);
  },
  zoneDown: () => beep(280, 100, 0.03, 'triangle'),
  tradeOpen: () => beep(440, 60, 0.025),
  limitFill: () => {
    beep(480, 50, 0.03);
    setTimeout(() => beep(640, 70, 0.028), 50);
  },
  matchEnd: () => {
    beep(360, 120, 0.035);
    setTimeout(() => beep(300, 160, 0.03), 100);
  },
};

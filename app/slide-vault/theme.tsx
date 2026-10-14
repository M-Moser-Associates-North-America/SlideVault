'use client';

import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';

/**
 * The shell owns the theme (docs/DESIGN_SYSTEM.md): the workspace only receives it through the runtime.
 * The choice is remembered in this browser; the first visit follows the system setting.
 */
type Theme = 'light' | 'dark';
const KEY = 'slidevault:theme';
const listeners = new Set<() => void>();

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null; // storage blocked: fall back to the system setting
  }
}
const systemTheme = (): Theme => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const snapshot = (): Theme => readStored() ?? systemTheme();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, snapshot, () => 'light' as Theme);
  const [, force] = useState(0);
  const toggle = useCallback(() => {
    const next: Theme = snapshot() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked: the choice lasts until reload */
    }
    listeners.forEach((l) => l());
    force((n) => n + 1);
  }, []);
  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className={className} onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

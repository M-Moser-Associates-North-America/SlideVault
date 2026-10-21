import { useCallback, useSyncExternalStore } from 'react';

/**
 * Where the main tabs sit on a phone: at the bottom (the default, within thumb's reach) or at the top
 * like on larger screens. Remembered in this browser. Opening any page with `?nav=top` or `?nav=bottom`
 * sets it, which makes it easy to show both versions from a link. Tablets and desktops always use the top.
 */
export type NavPlacement = 'top' | 'bottom';

const KEY = 'slidevault:nav';
const listeners = new Set<() => void>();
let current: NavPlacement | null = null;
let started = false;

const valid = (v: string | null): v is NavPlacement => v === 'top' || v === 'bottom';

function read(): NavPlacement {
  if (!started) {
    started = true;
    try {
      const fromLink = new URLSearchParams(window.location.search).get('nav');
      if (valid(fromLink)) {
        current = fromLink;
        localStorage.setItem(KEY, fromLink);
      }
    } catch {
      /* no link value or storage blocked: fall through to what is remembered */
    }
  }
  if (current) return current;
  try {
    const saved = localStorage.getItem(KEY);
    if (valid(saved)) current = saved;
  } catch {
    /* storage blocked: the default applies for this visit */
  }
  return current ?? 'bottom';
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useNavPlacement() {
  const placement = useSyncExternalStore(subscribe, read, () => 'bottom' as NavPlacement);
  const setPlacement = useCallback((next: NavPlacement) => {
    current = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* kept for this visit only */
    }
    listeners.forEach((l) => l());
  }, []);
  return { placement, setPlacement };
}

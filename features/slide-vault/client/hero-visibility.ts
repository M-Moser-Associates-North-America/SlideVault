import { useSyncExternalStore } from 'react';

/**
 * Whether the big search bar on Home has scrolled out of sight. The header shows a slim search
 * shortcut while it has. Kept in a tiny shared store so the header and the page can talk to each other.
 */
let out = false;
const listeners = new Set<() => void>();

export function setHeroOut(next: boolean) {
  if (out === next) return;
  out = next;
  listeners.forEach((l) => l());
}

export function useHeroOut(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => out,
    () => false,
  );
}

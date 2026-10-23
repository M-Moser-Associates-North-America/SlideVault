import { useSyncExternalStore } from 'react';

/**
 * Whether the quick tour is showing. A tiny shared store so the header's tour button (app shell)
 * and the tour itself (inside the workspace) can talk to each other.
 */
let open = false;
const listeners = new Set<() => void>();
const set = (next: boolean) => {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
};

export const startTour = () => set(true);
export const endTour = () => set(false);

export function useTourOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => open,
    () => false,
  );
}

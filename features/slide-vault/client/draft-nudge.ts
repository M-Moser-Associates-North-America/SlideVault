import { useSyncExternalStore } from 'react';

/**
 * The orange ring that revolves around the Draft deck button. It starts every time the person arrives on
 * Home and stops for that visit once they click the button. Kept in
 * memory only.
 */
export type Nudge = 'draft';
const on = new Set<Nudge>();
const listeners = new Set<() => void>();
let version = 0;

function change(name: Nudge, next: boolean) {
  if (on.has(name) === next) return;
  if (next) on.add(name);
  else on.delete(name);
  version++;
  listeners.forEach((l) => l());
}

export function startNudges() {
  change('draft', true);
}
export const stopNudge = (name: Nudge) => change(name, false);

export function useNudge(name: Nudge): boolean {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => version,
    () => 0,
  );
  return on.has(name);
}

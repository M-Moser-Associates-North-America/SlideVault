import { useSyncExternalStore } from 'react';

/**
 * Whether the draft deck holds slides that are not saved, and, when someone tries to sign out with them, the question
 * "sign out anyway?". The same kind of small shared store as the upload one, so the app shell's Sign out button (outside the workspace)
 * and the draft deck can talk to each other. Holds only a count, never the slides themselves. Nothing here is saved anywhere.
 */
let count = 0;
let pending: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setUnsavedDeck(n: number) {
  if (n === count) return;
  count = n;
  if (n === 0) pending = null;
  emit();
}

/** Run `leave` now when nothing would be lost; otherwise ask first (the workspace shows the question). */
export function askBeforeLosingDraftDeck(leave: () => void) {
  if (count === 0) {
    leave();
    return;
  }
  pending = leave;
  emit();
}

/** What was chosen: stay, or leave (with the draft deck cleared). `run` is what was waiting. */
export function takeLeaveAction(): (() => void) | null {
  const run = pending;
  pending = null;
  emit();
  return run;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
export function useUnsavedDeckQuestion(): { unsaved: number; asking: boolean } {
  const unsaved = useSyncExternalStore(subscribe, () => count, () => 0);
  const asking = useSyncExternalStore(subscribe, () => pending !== null, () => false);
  return { unsaved, asking };
}

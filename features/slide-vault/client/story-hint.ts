/**
 * "This sounds like a client brief" is a suggestion the person can wave away. Tapping outside it, pressing Escape, or going to the
 * Storyboard from it and coming back switch it off for the words that are in the search now. Any change to the words (or a new
 * search, even the same sentence again later) brings it back: the memory is cleared as soon as the words differ.
 * Kept in memory only (a reload starts fresh).
 */
import { useSyncExternalStore } from 'react';

let dismissed = '';
const listeners = new Set<() => void>();

export function dismissStoryHint(query: string): void {
  const q = query.trim();
  if (q === dismissed) return;
  dismissed = q;
  listeners.forEach((l) => l());
}

/** Forget the dismissal: the words in the search are no longer the ones that were waved away. */
export function clearStoryHint(): void {
  if (dismissed === '') return;
  dismissed = '';
  listeners.forEach((l) => l());
}

/** The words whose suggestion was dismissed ('' when none). */
export function useDismissedStoryHint(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => dismissed,
    () => '',
  );
}

/**
 * Whether a Storyboard button is on screen right now (Home, in the filter row). When it is, the hint is a callout beside it; when it is not
 * (a results page), the hint is the quiet line under the search, so the words are the way in.
 */
let buttons = 0;
const buttonListeners = new Set<() => void>();

export function registerStoryButton(): () => void {
  buttons += 1;
  buttonListeners.forEach((l) => l());
  return () => {
    buttons -= 1;
    buttonListeners.forEach((l) => l());
  };
}

export function useStoryButtonShown(): boolean {
  return useSyncExternalStore(
    (l) => {
      buttonListeners.add(l);
      return () => buttonListeners.delete(l);
    },
    () => buttons > 0,
    () => false,
  );
}

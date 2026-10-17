import { useCallback, useSyncExternalStore } from 'react';

/**
 * Remembers, in this browser, which one-time tips a person has already seen or dismissed.
 * Local design prototype: nothing here goes to a server.
 */
const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}
function write(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: remembered for this visit only */
  }
  listeners.forEach((l) => l());
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** `seen` is true on the server render so a tip never flashes before the browser's memory is read. */
export function useTipSeen(name: string) {
  const key = `slidevault:tip:${name}`;
  const seen = useSyncExternalStore(
    subscribe,
    () => read(key) === '1',
    () => true,
  );
  const dismiss = useCallback(() => write(key, '1'), [key]);
  return { seen, dismiss };
}

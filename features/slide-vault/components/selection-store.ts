import { useCallback, useSyncExternalStore } from 'react';

/**
 * The ordered slide selection, kept in this browser's localStorage so it survives a reload.
 * Prototype only: a saved, shareable selection belongs on the server (client acceptance PR-06).
 */
const STORAGE_KEY = 'slidevault:selection:v1';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '[]';
  } catch {
    return memory; // storage blocked (private mode etc.): fall back to this visit only
  }
}
let memory = '[]';

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && onChange(); // other tabs
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function write(next: number[]) {
  memory = JSON.stringify(next);
  try {
    localStorage.setItem(STORAGE_KEY, memory);
  } catch {
    /* storage blocked: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function useSelection(isValid: (n: number) => boolean) {
  const raw = useSyncExternalStore(subscribe, read, () => '[]');
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* corrupt value: treat as empty */
  }
  const selection = Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number' && isValid(n)) : [];

  const update = useCallback((fn: (cur: number[]) => number[]) => {
    const cur = JSON.parse(read()) as number[];
    write(fn(Array.isArray(cur) ? cur : []));
  }, []);

  return [selection, update] as const;
}

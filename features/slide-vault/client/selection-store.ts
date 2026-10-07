import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { SlideSummary } from '../contracts/dto';

/**
 * The ordered selection of slides to export, kept in this browser's localStorage so it survives
 * a reload. Keyed by the runtime's sessionScopeKey, so a different user or access scope never sees
 * another's selection (docs/INTEGRATION_CONTRACT.md).
 *
 * Prototype (decision FD-06): saved, shareable selections belong on the server (PR-06).
 */
const keyFor = (scope: string) => `slidevault:${scope}:selection:v2`;
const listeners = new Set<() => void>();
const memory = new Map<string, string>(); // fallback when storage is blocked

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '[]';
  } catch {
    return memory.get(key) ?? '[]';
  }
}

function write(key: string, items: SlideSummary[]) {
  const raw = JSON.stringify(items);
  memory.set(key, raw);
  try {
    localStorage.setItem(key, raw);
  } catch {
    /* storage blocked: memory only, for this visit */
  }
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => e.key?.startsWith('slidevault:') && onChange(); // other tabs
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function parse(raw: string): SlideSummary[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as SlideSummary[]).filter((s) => typeof s?.id === 'string') : [];
  } catch {
    return [];
  }
}

export function useSelection(sessionScopeKey: string) {
  const key = keyFor(sessionScopeKey);
  const raw = useSyncExternalStore(subscribe, () => read(key), () => '[]');
  const selection = useMemo(() => parse(raw), [raw]);
  const update = useCallback((fn: (current: SlideSummary[]) => SlideSummary[]) => write(key, fn(parse(read(key)))), [key]);
  return [selection, update] as const;
}

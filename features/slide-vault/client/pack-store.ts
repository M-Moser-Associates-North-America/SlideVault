import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * Packs made in this browser, for the time before the server stores them (FD-38). Once the server's
 * pack calls exist, new packs go there and this only holds what the server could not take.
 * `hidden` lists server packs the person ungrouped while the server could not forget them.
 */
export type LocalPack = { id: string; label: string | null; deckId: string; slideIds: string[] };
/** A confirm or unconfirm made in this browser while the server cannot store it. */
export type LocalStatus = { status: 'suggested' | 'confirmed'; by: string | null; at: string | null };
export type LocalPacks = { packs: LocalPack[]; hidden: string[]; status: Record<string, LocalStatus> };

const EMPTY: LocalPacks = { packs: [], hidden: [], status: {} };
const keyFor = (scope: string) => `slidevault:${scope}:packs:v1`;
const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return memory.get(key) ?? '';
  }
}
function write(key: string, value: LocalPacks) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    localStorage.setItem(key, raw);
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
function parse(raw: string): LocalPacks {
  try {
    const v = JSON.parse(raw) as Partial<LocalPacks>;
    return { packs: Array.isArray(v.packs) ? v.packs : [], hidden: Array.isArray(v.hidden) ? v.hidden : [], status: v.status && typeof v.status === 'object' ? v.status : {} };
  } catch {
    return EMPTY;
  }
}

export function useLocalPacks(scope: string) {
  const key = keyFor(scope);
  const raw = useSyncExternalStore(subscribe, () => read(key), () => '');
  const state = useMemo(() => parse(raw), [raw]);
  const update = useCallback((fn: (cur: LocalPacks) => LocalPacks) => write(key, fn(parse(read(key)))), [key]);
  return [state, update] as const;
}

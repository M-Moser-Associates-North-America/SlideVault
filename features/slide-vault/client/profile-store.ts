import { useCallback, useSyncExternalStore } from 'react';
import type { SlideSummary } from '../contracts/dto';

/**
 * Local design prototype: fake sign-in, saved slides and a simple activity record, all kept in
 * this browser's localStorage. Mirrors selection-store.ts's pattern (docs/DECISIONS.md FD-06 is
 * still the real plan; this is a mockup for the pitch, not a real auth or saved-selection system).
 */
export type ActivityEntry = { kind: 'viewed' | 'downloaded'; label: string; at: number; slideId?: string };
// Higher than a simple recent-activity list would need, because Top 10 (Views.tsx TopTenRow)
// counts how often each slide shows up in this history to rank "what this profile uses most."
const ACTIVITY_LIMIT = 60;
const PROFILE_KEY = 'slidevault:profile';
const savedKey = (profile: string) => `slidevault:${profile}:saved`;
const activityKey = (profile: string) => `slidevault:${profile}:activity`;

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}
function write(key: string, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: memory only, for this visit */
  }
  listeners.forEach((l) => l());
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => e.key?.startsWith('slidevault:') && onChange();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useProfile() {
  const profile = useSyncExternalStore(subscribe, () => read(PROFILE_KEY), () => null);
  const signIn = useCallback((name: string) => write(PROFILE_KEY, name), []);
  const signOut = useCallback(() => write(PROFILE_KEY, null), []);
  return { profile, signIn, signOut };
}

function parseStrings(raw: string | null): string[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function useSaved(profile: string | null) {
  const key = profile ? savedKey(profile) : null;
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
  const ids = new Set(key ? parseStrings(raw) : []);
  const toggle = useCallback(
    (slide: SlideSummary) => {
      if (!key) return;
      const current = new Set(parseStrings(read(key)));
      if (current.has(slide.id)) current.delete(slide.id);
      else current.add(slide.id);
      write(key, JSON.stringify([...current]));
    },
    [key],
  );
  return { ids, toggle };
}

function parseActivity(raw: string | null): ActivityEntry[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? (value as ActivityEntry[]) : [];
  } catch {
    return [];
  }
}

export function useActivity(profile: string | null) {
  const key = profile ? activityKey(profile) : null;
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
  const entries = key ? parseActivity(raw) : [];
  const log = useCallback(
    (kind: ActivityEntry['kind'], label: string, slideId?: string) => {
      if (!key) return;
      const next = [{ kind, label, at: Date.now(), slideId }, ...parseActivity(read(key))].slice(0, ACTIVITY_LIMIT);
      write(key, JSON.stringify(next));
    },
    [key],
  );
  return { entries, log };
}

/** A named set of slides kept under "My decks" -> Working drafts. */
export type Draft = { id: string; name: string; slideIds: string[]; savedAt: number };
const draftsKey = (profile: string) => `slidevault:${profile}:drafts`;

function parseDrafts(raw: string | null): Draft[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? (value as Draft[]).filter((d) => d && typeof d.id === 'string' && Array.isArray(d.slideIds)) : [];
  } catch {
    return [];
  }
}

export function useDrafts(profile: string | null) {
  const key = profile ? draftsKey(profile) : null;
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
  const drafts = key ? parseDrafts(raw) : [];
  const save = useCallback(
    (name: string, slideIds: string[]) => {
      if (!key) return;
      const draft: Draft = { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, slideIds, savedAt: Date.now() };
      write(key, JSON.stringify([draft, ...parseDrafts(read(key))]));
    },
    [key],
  );
  const remove = useCallback(
    (id: string) => {
      if (!key) return;
      write(key, JSON.stringify(parseDrafts(read(key)).filter((d) => d.id !== id)));
    },
    [key],
  );
  return { drafts, save, remove };
}

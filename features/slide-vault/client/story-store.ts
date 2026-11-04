import { useCallback, useSyncExternalStore } from 'react';
import type { StoryboardResult } from '../contracts/dto';

/**
 * Stories this person built lately (FD-30), kept in this browser per signed-in name so one can be
 * opened again without waiting for the AI. A convenience only: if storage is blocked or cleared the
 * list is simply empty. It moves to the server with the rest of the profile once M Moser's login
 * plugs in.
 */
export type SavedStory = { at: number; brief: string; result: StoryboardResult };

const MAX_SAVED = 6;
const key = (profile: string) => `slidevault:${profile}:stories`;
const listeners = new Set<() => void>();
const NONE: SavedStory[] = [];
// The snapshot must be the same array until storage changes, or React re-renders forever.
let cache: { raw: string | null; list: SavedStory[] } = { raw: null, list: NONE };

function read(profile: string | null): SavedStory[] {
  if (!profile) return NONE;
  try {
    const raw = localStorage.getItem(key(profile));
    if (raw !== cache.raw) {
      const v = JSON.parse(raw ?? '[]') as SavedStory[];
      cache = { raw, list: Array.isArray(v) ? v.filter((s) => Array.isArray(s?.result?.beats)) : NONE };
    }
    return cache.list;
  } catch {
    return NONE;
  }
}

export function useSavedStories(profile: string | null) {
  const stories = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => read(profile),
    () => NONE,
  );
  const save = useCallback(
    (story: SavedStory) => {
      if (!profile) return;
      try {
        const next = [story, ...read(profile).filter((s) => s.brief !== story.brief)].slice(0, MAX_SAVED);
        localStorage.setItem(key(profile), JSON.stringify(next));
      } catch {
        // Private window or full storage: the story still shows, it just isn't kept.
      }
      listeners.forEach((l) => l());
    },
    [profile],
  );
  return { stories, save };
}

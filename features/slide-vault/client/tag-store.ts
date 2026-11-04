import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { FreeTag, SlideSummary, TagRemoval } from '../contracts/dto';
import { addTag, listRemovedTags, removeTag, restoreTag, type Transport } from './api';

/**
 * Tags on a slide or a deck, shared by every screen that shows them (card, preview, slide page, deck
 * page) so a change made in one place shows in all of them straight away (FD-72). Anyone signed in
 * can add and remove; the screens hide the add and remove buttons when the host withholds
 * `metadata.edit`, and the server has the last word.
 *
 * Restore and the removal log are asked for from the server, not built yet: those calls come back
 * null, and the screen then says "isn't available yet" and changes nothing. ?demotags=1 in the
 * address shows pretend tags (and pretend votes and comments on slides) that you can use, all kept
 * in this browser tab only.
 */
type Entry = { tags: FreeTag[]; removed: TagRemoval[]; removedLoaded: boolean };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const put = (key: string, entry: Entry) => {
  entries.set(key, entry);
  listeners.forEach((l) => l());
};

/** Newest first. */
export const ranked = (tags: FreeTag[]) => [...tags].sort((a, b) => b.addedAt.localeCompare(a.addedAt));

export class TagsUnavailable extends Error {}

/* ---------------------------------------------------------------- Pretend tags (?demotags=1) */

export function demoTagsOn(): boolean {
  try {
    if (/[?&]demotags\b/.test(window.location.search)) sessionStorage.setItem('slidevault:demotags', '1');
    return sessionStorage.getItem('slidevault:demotags') === '1';
  } catch {
    return false;
  }
}

const PEOPLE = ['Priya Shah', 'Sam Lee', 'Maya Chen', 'Jordan Ellis'];
const SLIDE_TAGS = ['healthcare', 'case study', 'hospitality', 'workplace strategy', 'banner', 'team', 'awards', 'sustainability'];
const DECK_TAGS = ['Design Consultancy', 'Toronto', '2026 pitch'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function demoTags(on: 'slide' | 'deck', id: string): FreeTag[] {
  const h = hash(`${on}${id}`);
  const pool = on === 'slide' ? SLIDE_TAGS : DECK_TAGS;
  const count = on === 'slide' ? h % 4 : h % 3;
  return Array.from({ length: count }, (_, i) => {
    const tag = pool[(h + i * 3) % pool.length];
    return {
      id: `demo-${on}-${id}-${tag}`,
      tag,
      on,
      addedBy: PEOPLE[(h + i) % PEOPLE.length],
      addedAt: new Date(Date.UTC(2026, 9, 20 + ((h + i) % 9))).toISOString(),
    };
  }).filter((t, i, all) => all.findIndex((x) => x.tag === t.tag) === i);
}

/* ---------------------------------------------------------------- The hook */

export type TagsApi = {
  /** The tags, newest first */
  shown: FreeTag[];
  /** Removed tags, newest first (empty until the server keeps a log, or in the demo) */
  removed: TagRemoval[];
  add: (name: string) => Promise<void>;
  remove: (tag: FreeTag) => Promise<void>;
  restore: (removal: TagRemoval) => Promise<void>;
};

/**
 * `seed` is what the server already sent with the slide (SlideSummary.tags, own and deck together);
 * the hook keeps the ones on `on`. `who` is the signed-in person's name, for the pretend tags only.
 */
export function useTags(runtime: Transport, who: string | null, on: 'slide' | 'deck', id: string, seed?: FreeTag[], loadLog = false): TagsApi {
  const key = `${on}:${id}`;
  const entry = useSyncExternalStore(subscribe, () => entries.get(key), () => undefined);
  const demo = typeof window !== 'undefined' && demoTagsOn();
  const base = useMemo(() => entry?.tags ?? (demo ? demoTags(on, id) : (seed ?? []).filter((t) => t.on === on)), [entry, demo, on, id, seed]);
  const current = () => entries.get(key)?.tags ?? base;
  const removedNow = () => entries.get(key)?.removed ?? [];
  const save = (tags: FreeTag[], removed = removedNow()) => put(key, { tags, removed, removedLoaded: entries.get(key)?.removedLoaded ?? false });

  /* The server's removal log, once, for the full editor only (cards never ask). */
  useEffect(() => {
    if (!loadLog || demo || entries.get(key)?.removedLoaded) return;
    const controller = new AbortController();
    listRemovedTags(runtime, on, id, controller.signal).then(
      (list) => list && put(key, { tags: entries.get(key)?.tags ?? base, removed: list, removedLoaded: true }),
      () => {},
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLog, demo, key]);

  return useMemo<TagsApi>(() => {
    const sorted = ranked(base);
    return {
      shown: sorted,
      removed: entry?.removed ?? [],
      async add(name) {
        const have = current().find((t) => t.tag.toLowerCase() === name.toLowerCase());
        if (have) return;
        if (demo) {
          save([...current(), { id: `demo-${on}-${id}-${name}`, tag: name, on, addedBy: who ?? 'You', addedAt: new Date().toISOString() }]);
          return;
        }
        const saved = await addTag(runtime, on, id, name);
        if (!saved) throw new TagsUnavailable("Tags can't be saved yet: this server has no tag route.");
        save([...current().filter((t) => t.id !== saved.id), saved]);
      },
      async remove(tag) {
        if (!demo && !(await removeTag(runtime, tag.id))) throw new TagsUnavailable("Tags can't be removed yet: this server has no tag route.");
        const gone: TagRemoval = { id: tag.id, tag: tag.tag, on: tag.on, addedBy: tag.addedBy, removedBy: who ?? 'You', removedAt: new Date().toISOString() };
        save(
          current().filter((t) => t.id !== tag.id),
          [gone, ...removedNow().filter((r) => r.id !== tag.id)],
        );
      },
      async restore(removal) {
        if (demo) {
          save([...current(), { id: removal.id, tag: removal.tag, on: removal.on, addedBy: removal.addedBy, addedAt: new Date().toISOString() }], removedNow().filter((r) => r.id !== removal.id));
          return;
        }
        const saved = await restoreTag(runtime, removal.id);
        if (!saved) throw new TagsUnavailable("Restoring isn't available yet: the server keeps no removal log.");
        save([...current().filter((t) => t.id !== saved.id), saved], removedNow().filter((r) => r.id !== removal.id));
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, entry, demo, runtime, who, on, id]);
}

/**
 * One tag on many slides at once (the draft deck's "Tag all"), through the same route as one slide,
 * so each card shows it straight away. Slides that already carry it are skipped. Returns how many
 * slides got it; throws TagsUnavailable when the server has no tag route.
 */
export async function addTagToSlides(runtime: Transport, who: string | null, slides: SlideSummary[], name: string): Promise<number> {
  const demo = typeof window !== 'undefined' && demoTagsOn();
  let added = 0;
  for (const slide of slides) {
    const key = `slide:${slide.id}`;
    const now = entries.get(key)?.tags ?? (slide.tags ?? []).filter((t) => t.on === 'slide');
    if (now.some((t) => t.tag.toLowerCase() === name.toLowerCase())) continue;
    const saved = demo ? { id: `demo-slide-${slide.id}-${name}`, tag: name, on: 'slide' as const, addedBy: who ?? 'You', addedAt: new Date().toISOString() } : await addTag(runtime, 'slide', slide.id, name);
    if (!saved) throw new TagsUnavailable("Tags can't be saved yet: this server has no tag route.");
    put(key, { tags: [...now.filter((t) => t.id !== saved.id), saved], removed: entries.get(key)?.removed ?? [], removedLoaded: entries.get(key)?.removedLoaded ?? false });
    added++;
  }
  return added;
}

import type { SlideSummary } from '../contracts/dto';
import type { Draft } from './profile-store';

/** Where the draft deck stands against what is saved: nothing in it, never saved, saved and unchanged, or saved but changed since. */
export type DraftStatus = 'empty' | 'new' | 'saved' | 'changed';

/**
 * Saved means: it came from a saved deck, the same slides in the same order, and the same name.
 * `known` is every slide id the library shows now: saved slides that are hidden or gone from the library cannot be in the draft deck, so they do not count as a change.
 */
export function draftStatus(selection: SlideSummary[], origin: Draft | null, title: string, known?: ReadonlySet<string> | null): DraftStatus {
  if (selection.length === 0) return 'empty';
  if (!origin) return 'new';
  const saved = known ? origin.slideIds.filter((id) => known.has(id)) : origin.slideIds;
  const same = saved.length === selection.length && saved.every((id, i) => selection[i]?.id === id);
  const name = title.trim();
  return same && (name === '' || name === origin.name) ? 'saved' : 'changed';
}

/** Saved slide ids that are not in the library now (hidden, archived or removed): kept in the saved deck when it is updated. */
export function slidesOutOfSight(origin: Draft | null, known: ReadonlySet<string> | null | undefined, inDeck: ReadonlySet<string>): string[] {
  if (!origin || !known) return [];
  return origin.slideIds.filter((id) => !known.has(id) && !inDeck.has(id));
}

/** The draft deck as it was, so an Undo can put it back. */
export type DraftSnapshot = { slides: SlideSummary[]; title: string; originId: string | null; excluded?: string[] };

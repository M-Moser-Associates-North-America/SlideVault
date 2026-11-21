import type { SlideSummary } from '../contracts/dto';
import type { Draft } from './profile-store';

/** Where the draft deck stands against what is saved: nothing in it, never saved, saved and unchanged, or saved but changed since. */
export type DraftStatus = 'empty' | 'new' | 'saved' | 'changed';

/** Saved means: it came from a saved deck, the same slides in the same order, and the same name. */
export function draftStatus(selection: SlideSummary[], origin: Draft | null, title: string): DraftStatus {
  if (selection.length === 0) return 'empty';
  if (!origin) return 'new';
  const same = origin.slideIds.length === selection.length && origin.slideIds.every((id, i) => selection[i]?.id === id);
  const name = title.trim();
  return same && (name === '' || name === origin.name) ? 'saved' : 'changed';
}

/** The draft deck as it was, so an Undo can put it back. */
export type DraftSnapshot = { slides: SlideSummary[]; title: string; originId: string | null };

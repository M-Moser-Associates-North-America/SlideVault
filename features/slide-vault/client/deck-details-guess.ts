import { folderInfo } from '../server/folder-path';
import type { DeckPreview } from './pptx-preview';

/**
 * What the Upload screen can fill in for the person, and where each value came from, so the screen
 * can say so and the person can correct it. Real signals only, never a guess dressed up as a fact:
 *  - the file name, read by the same rules as the library import (M Moser's "M Moser_<Client>_<place>_<date>",
 *    "Client - Category", a category word in the name);
 *  - the year, if the file name has none, from the title slide when it names exactly one year.
 * Anything not found is left empty. server/folder-path.ts imports nothing, so it is safe in the browser bundle.
 */
export type DeckDetailsGuess = { client?: string; year?: string; category?: string; source: Partial<Record<'client' | 'year' | 'category', string>> };

export function guessFromFileName(fileName: string): DeckDetailsGuess {
  const f = folderInfo(fileName);
  const guess: DeckDetailsGuess = { source: {} };
  if (f.clientName) {
    guess.client = f.clientName;
    guess.source.client = 'the file name';
  }
  if (f.deckYear) {
    guess.year = String(f.deckYear);
    guess.source.year = 'the file name';
  }
  if (f.category) {
    guess.category = f.category;
    guess.source.category = 'the file name';
  }
  return guess;
}

/** A year that appears on the first slide, only when there is exactly one (a title slide saying "2026"). */
export function yearFromTitleSlide(preview: DeckPreview): string | null {
  const first = preview.slides[0];
  if (!first) return null;
  const years = new Set(`${first.title}\n${first.text}`.match(/\b20[0-4]\d\b/g) ?? []);
  return years.size === 1 ? [...years][0] : null;
}

import 'server-only';
import type { LibraryData, LibraryDeck, LibrarySlide } from '../../contracts/dto';
import { groupDuplicates } from '../duplicates';
import type { LibraryIndex } from '../library-repository';

type SlideWithoutGroup = Omit<LibrarySlide, 'duplicateGroupId'>;

/** Fixture-library decks in the same shape as uploaded ones. Folder details aren't known for these. */
export function fixtureLibrary(index: LibraryIndex | null): { decks: LibraryDeck[]; slides: SlideWithoutGroup[] } {
  const sources = index?.sources ?? [];
  return {
    decks: sources.map((s) => ({
      id: s.id, title: s.title, client: null, year: null, category: null, bestOfTheBest: false,
      slideSize: null, versionId: s.versionId, uploadedAt: null, source: 'fixture' as const,
    })),
    slides: sources.flatMap((s) =>
      s.slides.map((sl) => ({
        id: sl.id, deckId: s.id, slideNumber: sl.number, title: sl.title, text: sl.text,
        hiddenInSource: sl.hidden, previewPath: `/slides/${sl.id}/preview`,
      })),
    ),
  };
}

/** Put the parts together and mark duplicate groups across all of them. */
export function buildLibrary(parts: { decks: LibraryDeck[]; slides: SlideWithoutGroup[] }[]): LibraryData {
  const decks = parts.flatMap((p) => p.decks);
  const slides = parts.flatMap((p) => p.slides);
  const groups = groupDuplicates(slides.map((s) => ({ id: s.id, sourceId: s.deckId, title: s.title, text: s.text })));
  const groupOf = new Map(groups.flatMap((g) => g.slideIds.map((id) => [id, g.id] as const)));
  return { decks, slides: slides.map((s) => ({ ...s, duplicateGroupId: groupOf.get(s.id) ?? null })) };
}

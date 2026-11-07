import 'server-only';
import type { LibraryData, LibraryDeck, LibrarySlide } from '../../contracts/dto';
import { groupDuplicates } from '../duplicates';
import type { LibraryIndex } from '../library-repository';
import { deckFacts } from './search';

type SlideWithoutGroup = Omit<LibrarySlide, 'duplicateGroupId'>;

/** Library-folder decks in the same shape as uploaded ones, with what their catalog entry, folder and file name say. */
/**
 * A deck's client sector: the one most of its slides were reviewed as (FD-87), so "hospitality decks" finds
 * decks for hospitality clients even though no slide says "hospitality". Null when none of its slides say.
 */
export function deckSector(slideIds: string[], sectorOfSlide: (id: string) => string | undefined): string | null {
  const counts = new Map<string, number>();
  for (const id of slideIds) { const s = sectorOfSlide(id); if (s) counts.set(s, (counts.get(s) ?? 0) + 1); }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function fixtureLibrary(index: LibraryIndex | null, sectorOfSlide: (id: string) => string | undefined = () => undefined): { decks: LibraryDeck[]; slides: SlideWithoutGroup[] } {
  const sources = index?.sources ?? [];
  return {
    decks: sources.map((s) => {
      // The same deck facts as every slide summary, so browsing and search agree (FD-31).
      const f = deckFacts(s);
      return {
        id: s.id, title: f.title, client: f.clientName, year: f.deckYear, category: f.category, bestOfTheBest: f.bestOfTheBest, location: f.location, sector: deckSector(s.slides.map((sl) => sl.id), sectorOfSlide),
        slideSize: null, versionId: s.versionId, uploadedAt: null, source: 'fixture' as const,
      };
    }),
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

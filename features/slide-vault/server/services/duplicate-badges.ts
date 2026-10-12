import 'server-only';
import type { SlideSummary } from '../../contracts/dto';
import type { DuplicateGroup, SlideText } from '../duplicates';
import type { LibraryIndex } from '../library-repository';

/** Every fixture-library slide as text, for duplicate grouping. */
export const fixtureSlideTexts = (index: LibraryIndex | null): SlideText[] =>
  (index?.sources ?? []).flatMap((source) =>
    source.slides.map((slide) => ({ id: slide.id, sourceId: source.id, title: slide.title, text: slide.text })),
  );

/**
 * Turn search results into one card per duplicate group, marked "also in N decks".
 *
 *  - The first result from a group (in result order) is kept; later results from the same group
 *    are dropped from this list. Nothing is deleted: the other copies stay in the library, and
 *    the group id lets the screen list them.
 *  - otherDeckCount counts decks across the whole library, not just this page of results,
 *    so it stays the same whatever the search was.
 */
export function withDuplicateBadges(items: SlideSummary[], groups: DuplicateGroup[], slideDeck: Map<string, string>): SlideSummary[] {
  const groupOf = new Map<string, DuplicateGroup>();
  for (const g of groups) for (const id of g.slideIds) groupOf.set(id, g);

  const shown = new Set<string>();
  const out: SlideSummary[] = [];
  for (const item of items) {
    const group = groupOf.get(item.id);
    if (!group) {
      out.push({ ...item, alsoIn: null });
      continue;
    }
    if (shown.has(group.id)) continue;
    shown.add(group.id);
    const ownDeck = slideDeck.get(item.id) ?? item.provenance.sourceId;
    const otherDecks = new Set(group.slideIds.map((id) => slideDeck.get(id)).filter((d) => d && d !== ownDeck));
    out.push({ ...item, alsoIn: otherDecks.size ? { groupId: group.id, otherDeckCount: otherDecks.size, match: group.match } : null });
  }
  return out;
}

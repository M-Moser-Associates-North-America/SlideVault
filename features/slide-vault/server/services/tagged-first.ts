import type { SlideSummary } from '../../contracts/dto';
import { mentionsWord } from './smart-search';

/**
 * People's own tags lead a search (docs/DECISIONS.md FD-58). Gabby, 28 Oct: "once I have that page, I
 * would like to add tags and say, for example, Priya. So next time I look for it, I type Priya and
 * then SlideVault knows who Priya is." A slide tagged with what was typed comes first, then slides
 * whose deck carries the tag, then everything else as the search ranked it.
 */

export type TagHit = { tag: string; on: 'slide' | 'deck'; id: string };
type Item = { slide: SlideSummary; why: string; matched: string[] };

/** The tags whose words were typed, as whole words ("Priya" in "Priya resume", not "Moi"). */
export const typedTags = (query: string, hits: TagHit[]) => hits.filter((h) => mentionsWord(query, h.tag));

export async function taggedFirst(query: string, items: Item[], hits: TagHit[], fetch: (slideIds: string[]) => Promise<SlideSummary[]>): Promise<Item[]> {
  const typed = typedTags(query, hits);
  if (!typed.length) return items;
  const slideTag = new Map(typed.filter((h) => h.on === 'slide').map((h) => [h.id, h.tag]));
  const deckTag = new Map(typed.filter((h) => h.on === 'deck').map((h) => [h.id, h.tag]));
  const why = (tag: string, deck: boolean) => `Tagged “${tag}”${deck ? ' (its deck)' : ''} by someone on the team.`;

  const have = new Set(items.map((i) => i.slide.id));
  const missing = [...slideTag.keys()].filter((id) => !have.has(id));
  const fetched = missing.length ? await fetch(missing) : [];
  const all = [...items, ...fetched.map((slide) => ({ slide, why: '', matched: [] }))];

  const onSlide = all.filter((i) => slideTag.has(i.slide.id)).map((i) => ({ ...i, why: `${why(slideTag.get(i.slide.id)!, false)} ${i.why}`.trim() }));
  const onDeck = all.filter((i) => !slideTag.has(i.slide.id) && deckTag.has(i.slide.provenance.sourceId)).map((i) => ({ ...i, why: `${why(deckTag.get(i.slide.provenance.sourceId)!, true)} ${i.why}`.trim() }));
  const lifted = new Set([...onSlide, ...onDeck].map((i) => i.slide.id));
  return [...onSlide, ...onDeck, ...items.filter((i) => !lifted.has(i.slide.id))];
}

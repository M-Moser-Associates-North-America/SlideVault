import 'server-only';
import type { SlideSummary } from '../../contracts/dto';
import { folderInfo } from '../folder-path';
import type { IndexedSlide, IndexedSource, LibraryIndex } from '../library-repository';

/**
 * Slide-level keyword search (docs/DATA_AND_API.md, "Search and selection").
 * Every query word must appear in the slide title or text. Order is deterministic
 * (source title, slide number, then id) so cursors are stable.
 */

export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 100;

/** What is known about a deck: the deck catalog first (reviewed client, year, kind), then its folder and file name (FD-31). */
export function deckFacts(source: IndexedSource) {
  const named = folderInfo(source.fileName);
  const facts = { ...named, clientName: source.deck?.clientName ?? named.clientName, deckYear: source.deck?.deckYear ?? named.deckYear, category: source.deck?.category ?? named.category, location: source.deck?.location ?? named.location };
  // A deck is named for what it is ("Barlow's · RFP · 2025"), not its file name or a cover left as "Title of deck here".
  const title = source.deck?.title ?? (facts.clientName ? [facts.clientName, facts.category, facts.deckYear].filter(Boolean).join(' · ') : source.title);
  return { ...facts, title };
}

export function toSummary(source: IndexedSource, slide: IndexedSlide): SlideSummary {
  const deck = deckFacts(source);
  return {
    id: slide.id,
    title: slide.title,
    hiddenInSource: slide.hidden,
    previewPath: `/slides/${slide.id}/preview`,
    provenance: {
      sourceId: source.id,
      sourceVersionId: source.versionId,
      sourceTitle: deck.title,
      // The index keeps the deck's path inside the library; the folders are shown separately (folderPath).
      sourceFileName: source.fileName.split('/').pop() ?? source.fileName,
      slideNumber: slide.number,
      // Curation is not built yet: unknown values stay explicit (PR-03), never implied.
      owner: null,
      approvalStatus: null,
      reviewedAt: null,
      clientName: deck.clientName,
      deckYear: deck.deckYear,
      category: deck.category,
      location: deck.location,
      bestOfTheBest: deck.bestOfTheBest,
    },
  };
}

const encodeCursor = (offset: number) => Buffer.from(`o:${offset}`).toString('base64url');
function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  const match = /^o:(\d+)$/.exec(Buffer.from(cursor, 'base64url').toString());
  return match ? Number(match[1]) : 0;
}

export function searchSlides(index: LibraryIndex, params: { query: string; cursor: string | null; limit: number }) {
  const words = params.query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = index.sources
    .flatMap((source) => source.slides.map((slide) => ({ source, slide })))
    .filter(({ slide }) => {
      const haystack = `${slide.title}\n${slide.text}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    })
    .sort(
      (a, b) =>
        a.source.title.localeCompare(b.source.title) ||
        a.slide.number - b.slide.number ||
        a.slide.id.localeCompare(b.slide.id),
    );

  const limit = Math.min(Math.max(1, params.limit), MAX_LIMIT);
  const offset = decodeCursor(params.cursor);
  const pageItems = all.slice(offset, offset + limit).map(({ source, slide }) => toSummary(source, slide));
  const nextCursor = offset + limit < all.length ? encodeCursor(offset + limit) : null;
  return { items: pageItems, nextCursor, total: all.length };
}

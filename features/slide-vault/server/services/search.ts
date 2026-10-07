import 'server-only';
import type { SlideSummary } from '../../contracts/dto';
import type { IndexedSlide, IndexedSource, LibraryIndex } from '../library-repository';

/**
 * Slide-level keyword search (docs/DATA_AND_API.md, "Search and selection").
 * Every query word must appear in the slide title or text. Order is deterministic
 * (source title, slide number, then id) so cursors are stable.
 */

export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 100;

export function toSummary(source: IndexedSource, slide: IndexedSlide): SlideSummary {
  return {
    id: slide.id,
    title: slide.title,
    hiddenInSource: slide.hidden,
    previewPath: `/slides/${slide.id}/preview`,
    provenance: {
      sourceId: source.id,
      sourceVersionId: source.versionId,
      sourceTitle: source.title,
      sourceFileName: source.fileName,
      slideNumber: slide.number,
      // Curation is not built yet: unknown values stay explicit (PR-03), never implied.
      owner: null,
      approvalStatus: null,
      reviewedAt: null,
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

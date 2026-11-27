import type { SearchFacets, SlideSummary } from '../contracts/dto';
import { hasSlideType, SLIDE_TYPES } from './search-rules';

/**
 * The search filters' rules: which slides a set of ticked filters keeps, and the counts beside each choice.
 * Pure, so the screens (components/library.ts) and the server (server/services/search-filters.ts, FD-107) use one copy.
 */

export const UNKNOWN_CLIENT = 'Unknown client';

export type Filters = {
  category: string[];
  client: string[];
  bestOnly: boolean;
  yfrom: number | null;
  yto: number | null;
  /** Slide types such as "About us", matched by topic words on the slide (search-rules.ts) */
  slideType: string[];
  /** Who made the deck file and who put it in SlideVault. Real values only; the lists show when the server sends them. */
  createdBy: string[];
  uploadedBy: string[];
  /** People's own tags (FD-58) on the slide or its deck, matched whatever the case ("priya" is "Priya") */
  tag: string[];
  /** One standard deck section (FD-57, FD-80), kept as its kind ("case-studies"). Applied to search results and to the Home section browser, not to the plain library list. */
  section: string[];
};

export const NO_FILTERS: Filters = { category: [], client: [], bestOnly: false, yfrom: null, yto: null, slideType: [], createdBy: [], uploadedBy: [], tag: [], section: [] };

export const clientOf = (s: SlideSummary) => s.provenance.clientName ?? UNKNOWN_CLIENT;
export const yearOf = (s: SlideSummary) => s.provenance.deckYear ?? null;
export const categoryOf = (s: SlideSummary) => s.provenance.category ?? null;
export const createdByOf = (s: SlideSummary) => s.provenance.createdBy ?? null;
export const uploadedByOf = (s: SlideSummary) => s.provenance.uploadedBy ?? null;
/** The tags on a slide and on its deck, each once, as people wrote them */
export const tagsOf = (s: SlideSummary): string[] => [...new Map((s.tags ?? []).map((t) => [t.tag.toLowerCase(), t.tag])).values()];

export function slideMatches(s: SlideSummary, f: Filters): boolean {
  const year = yearOf(s);
  if (f.yfrom !== null && (year === null || year < f.yfrom)) return false;
  if (f.yto !== null && (year === null || year > f.yto)) return false;
  if (f.bestOnly && !s.provenance.bestOfTheBest) return false;
  if (f.client.length && !f.client.includes(clientOf(s))) return false;
  if (f.category.length && !f.category.includes(categoryOf(s) ?? '')) return false;
  if (f.slideType.length && !f.slideType.some((t) => hasSlideType(s, t))) return false;
  if (f.createdBy.length && !f.createdBy.includes(createdByOf(s) ?? '')) return false;
  if (f.uploadedBy.length && !f.uploadedBy.includes(uploadedByOf(s) ?? '')) return false;
  if (f.tag.length) {
    const has = new Set(tagsOf(s).map((t) => t.toLowerCase()));
    if (!f.tag.some((t) => has.has(t.toLowerCase()))) return false;
  }
  return true;
}

/** Counts per value, for the filter lists and browse tiles. */
export function countBy(slides: SlideSummary[], pick: (s: SlideSummary) => string | number | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of slides) {
    const v = pick(s);
    if (v === null || v === '') continue;
    m.set(String(v), (m.get(String(v)) ?? 0) + 1);
  }
  return m;
}

/** The year presets of the Year filter: this many years back, counting this one. */
export const YEAR_PRESETS: [number, string][] = [
  [1, 'This year'],
  [2, 'Last 2 years'],
  [5, 'Last 5 years'],
];

/**
 * Counts for the filter lists over `slides`: each list counts what ticking one of its values leaves, with every other
 * filter applied and its own left out. The same function runs on the server (over everything the words found, before the
 * filters narrow it) and on the screen (over the library when nothing is searched).
 */
export function facetCounts(slides: SlideSummary[], f: Filters, thisYear: number): SearchFacets {
  const without = (omit: Partial<Filters>) => slides.filter((s) => slideMatches(s, { ...f, ...omit }));
  const plain = (m: Map<string, number>) => Object.fromEntries(m);
  const typeBase = without({ slideType: [] });
  const yearBase = without({ yfrom: null, yto: null });
  return {
    client: plain(countBy(without({ client: [] }), clientOf) as Map<string, number>),
    category: plain(countBy(without({ category: [] }), categoryOf) as Map<string, number>),
    slideType: Object.fromEntries(SLIDE_TYPES.map((t) => [t.label, typeBase.filter((s) => hasSlideType(s, t.label)).length])),
    year: Object.fromEntries(YEAR_PRESETS.map(([k]) => [String(k), yearBase.filter((s) => (yearOf(s) ?? -1) >= thisYear - k + 1).length])),
  };
}

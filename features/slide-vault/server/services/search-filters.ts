/**
 * The filters the person ticked, applied here so they search the top 400 matches of the words and not only the first slides the words
 * found (FD-107): `GET /smart-search?filters=<json>`. Within one filter a slide needs any ticked value; across filters it
 * needs all of them. The words still decide what is searched for, minus the ones whose reading the person switched off.
 */
import type { SearchFacets, SlideSummary } from '../../contracts/dto';
import { facetCounts, NO_FILTERS, slideMatches, type Filters } from '../../components/library';

const MAX_VALUES = 40;
const MAX_LENGTH = 120;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_LENGTH))].slice(0, MAX_VALUES) : [];
const year = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1900 && v <= 2200 ? v : null);

/** The ticked filters as the screen sends them (JSON), checked; null when none is on or the text is not usable. */
export function parseFilters(raw: string | null): Filters | null {
  if (!raw || raw.length > 4000) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const f: Filters = {
    ...NO_FILTERS,
    category: strings(j.category), client: strings(j.client), slideType: strings(j.slideType), createdBy: strings(j.createdBy),
    uploadedBy: strings(j.uploadedBy), tag: strings(j.tag), section: strings(j.section),
    yfrom: year(j.yfrom), yto: year(j.yto), bestOnly: j.bestOnly === true,
  };
  const on = f.category.length + f.client.length + f.slideType.length + f.createdBy.length + f.uploadedBy.length + f.tag.length + f.section.length + (f.yfrom !== null || f.yto !== null ? 1 : 0) + (f.bestOnly ? 1 : 0);
  return on > 0 ? f : null;
}

export const matchesFilters = (slide: SlideSummary, f: Filters): boolean => slideMatches(slide, f) && (f.section.length === 0 || f.section.includes(slide.section?.kind ?? ''));

/** The slides that pass every ticked filter, and the counts for the filter lists over all of them (each list leaves its own filter out). */
export function applyFilters<T extends { slide: SlideSummary }>(items: T[], f: Filters, thisYear = new Date().getFullYear()): { kept: T[]; facets: SearchFacets } {
  const slides = items.map((i) => i.slide);
  // facetCounts applies every filter but the list's own (and ignores sections), so hand it the slides that pass the Section filter.
  const facets = facetCounts(f.section.length ? slides.filter((s) => f.section.includes(s.section?.kind ?? '')) : slides, f, thisYear);
  return { kept: items.filter((i) => matchesFilters(i.slide, f)), facets };
}

import type { SlideSummary } from '../../contracts/dto';

/**
 * Search by meaning in the ranking (docs/DECISIONS.md FD-95). Until now, slides close in meaning (pgvector,
 * FD-55) were only added after every keyword match, and only when there were fewer than the limit, so on a
 * library of 1,900 slides they almost never showed (Alina, 4 Nov: "regular and AI search give the same
 * results"). Now both lists are merged by reciprocal rank fusion, the usual way hybrid search engines join a
 * word ranking and a meaning ranking: each slide scores 1 / (K + its place) in each list it is in, so a slide
 * high in both leads, and a slide that means what was asked rises even when its words differ.
 *
 * The rules that make results trustworthy still hold. Meaning-only slides must pass the search's filters
 * (client, years, category, Best of the Best). When the search names something that must be on every result
 * ("Toronto", "QA/QC", FD-56) or asks for a deck section (FD-57), the word ranking keeps its order and
 * meaning only adds slides after it, as before.
 */
/** Lower than the textbook 60 because the word list here is long and loose (any of the words): with 20, the best meaning match lands in the first row of results instead of the second page. */
export const RRF_K = 20;
/** How much the meaning list counts next to the word list (1 = equal). A little less: words the person typed stay the stronger signal. */
export const MEANING_WEIGHT = 0.8;
export const ALSO_MEANING = 'Close in meaning to your search too.';
export const MEANING_ONLY = 'Close in meaning to your search, even where the words differ.';

export type MeaningHit = { slide: SlideSummary; similarity: number };
export type Filters = { client?: string | null; yearFrom?: number | null; yearTo?: number | null; category?: string | null; bestOfTheBest?: boolean | null };
type Item = { slide: SlideSummary; why: string; matched: string[] };

/** Does a slide found by meaning pass the filters the search already applied to word matches? */
export function passesFilters(s: SlideSummary, f: Filters): boolean {
  const p = s.provenance;
  if (f.client && (p.clientName ?? '').toLowerCase() !== f.client.toLowerCase()) return false;
  if (f.yearFrom && !(typeof p.deckYear === 'number' && p.deckYear >= f.yearFrom)) return false;
  if (f.yearTo && !(typeof p.deckYear === 'number' && p.deckYear <= f.yearTo)) return false;
  if (f.category && (p.category ?? '').toLowerCase() !== f.category.toLowerCase()) return false;
  if (f.bestOfTheBest && !p.bestOfTheBest) return false;
  return true;
}

/**
 * Words and meaning, merged. `strict` keeps the word order and only appends meaning-only slides (named
 * things, section searches). Returns at most `limit` items; meaning-only items say so in "why it fits",
 * and word matches that are also close in meaning say that too.
 */
export function blendByMeaning<T extends Item>(items: T[], hits: MeaningHit[], opts: { limit: number; minSimilarity: number; filters: Filters; strict: boolean; keep?: (s: SlideSummary) => boolean }): T[] {
  const close = hits.filter((h) => h.similarity >= opts.minSimilarity && passesFilters(h.slide, opts.filters) && (opts.keep?.(h.slide) ?? true));
  const meaningPlace = new Map(close.map((h, i) => [h.slide.id, i]));
  const have = new Set(items.map((i) => i.slide.id));
  const extra = close.filter((h) => !have.has(h.slide.id)).map((h) => ({ slide: h.slide, why: MEANING_ONLY, matched: [] as string[] }) as unknown as T);
  const mark = (i: T): T => (meaningPlace.has(i.slide.id) && !i.why.includes(ALSO_MEANING) ? { ...i, why: `${i.why} ${ALSO_MEANING}`.trim() } : i);
  if (opts.strict) return [...items.map(mark), ...extra].slice(0, opts.limit);
  const score = (id: string, wordPlace: number | null) =>
    (wordPlace === null ? 0 : 1 / (RRF_K + wordPlace + 1)) + (meaningPlace.has(id) ? MEANING_WEIGHT / (RRF_K + meaningPlace.get(id)! + 1) : 0);
  const all = [...items.map((it, i) => ({ it: mark(it), s: score(it.slide.id, i), i })), ...extra.map((it, j) => ({ it, s: score(it.slide.id, null), i: items.length + j }))];
  return all.sort((a, b) => b.s - a.s || a.i - b.i).slice(0, opts.limit).map((x) => x.it);
}

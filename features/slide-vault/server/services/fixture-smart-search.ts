import 'server-only';
import type { SlideSummary } from '../../contracts/dto';
import type { SearchPlan, SlideFacts } from '../ai/search-plan';
import type { LibraryIndex } from '../library-repository';
import { toSummary } from './search';

/**
 * Quick AI search over the file-backed fixture library, the same rules as smartSearchPg: any
 * keyword can match (title or text, at a word start), inside the plan's filters, best match first.
 * Lets one search cover sample decks and uploaded decks together, like GET /search does.
 */
/**
 * `known`, when given (FD-33), adds what is known about each slide beyond its words: `about` is also
 * searched (what the local model read on it), `boost` ranks slides of the kind, sector and theme the
 * search asks for higher, and `answers` lets such a slide in even when none of its words match.
 */
export type SearchKnowledge = {
  about: (slideId: string) => string;
  boost: (slideId: string) => number;
  answers: (slideId: string) => boolean;
  /** Slides the caller won't show (hidden in the source deck): left out before the limit, so they can't use it up. */
  skip?: (slide: SlideSummary) => boolean;
};

export function smartSearchFixtures(index: LibraryIndex | null, plan: SearchPlan, limit: number, known?: SearchKnowledge): { summary: SlideSummary; facts: SlideFacts }[] {
  if (!index) return [];
  // A word of three letters must be the whole word ("app" is not "approach"); a longer one may start a word ("team" finds "teamwork").
  const starts = plan.keywords.map((k) => { const e = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(k.length <= 3 ? `\\b${e}s?\\b` : `\\b${e}`, 'i'); });
  // A word on few slides says more than one on most: each keyword weighs by how rare it is in the library.
  const all = index.sources.flatMap((source) => source.slides);
  const weight = starts.map((re) => { const n = all.filter((sl) => re.test(sl.title) || re.test(sl.text)).length; return Math.log(1 + all.length / Math.max(1, n)); });
  const scored: { summary: SlideSummary; facts: SlideFacts; score: number }[] = [];
  for (const source of index.sources) {
    for (const slide of source.slides) {
      const summary = toSummary(source, slide);
      const p = summary.provenance;
      if (known?.skip?.(summary)) continue;
      if (plan.client && p.clientName?.toLowerCase() !== plan.client.toLowerCase()) continue;
      if (plan.yearFrom && (p.deckYear ?? 0) < plan.yearFrom) continue;
      if (plan.yearTo && (p.deckYear ?? Infinity) > plan.yearTo) continue;
      if (plan.category && p.category?.toLowerCase() !== plan.category.toLowerCase()) continue;
      if (plan.bestOfTheBest && !p.bestOfTheBest) continue;
      // A title hit counts double, like ts_rank weighting the title in Postgres.
      const about = known?.about(slide.id) ?? '';
      const words = starts.reduce((n, re, i) => n + weight[i] * (re.test(slide.title) ? 2 : re.test(slide.text) || (about && re.test(about)) ? 1 : 0), 0);
      const answers = known?.answers(slide.id) ?? false;
      if (starts.length && words === 0 && !answers) continue;
      // A deck named for what was asked ("New York Ledger · RFP, workplace strategy") lifts its matching slides.
      const deckNamed = words ? starts.reduce((n, re, i) => n + (re.test(p.sourceTitle) ? weight[i] : 0), 0) : 0;
      const score = words + deckNamed + (known?.boost(slide.id) ?? 0);
      scored.push({
        summary,
        score,
        facts: { title: slide.title, text: slide.text, client: p.clientName ?? null, year: p.deckYear ?? null, category: p.category ?? null, bestOfTheBest: Boolean(p.bestOfTheBest) },
      });
    }
  }
  return scored
    // Asked for recent work ("most updated slides": from a year on, no end): newest decks first among equals.
    .sort((a, b) => b.score - a.score || (plan.yearFrom && !plan.yearTo ? (b.summary.provenance.deckYear ?? 0) - (a.summary.provenance.deckYear ?? 0) : 0) || a.summary.provenance.sourceTitle.localeCompare(b.summary.provenance.sourceTitle) || a.summary.provenance.slideNumber - b.summary.provenance.slideNumber)
    .slice(0, limit)
    .map(({ summary, facts }) => ({ summary, facts }));
}

/** The slides in the local library whose ids pass `keep`, as search rows, in deck and slide order. */
export function fixtureRowsWhere(index: LibraryIndex | null, keep: (slideId: string) => boolean, limit: number): { summary: SlideSummary; facts: SlideFacts }[] {
  if (!index) return [];
  const out: { summary: SlideSummary; facts: SlideFacts }[] = [];
  // Identical copies of a file share slide ids: read each slide once, or the copies use up the limit.
  const seen = new Set<string>();
  for (const source of index.sources) {
    for (const slide of source.slides) {
      if (!keep(slide.id) || seen.has(slide.id)) continue;
      seen.add(slide.id);
      const summary = toSummary(source, slide);
      const p = summary.provenance;
      out.push({ summary, facts: { title: slide.title, text: slide.text, client: p.clientName ?? null, year: p.deckYear ?? null, category: p.category ?? null, bestOfTheBest: Boolean(p.bestOfTheBest) } });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Client names and categories in the fixture library, the same values its search results carry. */
export function fixtureFilterValues(index: LibraryIndex | null): { clients: string[]; categories: string[] } {
  const clients = new Set<string>();
  const categories = new Set<string>();
  for (const source of index?.sources ?? []) {
    const first = source.slides[0];
    if (!first) continue;
    const p = toSummary(source, first).provenance;
    if (p.clientName && p.clientName !== 'Unknown client') clients.add(p.clientName);
    if (p.category) categories.add(p.category);
  }
  return { clients: [...clients].sort(), categories: [...categories].sort() };
}

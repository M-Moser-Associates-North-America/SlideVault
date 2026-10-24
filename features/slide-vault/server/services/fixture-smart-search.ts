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
export type SearchKnowledge = { about: (slideId: string) => string; boost: (slideId: string) => number; answers: (slideId: string) => boolean };

export function smartSearchFixtures(index: LibraryIndex | null, plan: SearchPlan, limit: number, known?: SearchKnowledge): { summary: SlideSummary; facts: SlideFacts }[] {
  if (!index) return [];
  const starts = plan.keywords.map((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  const scored: { summary: SlideSummary; facts: SlideFacts; score: number }[] = [];
  for (const source of index.sources) {
    for (const slide of source.slides) {
      const summary = toSummary(source, slide);
      const p = summary.provenance;
      if (plan.client && p.clientName?.toLowerCase() !== plan.client.toLowerCase()) continue;
      if (plan.yearFrom && (p.deckYear ?? 0) < plan.yearFrom) continue;
      if (plan.yearTo && (p.deckYear ?? Infinity) > plan.yearTo) continue;
      if (plan.category && p.category?.toLowerCase() !== plan.category.toLowerCase()) continue;
      if (plan.bestOfTheBest && !p.bestOfTheBest) continue;
      // A title hit counts double, like ts_rank weighting the title in Postgres.
      const about = known?.about(slide.id) ?? '';
      const words = starts.reduce((n, re) => n + (re.test(slide.title) ? 2 : re.test(slide.text) || (about && re.test(about)) ? 1 : 0), 0);
      const answers = known?.answers(slide.id) ?? false;
      if (starts.length && words === 0 && !answers) continue;
      const score = words + (known?.boost(slide.id) ?? 0);
      scored.push({
        summary,
        score,
        facts: { title: slide.title, text: slide.text, client: p.clientName ?? null, year: p.deckYear ?? null, category: p.category ?? null, bestOfTheBest: Boolean(p.bestOfTheBest) },
      });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score || a.summary.provenance.sourceTitle.localeCompare(b.summary.provenance.sourceTitle) || a.summary.provenance.slideNumber - b.summary.provenance.slideNumber)
    .slice(0, limit)
    .map(({ summary, facts }) => ({ summary, facts }));
}

/** The slides in the local library whose ids pass `keep`, as search rows, in deck and slide order. */
export function fixtureRowsWhere(index: LibraryIndex | null, keep: (slideId: string) => boolean, limit: number): { summary: SlideSummary; facts: SlideFacts }[] {
  if (!index) return [];
  const out: { summary: SlideSummary; facts: SlideFacts }[] = [];
  for (const source of index.sources) {
    for (const slide of source.slides) {
      if (!keep(slide.id)) continue;
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

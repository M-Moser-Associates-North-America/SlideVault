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
export function smartSearchFixtures(index: LibraryIndex | null, plan: SearchPlan, limit: number): { summary: SlideSummary; facts: SlideFacts }[] {
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
      const score = starts.reduce((n, re) => n + (re.test(slide.title) ? 2 : re.test(slide.text) ? 1 : 0), 0);
      if (starts.length && score === 0) continue;
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

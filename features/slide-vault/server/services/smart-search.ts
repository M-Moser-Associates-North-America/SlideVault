import type { SlideSummary } from '../../contracts/dto';
import { chipsFor, hasFilters, standInPlan, whyItFits, withoutFilters, type Chip, type PlanContext, type SearchPlan, type SlideFacts } from '../ai/search-plan';

/**
 * Quick AI search (docs/DECISIONS.md FD-15). The route wires in the real reader (Claude or the
 * stand-in) and Postgres; tests pass in fakes.
 */

export type SmartResult = { slide: SlideSummary; why: string; matched: string[] };

export type SmartSearchResponse = {
  query: string;
  /** Who read the request: Claude, or the rules-only stand-in (no key, or Claude unavailable) */
  reader: 'claude' | 'stand-in';
  /** Set when Claude was tried and failed, so the screen can say results are simpler than usual */
  readerNote: string | null;
  plan: SearchPlan;
  chips: Chip[];
  /** true when the filters left nothing, so results are shown without them */
  relaxed: boolean;
  items: SmartResult[];
};

export type SmartSearchDeps = {
  context: () => Promise<Omit<PlanContext, 'thisYear'>>;
  /** Claude's reader; absent when no key is set */
  claude?: (query: string, ctx: PlanContext) => Promise<SearchPlan>;
  search: (plan: SearchPlan, limit: number) => Promise<{ summary: SlideSummary; facts: SlideFacts }[]>;
  thisYear?: number;
  log?: (message: string) => void;
};

export async function smartSearch(query: string, limit: number, deps: SmartSearchDeps): Promise<SmartSearchResponse> {
  const ctx: PlanContext = { ...(await deps.context()), thisYear: deps.thisYear ?? new Date().getFullYear() };

  let plan: SearchPlan;
  let reader: SmartSearchResponse['reader'] = 'stand-in';
  let readerNote: string | null = null;
  if (deps.claude) {
    try {
      plan = await deps.claude(query, ctx);
      reader = 'claude';
    } catch (e) {
      deps.log?.(`Claude unavailable, using the stand-in: ${(e as Error).message}`);
      readerNote = 'AI reading is unavailable right now, so this search used simpler rules.';
      plan = standInPlan(query, ctx);
    }
  } else {
    plan = standInPlan(query, ctx);
  }
  // A model or rule that finds nothing to search for still shouldn't lose the person's words.
  if (!plan.keywords.length && !hasFilters(plan)) plan = { ...plan, keywords: standInPlan(query, ctx).keywords };

  let relaxed = false;
  let rows = await deps.search(plan, limit);
  if (!rows.length && hasFilters(plan) && plan.keywords.length) {
    rows = await deps.search(withoutFilters(plan), limit);
    relaxed = rows.length > 0;
  }

  return {
    query,
    reader,
    readerNote,
    plan,
    chips: chipsFor(plan),
    relaxed,
    items: rows.map(({ summary, facts }) => ({ slide: summary, ...whyItFits(relaxed ? withoutFilters(plan) : plan, facts) })),
  };
}

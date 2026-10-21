import type { SlideSummary } from '../../contracts/dto';
import type { PlanReader } from '../ai/reader';
import { chipsFor, groundFilters, hasFilters, isBasicQuery, literalWords, relevantClients, typedCodes, MAX_KEYWORDS, standInPlan, whyItFits, withoutFilters, type Chip, type PlanContext, type SearchPlan, type SlideFacts } from '../ai/search-plan';

/**
 * Quick AI search (docs/DECISIONS.md FD-16, FD-17). The route wires in the configured reader (or
 * none) and Postgres; tests pass in fakes. Which provider read the request never changes how
 * slides are found or explained.
 */

export type SmartResult = { slide: SlideSummary; why: string; matched: string[] };

export type SmartSearchResponse = {
  query: string;
  /** Who read the request: the configured AI model, or the rules-only stand-in (a basic search, none configured, or it failed) */
  reader: 'model' | 'stand-in';
  /** Set when the model was tried and failed, so the screen can say results are simpler than usual */
  readerNote: string | null;
  plan: SearchPlan;
  chips: Chip[];
  /** true when the filters left nothing, so results are shown without them */
  relaxed: boolean;
  items: SmartResult[];
};

export type SmartSearchDeps = {
  context: () => Promise<Omit<PlanContext, 'thisYear'>>;
  /** The configured AI reader; absent for rules only */
  reader?: PlanReader | null;
  search: (plan: SearchPlan, limit: number) => Promise<{ summary: SlideSummary; facts: SlideFacts }[]>;
  thisYear?: number;
  log?: (message: string) => void;
};

/**
 * `read` is true only when the person submitted the search (Enter or the Search button). While they
 * type, every search uses the rules, so a long question never calls the model mid-sentence.
 */
export async function smartSearch(query: string, limit: number, deps: SmartSearchDeps, opts: { read?: boolean } = {}): Promise<SmartSearchResponse> {
  const ctx: PlanContext = { ...(await deps.context()), thisYear: deps.thisYear ?? new Date().getFullYear() };

  let plan: SearchPlan;
  let reader: SmartSearchResponse['reader'] = 'stand-in';
  let readerNote: string | null = null;
  // Basic searches stay on the rules; only sentences and questions are worth a model call.
  if (deps.reader && opts.read && !isBasicQuery(query)) {
    try {
      // The model only sees client names typed in the request, never the whole list.
      plan = groundFilters(await deps.reader.read(query, { ...ctx, clients: relevantClients(query, ctx.clients) }), query);
      reader = 'model';
      // Codes typed as codes ("QA/QC") are searched as typed too, next to the model's spelled-out words.
      plan = { ...plan, keywords: [...new Set([...plan.keywords, ...typedCodes(query)])].slice(0, MAX_KEYWORDS) };
    } catch (e) {
      deps.log?.(`AI reader ${deps.reader.name} unavailable, using the stand-in: ${(e as Error).message}`);
      readerNote = 'AI reading is unavailable right now, so this search used simpler rules.';
      plan = standInPlan(query, ctx);
    }
  } else {
    plan = standInPlan(query, ctx);
  }
  // A model or rule that finds nothing to search for still shouldn't lose the person's words.
  if (!plan.keywords.length && !hasFilters(plan)) plan = { ...plan, keywords: standInPlan(query, ctx).keywords };
  // Short codes the rules skip ("QA/QC", "MSA", "FF&E") are still what the person asked for.
  if (!plan.keywords.length && !hasFilters(plan)) plan = { ...plan, keywords: literalWords(query) };
  // Nothing at all to search for means no results, never the whole library.
  if (!plan.keywords.length && !hasFilters(plan)) return { query, reader, readerNote, plan, chips: chipsFor(plan), relaxed: false, items: [] };

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

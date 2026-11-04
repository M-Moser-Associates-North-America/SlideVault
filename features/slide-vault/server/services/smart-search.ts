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
  /** true when the server has an AI reader set up, so the screen can offer "Deeper AI search" (FD-79) */
  aiAvailable?: boolean;
  /** 'short' when an AI reader was set up and asked for, but the search was too short to be worth a model call (FD-79): the rules read it, and the screen can invite more detail */
  aiSkipped?: 'short';
  plan: SearchPlan;
  chips: Chip[];
  /** true when the filters left nothing, so results are shown without them */
  relaxed: boolean;
  /** Set when the search is only a deck section ("case studies", "resumes"): the standard sections it asks for, so the screen can show section cards (FD-80) */
  sections?: string[];
  items: SmartResult[];
};

export type SmartSearchDeps = {
  context: () => Promise<Omit<PlanContext, 'thisYear'>>;
  /** The configured AI reader; absent for rules only */
  reader?: PlanReader | null;
  search: (plan: SearchPlan, limit: number) => Promise<{ summary: SlideSummary; facts: SlideFacts }[]>;
  /** Share of library slides (0 to 1) that mention a word; without it nothing named is required */
  howCommon?: (word: string) => number;
  /** More text that counts as the slide mentioning something: what was read on it, its deck's name and place */
  alsoSays?: (slide: SlideSummary) => string;
  /** Is this word a client, place, sector, theme or project the library knows? */
  isKnownName?: (word: string) => boolean;
  /** What else a named word is met by: "hospital" by the healthcare sector */
  alsoMeans?: (word: string) => string[];
  /**
   * Where the slide's deck was made ("Toronto"). It adds to the word, it doesn't replace it (Schiffon,
   * FD-56, 2 Nov): a slide that prints "Toronto" from a deck made there comes first, then other slides
   * that print it, then the rest of the Toronto deck. A slide that says the place never drops below one
   * that doesn't. Places only: other named things are met by the word or the deck's other facts.
   */
  madeIn?: (slide: SlideSummary) => string | null;
  /** Slides that only mention things in passing for this search (a bio, when people weren't asked for) go last */
  rankLast?: (slide: SlideSummary) => boolean;
  thisYear?: number;
  log?: (message: string) => void;
};

/**
 * A named thing on fewer than this share of slides is what the person is after ("QNBC", "Toronto",
 * "QA/QC"), so every result must mention it. Common words ("workplace", "strategy") only rank.
 */
export const RARE_SHARE = 0.08;
const ROWS_WHEN_NAMED = 400;

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** A named thing is a whole word, plural allowed: "hospital" finds "hospitals", never "hospitality"; "resume" finds "Résumés". */
export function mentionsWord(hay: string, w: string): boolean {
  const e = plain(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${e}(?:e?s)?\\b`).test(plain(hay));
}

/**
 * `read` is true only when the person submitted the search (Enter or the Search button). While they
 * type, every search uses the rules, so a long question never calls the model mid-sentence.
 */
export async function smartSearch(query: string, limit: number, deps: SmartSearchDeps, opts: { read?: boolean; force?: boolean } = {}): Promise<SmartSearchResponse> {
  const ctx: PlanContext = { ...(await deps.context()), thisYear: deps.thisYear ?? new Date().getFullYear() };

  let plan: SearchPlan;
  let reader: SmartSearchResponse['reader'] = 'stand-in';
  let readerNote: string | null = null;
  let aiSkipped: SmartSearchResponse['aiSkipped'];
  // Basic searches stay on the rules; only sentences and questions are worth a model call, unless the
  // person asked for the AI on this one anyway (FD-79, ai=always).
  if (deps.reader && opts.read && (opts.force || !isBasicQuery(query))) {
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
    if (deps.reader && opts.read) aiSkipped = 'short';
  }
  // A model or rule that finds nothing to search for still shouldn't lose the person's words.
  if (!plan.keywords.length && !hasFilters(plan)) plan = { ...plan, keywords: standInPlan(query, ctx).keywords };
  // Short codes the rules skip ("QA/QC", "MSA", "FF&E") are still what the person asked for.
  if (!plan.keywords.length && !hasFilters(plan)) plan = { ...plan, keywords: literalWords(query) };
  // What the person named is read from their own words by the rules, whoever read the rest (FD-56).
  // Only the rare ones are required; each is also searched for, so slides that have it are found.
  // In a sentence, a rare word is only a name when it looks like one ("Toronto", "QA/QC") or the
  // library knows it; "slides that show our value proposition" doesn't require "proposition".
  const sentence = !isBasicQuery(query);
  const looksLikeName = (w: string) => /[A-Z]/.test(w) || /[/&]/.test(w) || !!deps.isKnownName?.(w.toLowerCase());
  const named = (standInPlan(query, ctx).named ?? []).filter((w) => {
    const share = deps.howCommon?.(w.toLowerCase()) ?? 1;
    return share > 0 && share <= RARE_SHARE && (!sentence || looksLikeName(w));
  });
  plan = { ...plan, named, keywords: [...new Set([...named.map((w) => w.toLowerCase()), ...plan.keywords])].slice(0, MAX_KEYWORDS) };
  // Nothing at all to search for means no results, never the whole library.
  if (!plan.keywords.length && !hasFilters(plan)) return { query, reader, readerNote, ...(aiSkipped ? { aiSkipped } : {}), plan, chips: chipsFor(plan), relaxed: false, items: [] };

  let relaxed = false;
  let rows = await deps.search(plan, named.length ? Math.max(limit, ROWS_WHEN_NAMED) : limit);
  if (named.length) {
    type Row = (typeof rows)[number];
    const says = (r: Row) => `${r.facts.title} ${r.facts.text} ${deps.alsoSays?.(r.summary) ?? ''}`;
    // "Hospital" is also met by a slide tagged with the healthcare sector it belongs to.
    const has = (r: Row, w: string) => [w, ...(deps.alsoMeans?.(w.toLowerCase()) ?? [])].some((x) => mentionsWord(says(r), x));
    const all = rows.filter((r) => named.every((w) => has(r, w)));
    const some = all.length ? all : rows.filter((r) => named.some((w) => has(r, w)));
    // Slides that say it themselves first, then ones where the reading, the sector or the deck does,
    // then passing mentions (a bio); best match first within each.
    const ownWords = (r: Row) => named.some((w) => mentionsWord(`${r.facts.title} ${r.facts.text}`, w));
    const madeThere = (r: Row) => named.some((w) => mentionsWord(deps.madeIn?.(r.summary) ?? '', w));
    // Says it and was made there, then says it, then met through its deck or reading, then passing mentions.
    const tier = (r: Row) => (deps.rankLast?.(r.summary) ? 3 : ownWords(r) ? (madeThere(r) ? 0 : 1) : 2);
    if (some.length) rows = some.map((r, i) => ({ r, i, t: tier(r) })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.r);
    else {
      // Nothing found mentions what was named: show the rest, and say so.
      relaxed = true;
      plan = { ...plan, named: [] };
    }
    rows = rows.slice(0, limit);
  }
  if (!rows.length && hasFilters(plan) && plan.keywords.length) {
    rows = await deps.search(withoutFilters(plan), limit);
    relaxed = rows.length > 0;
  }
  // The model's reading can miss when the library words it differently ("occupied building" when
  // slides say "phased move"). Asking the AI should never find less than typing, so fall back to the
  // person's own words, read by the rules.
  if (!rows.length && reader === 'model') {
    const own = standInPlan(query, ctx);
    if (!own.keywords.length && !hasFilters(own)) own.keywords = literalWords(query);
    if (own.keywords.length || hasFilters(own)) {
      const fallback = await deps.search(own, limit);
      if (fallback.length) {
        rows = fallback;
        plan = own;
        relaxed = false;
      }
    }
  }

  return {
    query,
    reader,
    readerNote,
    ...(aiSkipped ? { aiSkipped } : {}),
    plan,
    chips: chipsFor(plan),
    relaxed,
    items: rows.map(({ summary, facts }) => ({ slide: summary, ...whyItFits(relaxed ? withoutFilters(plan) : plan, facts) })),
  };
}

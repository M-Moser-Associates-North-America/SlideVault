import { simParse } from '../../components/simulation';

/**
 * Quick AI search (docs/DECISIONS.md FD-15): how a typed request becomes a search, and how each
 * result gets its "why it fits" note. No network here, so it's easy to test.
 *
 *   1. Read the request into a SearchPlan: keywords (with likely synonyms) plus optional filters.
 *      Claude does this when a key is set (ai/claude.ts); otherwise the stand-in below does, using
 *      the same rules as the front end's simulated search, so the demo behaves the same either way.
 *   2. Search Postgres for slides matching ANY keyword, inside the filters, best match first.
 *   3. Explain each result from what actually matched. The note is worked out from the slide's
 *      own words, not written by the model, so it can't claim something the slide doesn't say.
 */

export type SearchPlan = {
  /** One plain sentence: what we think the person is looking for */
  summary: string;
  /** Words or short phrases likely to appear on a matching slide, synonyms included */
  keywords: string[];
  /** Short labels for what the request is about, shown as chips ("Team", "Cost savings") */
  topics: string[];
  client: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  category: string | null;
  bestOfTheBest: boolean | null;
};

/** What the reader is allowed to pick from, so filters always match real values. */
export type PlanContext = { clients: string[]; categories: string[]; thisYear: number };

export type Chip = { kind: 'Topic' | 'Client' | 'Year' | 'Category' | 'Collection'; label: string };

export const MAX_KEYWORDS = 12;

/** Rules-only reader, used when no Claude key is set or Claude can't be reached. */
export function standInPlan(query: string, ctx: PlanContext): SearchPlan {
  const p = simParse(query, ctx.clients);
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')} `;
  const keywords = [...p.tokens, ...p.concepts.flatMap((c) => c.words)];
  // The simulated reader picks a client from any word of its name, so "a bank pitch" would become
  // the client "Northgate Bank". Only keep the client if its first word (the distinctive one) was
  // typed; otherwise put the words back as keywords.
  if (p.client) {
    const words = p.client.toLowerCase().split(/\s+/);
    if (!q.includes(` ${words[0]} `)) {
      keywords.unshift(...words.filter((w) => q.includes(` ${w} `)));
      p.client = null;
    }
  }
  const category = ctx.categories.find((c) => q.includes(` ${c.toLowerCase()} `)) ?? null;
  const bestOfTheBest = /best of (the )?best|\bbotb\b/.test(q) ? true : null;
  const yearFrom = p.year ?? (p.recent ? ctx.thisYear - 2 : null);
  const yearTo = p.year ?? null;
  const parts = [
    p.concepts.length ? p.concepts.map((c) => c.label.toLowerCase()).join(' and ') : null,
    p.client ? `for ${p.client}` : null,
    p.year ? `from ${p.year}` : p.recent ? 'from the last few years' : null,
  ].filter(Boolean);
  return cleanPlan(
    {
      summary: parts.length ? `Slides about ${parts.join(' ')}.` : `Slides that mention ${p.tokens.slice(0, 3).join(', ') || 'your words'}.`,
      keywords: category ? keywords.filter((k) => k !== category.toLowerCase()) : keywords,
      topics: p.concepts.map((c) => c.label),
      client: p.client,
      yearFrom,
      yearTo,
      category,
      bestOfTheBest,
    },
    ctx,
  );
}

/**
 * Make any plan (the stand-in's or Claude's) safe to run: filters must be real values, years
 * sensible, keywords short and de-duplicated. Anything that doesn't fit is dropped, not guessed.
 */
export function cleanPlan(raw: Partial<SearchPlan>, ctx: PlanContext): SearchPlan {
  const pick = (v: unknown, from: string[]) =>
    typeof v === 'string' ? (from.find((x) => x.toLowerCase() === v.trim().toLowerCase()) ?? null) : null;
  const year = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1990 && v <= ctx.thisYear + 1 ? v : null);
  const words = (v: unknown, max: number) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase().replace(/["]/g, '')).filter((x) => x.length >= 2 && x.length <= 60))].slice(0, max)
      : [];
  let yearFrom = year(raw.yearFrom);
  let yearTo = year(raw.yearTo);
  if (yearFrom && yearTo && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
  return {
    summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 200) : '',
    keywords: words(raw.keywords, MAX_KEYWORDS),
    topics: [...new Set((Array.isArray(raw.topics) ? raw.topics : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x && x.length <= 40))].slice(0, 4),
    client: pick(raw.client, ctx.clients),
    yearFrom,
    yearTo,
    category: pick(raw.category, ctx.categories),
    bestOfTheBest: raw.bestOfTheBest === true ? true : null,
  };
}

export function hasFilters(p: SearchPlan): boolean {
  return Boolean(p.client || p.yearFrom || p.yearTo || p.category || p.bestOfTheBest);
}

/** The same plan with every filter removed, for when the filters leave nothing. */
export function withoutFilters(p: SearchPlan): SearchPlan {
  return { ...p, client: null, yearFrom: null, yearTo: null, category: null, bestOfTheBest: null };
}

/** Chips for the search box, so people can see (and later remove) how their words were read. */
export function chipsFor(p: SearchPlan): Chip[] {
  const chips: Chip[] = p.topics.map((label) => ({ kind: 'Topic' as const, label }));
  if (p.client) chips.push({ kind: 'Client', label: p.client });
  if (p.yearFrom || p.yearTo) {
    const label = p.yearFrom === p.yearTo ? String(p.yearFrom) : p.yearTo ? `${p.yearFrom ?? 'Up'} to ${p.yearTo}` : `${p.yearFrom} or later`;
    chips.push({ kind: 'Year', label });
  }
  if (p.category) chips.push({ kind: 'Category', label: p.category });
  if (p.bestOfTheBest) chips.push({ kind: 'Collection', label: 'Best of the Best' });
  return chips;
}

/**
 * Postgres web-search syntax: any keyword can match ("a or b or \"two words\""). websearch_to_tsquery
 * never throws on odd input, and the text goes in as a query parameter, so this is safe.
 */
export function anyOfQuery(keywords: string[]): string {
  return keywords
    .map((k) => k.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((k) => (k.includes(' ') ? `"${k}"` : k))
    .join(' or ');
}

export type SlideFacts = {
  title: string;
  text: string;
  client: string | null;
  year: number | null;
  category: string | null;
  bestOfTheBest: boolean;
};

/** A short "why it fits" line, built only from what this slide and its deck actually contain. */
export function whyItFits(plan: SearchPlan, slide: SlideFacts): { why: string; matched: string[] } {
  const title = slide.title.toLowerCase();
  const text = slide.text.toLowerCase();
  const has = (hay: string, k: string) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(hay);
  const inTitle = plan.keywords.filter((k) => has(title, k));
  const inText = plan.keywords.filter((k) => !inTitle.includes(k) && has(text, k));
  const matched = [...inTitle, ...inText];

  const bits: string[] = [];
  if (inTitle.length) bits.push(`Has ${quoteList(inTitle.slice(0, 2))} in its title`);
  if (inText.length) bits.push(`${inTitle.length ? 'mentions' : 'Mentions'} ${quoteList(inText.slice(0, 2))}`);
  const deck: string[] = [];
  if (plan.client && slide.client === plan.client) deck.push(`from the ${slide.client} deck`);
  if ((plan.yearFrom || plan.yearTo) && slide.year) deck.push(`from ${slide.year}`);
  if (plan.category && slide.category === plan.category) deck.push(`filed under ${slide.category}`);
  if (slide.bestOfTheBest) deck.push('in Best of the Best');
  let why = bits.join(' and ');
  if (deck.length) why = why ? `${why}, ${deck.join(', ')}` : capitalize(deck.join(', '));
  return { why: why ? `${why}.` : 'Close match on the deck it comes from.', matched };
}

const quoteList = (xs: string[]) => xs.map((x) => `“${x}”`).join(' and ');
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

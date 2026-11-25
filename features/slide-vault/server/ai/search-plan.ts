import { BASIC_MAX_WORDS, isBasicQuery, isStopWord, parseQuery, topicNames } from '../../domain/search-rules';

/**
 * Quick AI search (docs/DECISIONS.md FD-16, FD-17): how a typed request becomes a search, and how
 * each result gets its "why it fits" note. No network here, so it's easy to test.
 *
 *   1. Read the request into a SearchPlan: keywords (with likely synonyms) plus optional filters.
 *      The configured AI reader does this (ai/reader.ts); with none configured, or if it fails, the
 *      stand-in below does, using the same rules as the filter row (domain/search-rules.ts).
 *   2. Search Postgres for slides matching ANY keyword, inside the filters, best match first.
 *   3. Explain each result from what actually matched. The note is worked out from the slide's
 *      own words, not written by the model, so it can't claim something the slide doesn't say.
 */

import { cleanLabels, hasLabels, labelName, type LabelMenu, type PlanLabels, type RawLabels } from './label-menu';

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
  /**
   * The specific things the person named that no filter or topic explains ("QNBC" in "QNBC case
   * study", "Toronto", "QA/QC"). Read by the rules from the typed words, never by a model. A named
   * thing that is rare in the library must be on every result (FD-56).
   */
  named?: string[];
  /**
   * Labels the team put on slides (type, theme, sector) that the request points at, even in other words
   * (FD-83). Only read by the AI, only from the menu in PlanContext; added to the rules' own reading.
   */
  labels?: PlanLabels;
  /** How the person asked, beyond what about (FD-87): slides or whole decks, in what order, one or all. Read by the rules from the typed words. */
  ask?: Ask;
};

/**
 * The parts of a request that aren't its subject (FD-87; Schiffon, 5 Nov: "it needs to understand hospitality
 * deck as hospitality deck, and it also needs to understand the action, most recent, least favorite, most
 * favorite"). "Most recent hospitality deck" is decks + newest; "map with all our offices" is all.
 */
export type AskOrder = 'newest' | 'oldest' | 'most-liked' | 'least-liked' | 'most-used';
export type Ask = { want: 'slides' | 'decks'; order: AskOrder | null; all: boolean };

const DECKS_ASKED = /\b(decks?|proposals?|presentations?|pitch(es)?|rfps?|msas?|submissions?)\b/;
const SLIDES_ASKED = /\b(slides?|pages?)\b/;
const ORDERS: [AskOrder, RegExp][] = [
  ['least-liked', /\b(least (liked|useful|favou?rite|popular))\b/],
  ['most-liked', /\b(most (liked|useful|favou?rite[ds]?)|favou?rites?|best (rated|liked)|top rated|highest rated)\b/],
  ['most-used', /\b(most (used|downloaded|popular|reused|common)|popular|frequently used|go-?to|used the most|used most)\b/],
  ['oldest', /\b(oldest|earliest|first ever)\b/],
  ['newest', /\b(most (recent|updated|current)|latest|newest|recent|up to date|up-to-date)\b/],
];
const ALL_ASKED = /\b(all|every|each|everything|any and all)\b/;

export function readAsk(query: string): Ask {
  const q = query.toLowerCase().replace(/[^a-z0-9 -]/g, ' ');
  return {
    // "slides from the hospitality deck" is slides; "the most recent hospitality deck" is a deck.
    want: DECKS_ASKED.test(q) && !SLIDES_ASKED.test(q) ? 'decks' : 'slides',
    order: ORDERS.find(([, re]) => re.test(q))?.[0] ?? null,
    all: ALL_ASKED.test(q),
  };
}

export const ORDER_NAME: Record<AskOrder, string> = { newest: 'newest first', oldest: 'oldest first', 'most-liked': 'most liked first', 'least-liked': 'least liked first', 'most-used': 'most used first' };

/** What the reader is allowed to pick from, so filters always match real values. */
export type PlanContext = { clients: string[]; categories: string[]; thisYear: number; /** the labels the AI may pick from (FD-83); absent when none are offered */ labels?: LabelMenu };

export type Chip = { kind: 'Topic' | 'Label' | 'Client' | 'Year' | 'Category' | 'Collection' | 'Mentions'; label: string };

export const MAX_KEYWORDS = 12;

/**
 * Words that describe every slide in the library, so they can't tell one from another. A search
 * that matches only these ("our most recent hospitality deck" -> "deck") would return slides that
 * look like answers but aren't, so they are never search words.
 */
const GENERIC_WORDS = new Set(['deck', 'decks', 'slide', 'slides', 'page', 'pages', 'proposal', 'proposals', 'presentation', 'presentations', 'pitch', 'ppt', 'pptx', 'powerpoint', 'm moser', 'mmoser']);

/** Words that say what a slide should do, not what it's about ("slides that demonstrate…"): never a named thing. */
const ASKING_WORDS = /^(demonstrat|show|highlight|explain|describ|prove|convey|communicat|illustrat|present|tell|help|support|cover|need|want|look|find|search|example|type|kind|sort|good|great|strong|similar|relevant|specific|particular|other|new|old|last|first|next)/;

/** Rules-only reader, used when no AI reader is configured or it can't be reached. */
export function standInPlan(query: string, ctx: PlanContext): SearchPlan {
  const p = parseQuery(query, ctx.clients);
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')} `;
  const keywords = [...p.tokens, ...p.concepts.flatMap((c) => c.words)];
  // The rules pick a client from any word of its name, so "a bank pitch" would become
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
  const plan = cleanPlan(
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
  return { ...plan, named: namedWords(query, ctx, plan) };
}

/**
 * What the person named that the plan's filters and topics don't already cover: the words left
 * after topics, client, year and category are read, plus codes typed as codes ("QA/QC"). Whether a
 * named word is rare enough to be required is decided against the library, in smartSearch.
 */
export function namedWords(query: string, ctx: PlanContext, plan: SearchPlan): string[] {
  const p = parseQuery(query, ctx.clients);
  const taken = new Set([plan.category, plan.client].filter(Boolean).flatMap((x) => x!.toLowerCase().split(/\s+/)));
  // A person's name that a topic took as its own word ("Moira" is the founder topic) is still named: beside other
  // words the search would otherwise answer the rest of the request ("Moira resume" filled with other people's résumés).
  const out = [...p.tokens, ...typedCodes(query), ...topicNames(query)].filter((w) => !taken.has(w) && !GENERIC_WORDS.has(w) && !isStopWord(w) && !ASKING_WORDS.test(w));
  // Shown as typed ("QNBC", "Toronto"); matched without regard to case.
  const typed = query.split(/\s+/).map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').replace(/['’]s$/i, ''));
  const asTyped = (w: string) => typed.find((t) => t.toLowerCase() === w) ?? typed.find((t) => t.toLowerCase().startsWith(w)) ?? w;
  // The parts of a code ("qa", "qc" of "QA/QC") are the code, not more names.
  const codes = out.filter((w) => /[/&+-]/.test(w));
  const kept = [...new Set(out)].filter((w) => !codes.some((c) => c !== w && c.split(/[/&+-]+/).includes(w)));
  return [...new Set(kept.slice(0, 4).map(asTyped))];
}

/**
 * Make any plan (the stand-in's or a model's) safe to run: filters must be real values, years
 * sensible, keywords short and de-duplicated. Anything that doesn't fit is dropped, not guessed.
 */
export function cleanPlan(raw: Partial<SearchPlan> & RawLabels, ctx: PlanContext): SearchPlan {
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
    keywords: words(raw.keywords, MAX_KEYWORDS + GENERIC_WORDS.size).filter((k) => !GENERIC_WORDS.has(k)).slice(0, MAX_KEYWORDS),
    topics: [...new Set((Array.isArray(raw.topics) ? raw.topics : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x && x.length <= 40))].slice(0, 4),
    client: pick(raw.client, ctx.clients),
    yearFrom,
    yearTo,
    category: pick(raw.category, ctx.categories),
    bestOfTheBest: raw.bestOfTheBest === true ? true : null,
    // Only labels on the menu survive; none offered means none kept.
    ...(ctx.labels ? { labels: cleanLabels(raw, ctx.labels) } : {}),
  };
}

/**
 * The client names a reader may see for this request: only those whose first (distinctive) word
 * was typed, the same rule the stand-in uses, so "a bank pitch" sends no client names at all. The
 * full client list never leaves the server; a client not named here can't become a filter anyway.
 */
export function relevantClients(query: string, clients: string[]): string[] {
  const typed = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return clients.filter((c) => typed.has(c.toLowerCase().split(/[^a-z0-9]+/).find(Boolean) ?? ''));
}

export { isBasicQuery, BASIC_MAX_WORDS };

/**
 * Keep only the filters the request actually asks for. Models like to add helpful-looking filters
 * (a category, a year range, Best of the Best) that nobody typed, which would silently hide good
 * results; the person's own words are the evidence. Clients are already limited by relevantClients.
 */
export function groundFilters(plan: SearchPlan, query: string): SearchPlan {
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ')} `;
  const asksForYears = /\b(19|20)\d\d\b/.test(q) || /\b(recent|latest|newest|newer|last (few|two|three|\d+) years?|this year|last year)\b/.test(q);
  return {
    ...plan,
    category: plan.category && q.includes(` ${plan.category.toLowerCase()} `) ? plan.category : null,
    bestOfTheBest: plan.bestOfTheBest && /best of (the )?best|\bbotb\b/.test(q) ? true : null,
    yearFrom: asksForYears ? plan.yearFrom : null,
    yearTo: asksForYears ? plan.yearTo : null,
  };
}

/**
 * The words exactly as typed, for short codes the rules skip: "QA/QC" gives "qa/qc", "qa" and "qc".
 * Two letters or more; filler words and words that match every slide are still left out.
 */
export function literalWords(query: string): string[] {
  const out: string[] = [];
  for (const raw of query.toLowerCase().split(/\s+/)) {
    const w = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (w.length < 2 || GENERIC_WORDS.has(w) || isStopWord(w)) continue;
    for (const k of [w, ...(/[/&+-]/.test(w) ? w.split(/[/&+-]+/) : [])]) if (k.length >= 2 && !out.includes(k)) out.push(k);
  }
  return out.slice(0, MAX_KEYWORDS);
}

/**
 * Codes typed in capitals or with a slash ("QA/QC", "MSA", "FF&E"), as typed. A model tends to
 * spell them out ("quality assurance"), but slides often only use the code, so both are searched.
 */
export function typedCodes(query: string): string[] {
  const codes = query.split(/\s+/).map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')).filter((w) => /^[A-Z0-9]{2,6}([/&+-][A-Z0-9]{1,6})*$/.test(w) && /[A-Z]/.test(w));
  return literalWords(codes.join(' '));
}

export function hasFilters(p: SearchPlan): boolean {
  return Boolean(p.client || p.yearFrom || p.yearTo || p.category || p.bestOfTheBest || hasLabels(p.labels));
}

/** The same plan with every filter removed, for when the filters leave nothing. */
export function withoutFilters(p: SearchPlan): SearchPlan {
  return { ...p, client: null, yearFrom: null, yearTo: null, category: null, bestOfTheBest: null };
}

/** Chips for the search box, so people can see (and later remove) how their words were read. */
export function chipsFor(p: SearchPlan): Chip[] {
  const chips: Chip[] = p.topics.map((label) => ({ kind: 'Topic' as const, label }));
  // What the AI read the request as, in the team's labels (FD-83). Shown, but not removable: they aren't words in the search.
  if (hasLabels(p.labels)) for (const v of [...p.labels.types, ...p.labels.themes, ...p.labels.sectors]) chips.push({ kind: 'Label', label: labelName(v) });
  if (p.client) chips.push({ kind: 'Client', label: p.client });
  if (p.yearFrom || p.yearTo) {
    const label = p.yearFrom === p.yearTo ? String(p.yearFrom) : p.yearTo ? `${p.yearFrom ?? 'Up'} to ${p.yearTo}` : `${p.yearFrom} or later`;
    chips.push({ kind: 'Year', label });
  }
  if (p.category) chips.push({ kind: 'Category', label: p.category });
  if (p.bestOfTheBest) chips.push({ kind: 'Collection', label: 'Best of the Best' });
  for (const w of p.named ?? []) chips.push({ kind: 'Mentions', label: w });
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
  // A short word must be the whole word ("app" is not "approach"), as in the search itself.
  const find = (hay: string, k: string) => { const e = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(k.length <= 3 ? `\\b${e}s?\\b` : `\\b${e}[\\w'’-]*`, 'i').exec(hay)?.[0] ?? null; };
  const has = (hay: string, k: string) => find(hay, k) !== null;
  const inTitle = plan.keywords.filter((k) => has(title, k));
  const inText = plan.keywords.filter((k) => !inTitle.includes(k) && has(text, k));
  const matched = [...inTitle, ...inText];
  /* Say the word as the slide has it, once: a word stem the search uses ("offic") shows as "office", and
     "office" and "offices" from one search are listed once (FD-96). */
  const shown: string[] = [];
  const same = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);
  const words = (hay: string, ks: string[]) =>
    ks.map((k) => find(hay, k)!).filter((w) => !shown.some((x) => same(x, w)) && shown.push(w) > 0);
  const titleWords = words(title, inTitle);
  const textWords = words(text, inText);

  const bits: string[] = [];
  if (titleWords.length) bits.push(`Has ${quoteList(titleWords.slice(0, 2))} in its title`);
  if (textWords.length) bits.push(`${titleWords.length ? 'mentions' : 'Mentions'} ${quoteList(textWords.slice(0, 2))}`);
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

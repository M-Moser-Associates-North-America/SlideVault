import 'server-only';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StoryUserRole } from '../contracts/dto';
import { isStopWord } from '../components/search-rules';
import { roleOf } from './ai/roles';
import { hasMmoserConfig, readConfig } from './config';
import { sql } from './db';

/**
 * Useful / Not relevant on a search result (docs/DECISIONS.md FD-59). Alina, 28 Oct: "if I don't like
 * a particular search result, how do I train the search?… I didn't want to see a director's
 * interview… So I could click on not relevant". Gabby: "to be able to say… this is working, this is
 * not working". Like the storyboard's (FD-24): a row is the slide, the verdict and the search's words
 * ("hospitality", "firm"), never the search itself or a name, and only from people who turned on
 * "learn from my activity" (FD-37). Kept in M Moser's database (table search_feedback,
 * sql/schema.sql); until that table exists there, on this computer (data dir).
 */

export type SearchVerdict = 'useful' | 'not-relevant';
export const SEARCH_VERDICTS: readonly SearchVerdict[] = ['useful', 'not-relevant'];
export type SearchFeedback = { slideId: string; verdict: SearchVerdict; words: string[]; by?: StoryUserRole | null; /** take one earlier click like this back (the person changed their mind) */ undo?: boolean };
type Row = SearchFeedback & { at: string };

const LOCAL_FILE = 'search-feedback.jsonl';
const MAX_WORDS = 12;
const FILLER = new Set(['slide', 'slides', 'deck', 'decks', 'page', 'pages', 'proposal', 'proposals', 'show', 'find', 'need', 'want', 'looking']);

/** The words of a search that say what it's about: "hospitality firms" -> ["hospitality", "firm"]. */
export function searchWords(query: string): string[] {
  const words = query
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9/&-]+/)
    .filter((w) => w.length >= 2 && !isStopWord(w) && !FILLER.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w));
  return [...new Set(words)].slice(0, MAX_WORDS);
}

/** Check what a browser sent; null when it isn't a valid piece of feedback. The search becomes its words here. */
export function cleanSearchFeedback(raw: unknown): SearchFeedback | null {
  const r = raw as { slideId?: unknown; verdict?: unknown; query?: unknown; by?: unknown; undo?: unknown } | null;
  if (!r || !SEARCH_VERDICTS.includes(r.verdict as SearchVerdict)) return null;
  if (typeof r.slideId !== 'string' || !r.slideId || r.slideId.length > 200) return null;
  if (typeof r.query !== 'string' || !r.query.trim() || r.query.length > 500) return null;
  const words = searchWords(r.query);
  if (!words.length) return null;
  return { slideId: r.slideId, verdict: r.verdict as SearchVerdict, words, by: roleOf(r.by), ...(r.undo === true ? { undo: true } : {}) };
}

const localPath = () => path.join(readConfig().dataDir, LOCAL_FILE);

async function inDb<T>(run: () => Promise<T>): Promise<T | undefined> {
  if (!hasMmoserConfig()) return undefined;
  try {
    return await run();
  } catch (e) {
    // Most likely the table hasn't been created in M Moser's database yet (npm run db:setup).
    console.warn('search_feedback unavailable in the database, using this computer:', (e as Error).message);
    return undefined;
  }
}

export async function recordSearchFeedback(f: SearchFeedback): Promise<void> {
  const saved = await inDb(() => sql('insert into search_feedback (slide_id, verdict, words, by_role) values ($1, $2, $3, $4)', [f.slideId, f.verdict, f.words, f.by ?? null]));
  if (saved !== undefined) return;
  await mkdir(path.dirname(localPath()), { recursive: true });
  await appendFile(localPath(), `${JSON.stringify({ ...f, at: new Date().toISOString() } satisfies Row)}\n`);
}

/**
 * Takes back one click like this one: the same slide, verdict, words and role, the newest. Nobody is
 * named in these rows, so it can't be that person's own row, but a tally is only counts, so removing
 * any one of them leaves the same totals. Used when someone changes their mind (Useful -> Not relevant).
 */
export async function retractSearchFeedback(f: SearchFeedback): Promise<void> {
  const done = await inDb(() =>
    sql('delete from search_feedback where id = (select id from search_feedback where slide_id = $1 and verdict = $2 and words = $3 and by_role is not distinct from $4 order by at desc limit 1)', [f.slideId, f.verdict, f.words, f.by ?? null]),
  );
  if (done !== undefined) return;
  let lines: string[];
  try {
    lines = (await readFile(localPath(), 'utf8')).split('\n').filter(Boolean);
  } catch {
    return;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const r = JSON.parse(lines[i]) as Row;
    if (r.slideId === f.slideId && r.verdict === f.verdict && (r.by ?? null) === (f.by ?? null) && r.words.length === f.words.length && r.words.every((w, k) => w === f.words[k])) {
      lines.splice(i, 1);
      break;
    }
  }
  await writeFile(localPath(), lines.length ? `${lines.join('\n')}\n` : '');
}

async function allRows(): Promise<Row[]> {
  const fromDb = await inDb(async () => {
    const rows = (await sql('select slide_id, verdict, words, by_role, at from search_feedback order by at desc limit 5000', [])) as { slide_id: string; verdict: SearchVerdict; words: string[]; by_role: string | null; at: Date }[];
    return rows.map((r) => ({ slideId: r.slide_id, verdict: r.verdict, words: r.words, by: roleOf(r.by_role), at: new Date(r.at).toISOString() }));
  });
  if (fromDb) return fromDb;
  try {
    return (await readFile(localPath(), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Row);
  } catch {
    return [];
  }
}

/**
 * Weighted counts, plus how many clear Not relevant clicks there were. A click counts in full when its
 * search was mostly this one, in part when it only shared some words, and double for the same role.
 */
export type SearchLearned = { useful: number; notRelevant: number; notRelevantVotes?: number };

/**
 * How alike a past search is to this one, 0 to 1: the share of the longer search's words that both
 * have. Words only for now; when search meaning (pgvector, FD-55) is stored per click this is the one
 * place to swap in a closeness of meaning (docs/DECISIONS.md FD-81).
 */
export function searchSimilarity(past: string[], mine: Set<string>): number {
  const shared = past.filter((w) => mine.has(w)).length;
  return shared / Math.max(past.length, mine.size, 1);
}

/** At or above this a past search is "the same search" (Vince's FD-78 rule: at least half the words), so the click counts in full. */
export const SAME_SEARCH = 0.5;

/** Is a past search mostly this one? "hospitality" and "hospitality firms" are; "hospitality decks" and "hospitality case studies" are not. */
export function sameSearch(past: string[], mine: Set<string>): boolean {
  return searchSimilarity(past, mine) >= SAME_SEARCH;
}

/**
 * What colleagues said about slides for searches like this one. For search ('similar'), a click counts
 * in full when its search was mostly the same, and by its similarity (never more than a half) when it
 * only shared some words, so "hospitality decks" leans a little on "hospitality case studies" without
 * ruling it; the storyboard asks with a whole brief's topics, so it counts any shared word in full
 * ('any'). Someone in the same role counts double (as in FD-25). Only clearly-the-same searches count
 * towards sending a slide last (notRelevantVotes).
 */
export function learnedForSearch(rows: Row[], words: string[], by: StoryUserRole | null = null, match: 'similar' | 'any' = 'similar'): Map<string, SearchLearned> {
  const mine = new Set(words);
  const out = new Map<string, SearchLearned>();
  if (!mine.size) return out;
  for (const r of rows) {
    const sim = searchSimilarity(r.words, mine);
    const same = sim >= SAME_SEARCH;
    const weight = match === 'any' ? (sim > 0 ? 1 : 0) : same ? 1 : sim;
    if (weight <= 0) continue;
    const l = out.get(r.slideId) ?? { useful: 0, notRelevant: 0, notRelevantVotes: 0 };
    const n = (by && r.by === by ? 2 : 1) * weight;
    if (r.verdict === 'useful') l.useful += n;
    else {
      l.notRelevant += n;
      if (same || match === 'any') l.notRelevantVotes = (l.notRelevantVotes ?? 0) + 1;
    }
    out.set(r.slideId, l);
  }
  return out;
}

export async function searchLearning(query: string, by: StoryUserRole | null = null, match: 'similar' | 'any' = 'similar'): Promise<Map<string, SearchLearned>> {
  return learnedForSearch(await allRows(), searchWords(query), by, match);
}

/** Clear Not relevant clicks it takes to send a slide to the end of the results: one person's click only nudges it. */
export const SINK_VOTES = 2;
/**
 * Goes last for this search: at least SINK_VOTES clear Not relevant clicks, and at least twice as much
 * not relevant as useful. A split verdict (3 useful, 3 not relevant) keeps its place, because burying a
 * slide half the colleagues find useful would be worse than showing one some don't.
 */
export const sinks = (l: SearchLearned | undefined) => !!l && (l.notRelevantVotes ?? 0) >= SINK_VOTES && l.notRelevant >= 2 * l.useful;

/** The most a slide can move for a search, either way (what three Useful clicks used to give). */
export const MAX_LEARNED = 6;
/** Pretend this much neutral evidence, so one click moves a slide less than several that agree. */
const PRIOR = 2;
/**
 * How much a slide moves for a search, up or down (FD-81): the balance of useful and not relevant, and
 * how much evidence there is. One click is 2, two clicks 3, ten clicks about 5, and the same number
 * either way. Ten Useful against three Not relevant is still clearly up. Never fades with age.
 */
export const learnedScore = (l: SearchLearned | undefined) => (l ? (MAX_LEARNED * (l.useful - l.notRelevant)) / (l.useful + l.notRelevant + PRIOR) : 0);

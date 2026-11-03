import 'server-only';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
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
export type SearchFeedback = { slideId: string; verdict: SearchVerdict; words: string[]; by?: StoryUserRole | null };
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
  const r = raw as { slideId?: unknown; verdict?: unknown; query?: unknown; by?: unknown } | null;
  if (!r || !SEARCH_VERDICTS.includes(r.verdict as SearchVerdict)) return null;
  if (typeof r.slideId !== 'string' || !r.slideId || r.slideId.length > 200) return null;
  if (typeof r.query !== 'string' || !r.query.trim() || r.query.length > 500) return null;
  const words = searchWords(r.query);
  if (!words.length) return null;
  return { slideId: r.slideId, verdict: r.verdict as SearchVerdict, words, by: roleOf(r.by) };
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

/** Weighted counts (same role counts double), plus how many Not relevant clicks there were. */
export type SearchLearned = { useful: number; notRelevant: number; notRelevantVotes?: number };

/**
 * Is a past search mostly this one? At least half of the words of the longer of the two are shared
 * (2 Nov, Khushali's catch): "hospitality" and "hospitality firms" are; "hospitality decks" and
 * "hospitality case studies" are not, so Not relevant on one doesn't follow the slide into the other.
 */
export function sameSearch(past: string[], mine: Set<string>): boolean {
  const shared = past.filter((w) => mine.has(w)).length;
  return shared > 0 && shared * 2 >= Math.max(past.length, mine.size);
}

/**
 * What colleagues said about slides for searches like this one. For search ('similar'), a verdict
 * counts when its search was mostly the same (sameSearch); the storyboard asks with a whole brief's
 * topics, so it counts any shared word ('any'). Someone in the same role counts double (as in FD-25).
 */
export function learnedForSearch(rows: Row[], words: string[], by: StoryUserRole | null = null, match: 'similar' | 'any' = 'similar'): Map<string, SearchLearned> {
  const mine = new Set(words);
  const out = new Map<string, SearchLearned>();
  if (!mine.size) return out;
  for (const r of rows) {
    if (match === 'similar' ? !sameSearch(r.words, mine) : !r.words.some((w) => mine.has(w))) continue;
    const l = out.get(r.slideId) ?? { useful: 0, notRelevant: 0, notRelevantVotes: 0 };
    const n = by && r.by === by ? 2 : 1;
    if (r.verdict === 'useful') l.useful += n;
    else {
      l.notRelevant += n;
      l.notRelevantVotes = (l.notRelevantVotes ?? 0) + 1;
    }
    out.set(r.slideId, l);
  }
  return out;
}

export async function searchLearning(query: string, by: StoryUserRole | null = null, match: 'similar' | 'any' = 'similar'): Promise<Map<string, SearchLearned>> {
  return learnedForSearch(await allRows(), searchWords(query), by, match);
}

/** Clicks it takes to send a slide to the end of the results: one person's Not relevant only nudges it. */
export const SINK_VOTES = 2;
/** Goes last for this search: at least SINK_VOTES Not relevant clicks, and more not relevant than useful. */
export const sinks = (l: SearchLearned | undefined) => !!l && (l.notRelevantVotes ?? 0) >= SINK_VOTES && l.notRelevant > l.useful;

/** How much a slide moves for a search: up for useful, further down for not relevant. */
export const learnedScore = (l: SearchLearned | undefined) => (l ? 2 * Math.min(l.useful, 3) - 4 * Math.min(l.notRelevant, 3) : 0);

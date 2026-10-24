import 'server-only';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { StoryFeedbackVerdict, StoryRole, StoryUserRole } from '../contracts/dto';
import { roleOf } from './ai/roles';
import { hasMmoserConfig, readConfig } from './config';
import { sql } from './db';
import { STORY_ROLES } from './ai/storyboard';

/**
 * "Was this helpful?" on a storyboard (docs/DECISIONS.md FD-24): the firm's memory of which slides
 * really do each part of a story, for which kinds of brief. A row is the part, the slide, the
 * verdict and the brief's topic words ("hospital", "merger"): no names, no person, never the brief
 * itself, so it needs no opt-in and is shared by everyone. Kept in M Moser's database (table
 * story_feedback, sql/schema.sql); until that table exists there, on this computer (data dir).
 */

export const VERDICTS: readonly StoryFeedbackVerdict[] = ['useful', 'not-right', 'nothing-fits'];
const MAX_TOPICS = 12;
const LOCAL_FILE = 'story-feedback.jsonl';

/** `role` is the story part; `by` is who gave the verdict (FD-25), so learning can lean on people in the same role. */
export type StoryFeedback = { role: StoryRole; slideId: string | null; verdict: StoryFeedbackVerdict; topics: string[]; by?: StoryUserRole | null };
type Row = StoryFeedback & { at: string };

/** Check what a browser sent; null when it isn't a valid piece of feedback. */
export function cleanFeedback(raw: unknown): StoryFeedback | null {
  const r = raw as Partial<StoryFeedback> | null;
  if (!r || !STORY_ROLES.includes(r.role as StoryRole) || !VERDICTS.includes(r.verdict as StoryFeedbackVerdict)) return null;
  const slideId = typeof r.slideId === 'string' && r.slideId.length > 0 && r.slideId.length <= 200 ? r.slideId : null;
  // A verdict on a slide needs the slide; "nothing fits" is about the whole part.
  if ((r.verdict === 'nothing-fits') !== (slideId === null)) return null;
  const topics = [...new Set((Array.isArray(r.topics) ? r.topics : []).filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase().trim()).filter((t) => /^[a-z0-9/-]{3,40}$/.test(t)))].slice(0, MAX_TOPICS);
  return { role: r.role as StoryRole, slideId, verdict: r.verdict as StoryFeedbackVerdict, topics, by: roleOf((raw as { by?: unknown }).by) };
}

/**
 * Whether this person's verdicts may teach the storyboard (FD-37). On M Moser's setup a verdict is
 * kept only from someone who turned on "learn from my activity" (opt-in, Alina 19 Oct); signed out
 * or opted out, nothing is stored. With no database there are no people or settings (a laptop demo),
 * so verdicts are kept on this computer as before. `optedIn` is passed in so this stays testable.
 */
export async function mayLearnFrom(user: string | null, optedIn: (user: string) => Promise<boolean>, database = hasMmoserConfig()): Promise<boolean> {
  if (!database) return true;
  if (!user) return false;
  return optedIn(user).catch(() => false);
}

const localPath = () => path.join(readConfig().dataDir, LOCAL_FILE);

async function inDb<T>(run: () => Promise<T>): Promise<T | undefined> {
  if (!hasMmoserConfig()) return undefined;
  try {
    return await run();
  } catch (e) {
    // Most likely the table hasn't been created in M Moser's database yet (npm run db:setup).
    console.warn('story_feedback unavailable in the database, using this computer:', (e as Error).message);
    return undefined;
  }
}

export async function recordStoryFeedback(f: StoryFeedback): Promise<void> {
  const saved = await inDb(() => sql('insert into story_feedback (role, slide_id, verdict, topics, by_role) values ($1, $2, $3, $4, $5)', [f.role, f.slideId, f.verdict, f.topics, f.by ?? null]));
  if (saved !== undefined) return;
  await mkdir(path.dirname(localPath()), { recursive: true });
  await appendFile(localPath(), `${JSON.stringify({ ...f, at: new Date().toISOString() } satisfies Row)}\n`);
}

async function allRows(): Promise<Row[]> {
  const fromDb = await inDb(async () => {
    const rows = (await sql('select role, slide_id, verdict, topics, by_role, at from story_feedback where slide_id is not null order by at desc limit 5000', [])) as { role: StoryRole; slide_id: string; verdict: StoryFeedbackVerdict; topics: string[]; by_role: string | null; at: Date }[];
    return rows.map((r) => ({ role: r.role, slideId: r.slide_id, verdict: r.verdict, topics: r.topics, by: roleOf(r.by_role), at: new Date(r.at).toISOString() }));
  });
  if (fromDb) return fromDb;
  try {
    return (await readFile(localPath(), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Row)
      .filter((r) => r.slideId);
  } catch {
    return [];
  }
}

export type Learned = { useful: number; notRight: number };

/** A verdict from someone in the same role counts this many times one from another role (FD-25). */
export const SAME_ROLE_WEIGHT = 2;

/**
 * What colleagues said about slides in each part, for briefs like this one: a verdict counts when
 * its brief shared at least one topic word, or when either brief had none. People in the same role
 * as the one asking count double: a director's "useful" matters most to other directors, and
 * everyone's still counts. Keyed "role:slideId".
 */
export function learnedFrom(rows: Row[], topics: string[], by: StoryUserRole | null = null): Map<string, Learned> {
  const mine = new Set(topics);
  const out = new Map<string, Learned>();
  for (const r of rows) {
    if (r.verdict === 'nothing-fits' || !r.slideId) continue;
    if (mine.size && r.topics.length && !r.topics.some((t) => mine.has(t))) continue;
    const key = `${r.role}:${r.slideId}`;
    const l = out.get(key) ?? { useful: 0, notRight: 0 };
    const n = by && r.by === by ? SAME_ROLE_WEIGHT : 1;
    if (r.verdict === 'useful') l.useful += n;
    else l.notRight += n;
    out.set(key, l);
  }
  return out;
}

export async function learnedForTopics(topics: string[], by: StoryUserRole | null = null): Promise<Map<string, Learned>> {
  return learnedFrom(await allRows(), topics, by);
}

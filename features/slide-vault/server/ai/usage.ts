import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { hasMmoserConfig, readConfig } from '../config';
import { sql } from '../db';

/**
 * Who uses the AI, and how much (docs/DECISIONS.md FD-91; Schiffon, 5 Nov: "track who's using what money, who's
 * using what tokens"). Every AI call goes through chatJson, which records one row here: who asked, when, which
 * feature (search_plan, storyboard, story, weave, deck_facts, deck_tags...), the model, the tokens the provider
 * reported and how long it took. Never the request text or the answer.
 *
 * Also the cap on AI calls running at once (FD-92): past SV_AI_MAX_CONCURRENT (default 4) on one server, a
 * call is refused at once with AiBusyError and the caller answers with its rules, so fifty people searching
 * together get quick results instead of a queue of slow ones.
 */

/* ---- Who is asking ------------------------------------------------------------------------- */

const person = new AsyncLocalStorage<string | null>();

/** Runs `work` with `user` as the person any AI call inside it is counted against (routes call this). */
export function asPerson<T>(user: string | null, work: () => Promise<T>): Promise<T> {
  return person.run(user, work);
}

const currentPerson = (): string | null => person.getStore() ?? null;

/* ---- The usage log ------------------------------------------------------------------------- */

export type AiUse = { user: string | null; feature: string; model: string; promptTokens: number; completionTokens: number; ms: number; ok: boolean; at?: string };

const LOCAL_FILE = 'ai-usage.jsonl';
const localPath = () => path.join(readConfig().dataDir, LOCAL_FILE);

/** Records one AI call. Never throws: a log that can't be written must not break a search. */
export async function recordAiUse(use: Omit<AiUse, 'user' | 'at'> & { user?: string | null }): Promise<void> {
  const row: AiUse = { ...use, user: use.user === undefined ? currentPerson() : use.user, at: new Date().toISOString() };
  if (hasMmoserConfig()) {
    try {
      await sql('insert into ai_usage (user_name, feature, model, prompt_tokens, completion_tokens, ms, ok) values ($1, $2, $3, $4, $5, $6, $7)', [row.user, row.feature, row.model, row.promptTokens, row.completionTokens, row.ms, row.ok]);
      return;
    } catch (e) {
      console.warn('ai_usage unavailable in the database, logging on this computer:', (e as Error).message);
    }
  }
  try {
    await mkdir(path.dirname(localPath()), { recursive: true });
    await appendFile(localPath(), `${JSON.stringify(row)}\n`);
  } catch (e) {
    console.warn('AI usage could not be logged:', (e as Error).message);
  }
}

export type AiUsageTotal = { user: string; calls: number; failed: number; promptTokens: number; completionTokens: number; totalTokens: number; byFeature: Record<string, number> };

/** Adds up rows per person (null user = "not signed in"), most tokens first. */
export function totalsOf(rows: AiUse[]): AiUsageTotal[] {
  const by = new Map<string, AiUsageTotal>();
  for (const r of rows) {
    const user = r.user ?? '(not signed in)';
    const t = by.get(user) ?? { user, calls: 0, failed: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, byFeature: {} };
    t.calls += 1;
    if (!r.ok) t.failed += 1;
    t.promptTokens += r.promptTokens;
    t.completionTokens += r.completionTokens;
    t.totalTokens += r.promptTokens + r.completionTokens;
    t.byFeature[r.feature] = (t.byFeature[r.feature] ?? 0) + 1;
    by.set(user, t);
  }
  return [...by.values()].sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls);
}

/** Per-person totals for the last `days` days; one person's only, when `user` is given. */
export async function aiUsageTotals(opts: { days?: number; user?: string } = {}): Promise<AiUsageTotal[]> {
  const days = opts.days ?? 30;
  const since = Date.now() - days * 86_400_000;
  let rows: AiUse[] | null = null;
  if (hasMmoserConfig()) {
    try {
      const got = await sql<{ user_name: string | null; feature: string; model: string; prompt_tokens: number; completion_tokens: number; ms: number; ok: boolean; at: Date }>(
        `select user_name, feature, model, prompt_tokens, completion_tokens, ms, ok, at from ai_usage where at >= to_timestamp($1 / 1000.0)${opts.user ? ' and user_name = $2' : ''}`,
        opts.user ? [since, opts.user] : [since],
      );
      rows = got.map((r) => ({ user: r.user_name, feature: r.feature, model: r.model, promptTokens: Number(r.prompt_tokens), completionTokens: Number(r.completion_tokens), ms: Number(r.ms), ok: r.ok, at: new Date(r.at).toISOString() }));
    } catch (e) {
      console.warn('ai_usage unavailable in the database, reading this computer:', (e as Error).message);
    }
  }
  if (!rows) {
    try {
      rows = (await readFile(localPath(), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as AiUse);
    } catch {
      rows = [];
    }
    rows = rows.filter((r) => (r.at ? Date.parse(r.at) >= since : true) && (!opts.user || r.user === opts.user));
  }
  return totalsOf(rows);
}

/* ---- How many AI calls at once ------------------------------------------------------------- */

export class AiBusyError extends Error {
  constructor() {
    super('AI is busy: too many AI calls are running right now');
    this.name = 'AiBusyError';
  }
}

/** The most AI calls one server runs at once (SV_AI_MAX_CONCURRENT, 1 to 100, default 4). */
export function maxConcurrentAi(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SV_AI_MAX_CONCURRENT || 4);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 4;
}

let running = 0;

/** Runs one AI call if there's room, else throws AiBusyError straight away (no waiting in line). */
export async function withAiSlot<T>(work: () => Promise<T>, max = maxConcurrentAi()): Promise<T> {
  if (running >= max) throw new AiBusyError();
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
  }
}

/** How many AI calls are running now (for tests and health checks). */
export const aiCallsRunning = (): number => running;

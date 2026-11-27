import 'server-only';
import { hasMmoserConfig } from './config';
import { sql } from './db';
import { fail } from './http';
import { userOf } from './principal';

/**
 * Per-person rate limits for search, AI search, export and upload (docs/SECURITY_AND_OPERATIONS.md:
 * "Rate-limit ingest, search and export by principal"; docs/DECISIONS.md FD-17, FD-90). Fixed one-minute windows.
 *
 *  - Counted per person: the signed-in user (principal.ts userOf), else the network address. One office behind
 *    one address is no longer one bucket for everyone in it.
 *  - Every address also has a ceiling (ADDRESS_FACTOR times the limit), because until M Moser's sign-in replaces
 *    the stand-in header, a caller could otherwise send a new name with every request and never be limited.
 *  - With M Moser's database set up, counts live in Postgres (table rate_limit_windows), so several app servers
 *    share one count and a restart doesn't reset it. Without a database, or if it fails, counts live in this
 *    server process: limits stay on, and search never stops because the counter is unreachable.
 */

export type RatePolicy = { name: string; limit: number; windowMs: number };

export const RATE_POLICIES = {
  search: { name: 'search', limit: 60, windowMs: 60_000 },
  // Every filter tick or crossed-out chip is a search too (FD-107), so the same 60 a minute as plain search; the AI stays capped on its own (FD-92).
  smartSearch: { name: 'smart-search', limit: 60, windowMs: 60_000 },
  export: { name: 'export', limit: 10, windowMs: 60_000 },
  upload: { name: 'upload', limit: 10, windowMs: 60_000 },
  // Reading a file to pre-fill its upload (FD-23): one per file, before the upload itself.
  uploadSuggest: { name: 'upload-suggest', limit: 10, windowMs: 60_000 },
  // Talking instead of typing (FD-24): one request per thing said.
  speech: { name: 'speech', limit: 30, windowMs: 60_000 },
  // "Was this helpful?" on a storyboard (FD-24): one click each.
  storyFeedback: { name: 'story-feedback', limit: 120, windowMs: 60_000 },
  // Useful / Not relevant on a search result (FD-59): one click each.
  searchFeedback: { name: 'search-feedback', limit: 120, windowMs: 60_000 },
  // Saved slides, My decks, activity (FD-18): small, frequent writes from normal use.
  userData: { name: 'user-data', limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RatePolicy>;

/** How many times one person's limit a whole address may use (an office of people sharing one address). */
export const ADDRESS_FACTOR = 10;

const windows = new Map<string, { count: number; resetAt: number }>();
const MAX_TRACKED = 10_000;

/** The network address: the first forwarded address, else a single local bucket. */
export function addressOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'local';
}

/** The person to count against: the signed-in user, else the address. */
export function callerOf(request: Request): string {
  const user = userOf(request);
  return user ? `user:${user.toLowerCase()}` : `ip:${addressOf(request)}`;
}

/** Counts one request in memory; returns the seconds to wait when the caller is over the limit. */
export function hit(policy: RatePolicy, caller: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  const key = `${policy.name}:${caller}`;
  let w = windows.get(key);
  if (!w || now >= w.resetAt) {
    if (windows.size >= MAX_TRACKED) for (const [k, v] of windows) if (now >= v.resetAt) windows.delete(k);
    w = { count: 0, resetAt: now + policy.windowMs };
    windows.set(key, w);
  }
  w.count++;
  return w.count <= policy.limit ? { ok: true } : { ok: false, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
}

/** Counts one request in Postgres, shared by every app server. Old windows are cleared now and then. */
async function hitInDb(policy: RatePolicy, caller: string, now = Date.now()): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const start = Math.floor(now / policy.windowMs) * policy.windowMs;
  const rows = await sql<{ count: number }>(
    `insert into rate_limit_windows (key, window_start, count) values ($1, to_timestamp($2 / 1000.0), 1)
     on conflict (key, window_start) do update set count = rate_limit_windows.count + 1
     returning count`,
    [`${policy.name}:${caller}`, start],
  );
  if (Math.random() < 0.01) void sql(`delete from rate_limit_windows where window_start < now() - interval '1 hour'`).catch(() => {});
  const count = Number(rows[0]?.count ?? 1);
  return count <= policy.limit ? { ok: true } : { ok: false, retryAfter: Math.max(1, Math.ceil((start + policy.windowMs - now) / 1000)) };
}

let warned = false;
async function count(policy: RatePolicy, caller: string): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  if (!hasMmoserConfig()) return hit(policy, caller);
  try {
    return await hitInDb(policy, caller);
  } catch (e) {
    // Most likely the table hasn't been created yet (npm run db:setup). Keep limiting, in memory.
    if (!warned) console.warn('rate_limit_windows unavailable in the database, counting on this server:', (e as Error).message);
    warned = true;
    return hit(policy, caller);
  }
}

/** For route handlers: null when the request may go ahead, otherwise the 429 response to return. */
export async function rateLimit(request: Request, policy: RatePolicy): Promise<Response | null> {
  const caller = callerOf(request);
  const person = await count(policy, caller);
  // The address ceiling only matters when the person was counted by name (FD-90).
  const address = caller.startsWith('user:') ? await count({ ...policy, limit: policy.limit * ADDRESS_FACTOR }, `addr:${addressOf(request)}`) : person;
  const r = !person.ok ? person : address;
  if (r.ok) return null;
  return fail(429, 'RATE_LIMITED', `Too many requests. Please wait ${r.retryAfter} seconds and try again.`, true, { 'Retry-After': String(r.retryAfter) });
}

/** Tests only: forget every count kept in memory. */
export function resetRateLimits(): void {
  windows.clear();
}

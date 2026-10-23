import 'server-only';
import { fail } from './http';

/**
 * Per-caller rate limits for search, AI search, export and upload (docs/SECURITY_AND_OPERATIONS.md:
 * "Rate-limit ingest, search and export by principal"). Fixed one-minute windows.
 *
 * Known limits, recorded in docs/DECISIONS.md FD-17:
 *  - Counts live in this server process. Several app instances each count separately, so a
 *    multi-instance deployment swaps this module for a shared store (Postgres or the host's own
 *    gateway limits); the routes don't change.
 *  - Until sign-in exists (FD-01) the caller is identified by address. A host platform that
 *    passes a signed-in user should key on that user instead.
 */

export type RatePolicy = { name: string; limit: number; windowMs: number };

export const RATE_POLICIES = {
  search: { name: 'search', limit: 60, windowMs: 60_000 },
  smartSearch: { name: 'smart-search', limit: 20, windowMs: 60_000 },
  export: { name: 'export', limit: 10, windowMs: 60_000 },
  upload: { name: 'upload', limit: 10, windowMs: 60_000 },
  // Saved slides, My decks, activity (FD-18): small, frequent writes from normal use.
  userData: { name: 'user-data', limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RatePolicy>;

const windows = new Map<string, { count: number; resetAt: number }>();
const MAX_TRACKED = 10_000;

/** The caller to count against: the first forwarded address, else a single local bucket. */
export function callerOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'local';
}

/** Counts this request; returns the seconds to wait when the caller is over the limit. */
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

/** For route handlers: null when the request may go ahead, otherwise the 429 response to return. */
export function rateLimit(request: Request, policy: RatePolicy): Response | null {
  const r = hit(policy, callerOf(request));
  if (r.ok) return null;
  return fail(429, 'RATE_LIMITED', `Too many requests. Please wait ${r.retryAfter} seconds and try again.`, true, { 'Retry-After': String(r.retryAfter) });
}

/** Tests only: forget every count. */
export function resetRateLimits(): void {
  windows.clear();
}

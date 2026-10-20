import 'server-only';
import { hasMmoserConfig } from './config';
import { fail } from './http';
import { userOf } from './principal';
import { rateLimit, RATE_POLICIES } from './rate-limit';

/**
 * Shared checks for the /me routes (docs/DECISIONS.md FD-18): rate limit, a signed-in person, and a
 * database to keep their data in. `handle` only runs when all three are there; a database error
 * becomes a plain "try again" message, never the error itself.
 */
export async function withUser(request: Request, handle: (user: string) => Promise<Response>): Promise<Response> {
  const limited = rateLimit(request, RATE_POLICIES.userData);
  if (limited) return limited;
  const user = userOf(request);
  if (!user) return fail(400, 'SIGNED_OUT', 'Sign in to keep saved slides, decks and activity.');
  if (!hasMmoserConfig()) return fail(503, 'UNAVAILABLE', 'Saved slides and decks need the database, which is not set up on this server.', false);
  try {
    return await handle(user);
  } catch (e) {
    console.error('Per-person data request failed', e);
    return fail(503, 'UNAVAILABLE', 'That could not be saved or loaded right now. Please try again.', true);
  }
}

/** The JSON body, or null when it isn't valid JSON. */
export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import type { PlanReader } from '@/features/slide-vault/server/ai/reader';
import { configuredReader, searchLibrary } from '@/features/slide-vault/server/services/library-smart-search';

// GET /smart-search?q=&limit=&read=1 (docs/DECISIONS.md FD-16, FD-17)
// One search over sample and uploaded decks. read=1 (sent when the person submits the search)
// lets the configured AI reader read a sentence or question; otherwise, and for basic searches,
// the rules do. Each result says why it fits; near-identical slides are grouped.
// Response: { query, reader, readerNote, plan, chips, relaxed, items: [{ slide, why, matched }] }
export async function GET(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.smartSearch);
  if (limited) return limited;
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  if (!query) return fail(400, 'BAD_REQUEST', 'Type what you are looking for in q.');
  if (query.length > 500) return fail(400, 'BAD_REQUEST', 'Keep the search under 500 characters.');
  const limit = Number(url.searchParams.get('limit') ?? 24);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail(400, 'BAD_REQUEST', 'limit must be a whole number from 1 to 100.');

  // A provider that is named but misconfigured is a setup error, not a reason to quietly use another.
  let reader: PlanReader | null;
  try {
    reader = configuredReader();
  } catch (e) {
    console.error('AI search is misconfigured:', (e as Error).message);
    return fail(500, 'LIBRARY_NOT_READY', 'Search is not set up correctly on the server.');
  }

  try {
    return ok(await searchLibrary(query, limit, { reader, read: url.searchParams.get('read') === '1' }));
  } catch (e) {
    console.error('Smart search failed', e);
    return fail(503, 'LIBRARY_NOT_READY', 'Search is unavailable right now. Please try again.', true);
  }
}

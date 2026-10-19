import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { readerFromConfig, type PlanReader } from '@/features/slide-vault/server/ai/reader';
import { listFilterValuesPg, smartSearchPg } from '@/features/slide-vault/server/pg-repository';
import { smartSearch } from '@/features/slide-vault/server/services/smart-search';

// GET /smart-search?q=&limit= (docs/DECISIONS.md FD-16, FD-17)
// Quick AI search over uploaded decks: reads the request with the configured AI reader
// (SV_AI_PROVIDER; rules only when none), searches with keywords and filters, and explains
// each result from what matched.
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
    reader = readerFromConfig();
  } catch (e) {
    console.error('AI search is misconfigured:', (e as Error).message);
    return fail(500, 'LIBRARY_NOT_READY', 'Search is not set up correctly on the server.');
  }

  try {
    const result = await smartSearch(query, limit, {
      context: listFilterValuesPg,
      reader,
      search: smartSearchPg,
      log: (m) => console.warn(m),
    });
    return ok(result);
  } catch (e) {
    console.error('Smart search failed', e);
    return fail(503, 'LIBRARY_NOT_READY', 'Search is unavailable right now. Please try again.', true);
  }
}

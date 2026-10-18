import { fail, ok } from '@/features/slide-vault/server';
import { claudePlan, hasClaudeKey } from '@/features/slide-vault/server/ai/claude';
import { listFilterValuesPg, smartSearchPg } from '@/features/slide-vault/server/pg-repository';
import { smartSearch } from '@/features/slide-vault/server/services/smart-search';

// GET /smart-search?q=&limit= (docs/DECISIONS.md FD-15)
// Quick AI search over uploaded decks: reads the request (Claude when ANTHROPIC_API_KEY is set,
// otherwise the rules-only stand-in), searches with keywords and filters, and explains each result.
// Response: { query, reader, readerNote, plan, chips, relaxed, items: [{ slide, why, matched }] }
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  if (!query) return fail(400, 'BAD_REQUEST', 'Type what you are looking for in q.');
  if (query.length > 500) return fail(400, 'BAD_REQUEST', 'Keep the search under 500 characters.');
  const limit = Number(url.searchParams.get('limit') ?? 24);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail(400, 'BAD_REQUEST', 'limit must be a whole number from 1 to 100.');

  try {
    const result = await smartSearch(query, limit, {
      context: listFilterValuesPg,
      claude: hasClaudeKey() ? (q, ctx) => claudePlan(q, ctx) : undefined,
      search: smartSearchPg,
      log: (m) => console.warn(m),
    });
    return ok(result);
  } catch (e) {
    console.error('Smart search failed', e);
    return fail(503, 'LIBRARY_NOT_READY', 'Search is unavailable right now. Please try again.', true);
  }
}

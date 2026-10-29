import { fail, ok } from '@/features/slide-vault/server';
import { markNotRelevant } from '@/features/slide-vault/server/search-feedback';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';

// POST /search-feedback { query, slideId, notRelevant: true | false } (docs/DECISIONS.md FD-56)
// "Not relevant" on a search result, or undo it. Who said it isn't stored, only the search and the
// slide. The slide then shows at the end of that search's results.
export async function POST(request: Request) {
  return withUser(
    request,
    async () => {
      const body = await jsonBody(request);
      if (!body) return fail(400, 'BAD_REQUEST', 'Send { "query": ..., "slideId": ..., "notRelevant": true } as JSON.');
      return ok(await markNotRelevant(body));
    },
    'Sign in to mark search results.',
  );
}

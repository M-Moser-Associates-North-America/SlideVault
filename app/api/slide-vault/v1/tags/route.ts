import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { hasMmoserConfig } from '@/features/slide-vault/server/config';
import { addTag, listTags } from '@/features/slide-vault/server/tags';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';

// GET /tags: every free-form tag in use, most used first: [{ tag, slides, decks }] (FD-53).
export async function GET(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.search);
  if (limited) return limited;
  if (!hasMmoserConfig()) return ok([]);
  try {
    return ok(await listTags());
  } catch (e) {
    console.error('Tag list failed', e);
    return fail(503, 'UNAVAILABLE', 'Tags could not be loaded right now. Please try again.', true);
  }
}

// POST /tags { on: 'slide' | 'deck', id, tag }: tag a slide or a whole deck. Returns { id, tag, on, addedBy, addedAt }.
export async function POST(request: Request) {
  return withUser(
    request,
    async (user) => {
      const body = await jsonBody(request);
      if (!body) return fail(400, 'BAD_REQUEST', 'Send { "on": "slide" | "deck", "id": ..., "tag": ... } as JSON.');
      return ok(await addTag(user, body));
    },
    'Sign in to add tags.',
  );
}

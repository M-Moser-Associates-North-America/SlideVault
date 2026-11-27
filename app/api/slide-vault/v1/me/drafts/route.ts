import { fail, ok } from '@/features/slide-vault/server';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';
import { createDraft, LIMITS, listDrafts, readDraftInput } from '@/features/slide-vault/server/user-data';

// GET /me/drafts: the signed-in person's decks under My decks, newest first (FD-18).
export async function GET(request: Request) {
  return withUser(request, async (user) => ok({ drafts: await listDrafts(user) }));
}

// POST /me/drafts { name, slideIds }: save the current draft deck under a name.
export async function POST(request: Request) {
  return withUser(request, async (user) => {
    const input = readDraftInput(await jsonBody(request));
    if (typeof input === 'string') return fail(400, 'BAD_REQUEST', input);
    const draft = await createDraft(user, input.name, input.slideIds);
    if (!draft) return fail(400, 'BAD_REQUEST', `You can keep up to ${LIMITS.drafts} decks. Delete one to save another.`);
    return ok({ draft });
  });
}

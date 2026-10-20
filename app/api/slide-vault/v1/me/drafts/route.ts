import { fail, ok } from '@/features/slide-vault/server';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';
import { createDraft, LIMITS, listDrafts } from '@/features/slide-vault/server/user-data';

// GET /me/drafts: the signed-in person's decks under My decks, newest first (FD-18).
export async function GET(request: Request) {
  return withUser(request, async (user) => ok({ drafts: await listDrafts(user) }));
}

// POST /me/drafts { name, slideIds }: save the current draft deck under a name.
export async function POST(request: Request) {
  return withUser(request, async (user) => {
    const body = await jsonBody(request);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const slideIds = body?.slideIds;
    if (!name || name.length > LIMITS.draftName) return fail(400, 'BAD_REQUEST', `Give the deck a name of up to ${LIMITS.draftName} characters.`);
    if (!Array.isArray(slideIds) || slideIds.length > LIMITS.draftSlides || slideIds.some((id) => typeof id !== 'string' || !id || id.length > LIMITS.slideId))
      return fail(400, 'BAD_REQUEST', `Send slideIds as a list of up to ${LIMITS.draftSlides} slide ids.`);
    const draft = await createDraft(user, name, slideIds as string[]);
    if (!draft) return fail(400, 'BAD_REQUEST', `You can keep up to ${LIMITS.drafts} decks. Delete one to save another.`);
    return ok({ draft });
  });
}

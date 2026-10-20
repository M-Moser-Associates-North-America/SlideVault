import { fail, ok } from '@/features/slide-vault/server';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';
import { LIMITS, listSaved, setSaved } from '@/features/slide-vault/server/user-data';

// GET /me/saved: the signed-in person's saved slide ids, newest first (FD-18).
export async function GET(request: Request) {
  return withUser(request, async (user) => ok({ slideIds: await listSaved(user) }));
}

// PATCH /me/saved { slideId, saved }: save or unsave one slide. Saving twice is harmless.
export async function PATCH(request: Request) {
  return withUser(request, async (user) => {
    const body = await jsonBody(request);
    const slideId = body?.slideId;
    if (typeof slideId !== 'string' || !slideId || slideId.length > LIMITS.slideId) return fail(400, 'BAD_REQUEST', 'Send the slideId to save.');
    if (typeof body?.saved !== 'boolean') return fail(400, 'BAD_REQUEST', 'Send saved: true or false.');
    await setSaved(user, slideId, body.saved);
    return ok({ slideId, saved: body.saved });
  });
}

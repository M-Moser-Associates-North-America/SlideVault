import { fail, ok } from '@/features/slide-vault/server';
import { removePack, updatePack } from '@/features/slide-vault/server/packs';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';

// PATCH /packs/:packId { label?, status?: 'confirmed' | 'suggested' }: rename, confirm or unconfirm
// (who and when are recorded). DELETE /packs/:packId: ungroup; a suggested pack is kept as dismissed
// so it is never suggested again. Slides are never touched. (docs/DECISIONS.md FD-38, FD-52)
export async function PATCH(request: Request, ctx: RouteContext<'/api/slide-vault/v1/packs/[packId]'>) {
  const { packId } = await ctx.params;
  return withUser(
    request,
    async (user) => {
      const body = await jsonBody(request);
      if (!body) return fail(400, 'BAD_REQUEST', 'Send { "label": ... } and/or { "status": "confirmed" | "suggested" } as JSON.');
      const pack = await updatePack(user, packId, body);
      return pack ? ok(pack) : fail(404, 'NOT_FOUND', 'That pack was not found.');
    },
    'Sign in to change packs.',
  );
}

export async function DELETE(request: Request, ctx: RouteContext<'/api/slide-vault/v1/packs/[packId]'>) {
  const { packId } = await ctx.params;
  return withUser(
    request,
    async (user) => {
      const done = await removePack(user, packId);
      return done ? ok(done) : fail(404, 'NOT_FOUND', 'That pack was not found.');
    },
    'Sign in to change packs.',
  );
}

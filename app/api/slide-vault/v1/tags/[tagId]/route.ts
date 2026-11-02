import { fail, ok } from '@/features/slide-vault/server';
import { removeTag } from '@/features/slide-vault/server/tags';
import { withUser } from '@/features/slide-vault/server/user-route';

// DELETE /tags/:tagId: take a free-form tag off its slide or deck (FD-53). It's kept with who removed
// it and when, so it can be restored (FD-72).
export async function DELETE(request: Request, ctx: RouteContext<'/api/slide-vault/v1/tags/[tagId]'>) {
  const { tagId } = await ctx.params;
  return withUser(request, async (user) => ((await removeTag(tagId, user)) ? ok({ deleted: tagId }) : fail(404, 'NOT_FOUND', 'That tag was not found.')), 'Sign in to remove tags.');
}

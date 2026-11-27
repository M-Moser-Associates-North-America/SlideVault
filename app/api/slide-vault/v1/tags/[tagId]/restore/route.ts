import { fail, ok } from '@/features/slide-vault/server';
import { restoreTag } from '@/features/slide-vault/server/tags';
import { withUser } from '@/features/slide-vault/server/user-route';

// POST /tags/:tagId/restore: bring back a removed tag with its original adder (FD-72). The Undo after
// removing a tag, and Restore in the slide page's list of removed tags, both use it.
export async function POST(request: Request, ctx: RouteContext<'/api/slide-vault/v1/tags/[tagId]/restore'>) {
  const { tagId } = await ctx.params;
  return withUser(request, async () => {
    const tag = await restoreTag(tagId);
    return tag ? ok(tag) : fail(404, 'NOT_FOUND', 'That removed tag was not found.');
  }, 'Sign in to restore tags.');
}

import { ok } from '@/features/slide-vault/server';
import { listRemovedTags } from '@/features/slide-vault/server/tags';
import { withUser } from '@/features/slide-vault/server/user-route';

// GET /tags/removed?on=slide|deck&id=: the tags removed from one slide or deck, newest first, with who
// removed each (FD-72), so the slide page can say so and offer Restore.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return withUser(request, async () => ok(await listRemovedTags(url.searchParams.get('on'), url.searchParams.get('id'))), 'Sign in to see removed tags.');
}

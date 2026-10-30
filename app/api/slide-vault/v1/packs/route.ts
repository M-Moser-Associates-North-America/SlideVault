import { fail, ok } from '@/features/slide-vault/server';
import { createPack } from '@/features/slide-vault/server/packs';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';

// POST /packs { slideIds: string[] (in order), label: string | null } (docs/DECISIONS.md FD-38, FD-52)
// A person groups 2 to 20 slides from one deck; saved as confirmed, by them. 409 when a slide is
// already in a pack. Returns { id, label, status, confirmedBy, confirmedAt, slideIds }.
export async function POST(request: Request) {
  return withUser(
    request,
    async (user) => {
      const body = await jsonBody(request);
      if (!body) return fail(400, 'BAD_REQUEST', 'Send { "slideIds": [...], "label": ... } as JSON.');
      return ok(await createPack(user, body));
    },
    'Sign in to group slides into a pack.',
  );
}

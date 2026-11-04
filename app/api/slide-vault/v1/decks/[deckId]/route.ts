import { fail, ok } from '@/features/slide-vault/server';
import { setDeckArchived } from '@/features/slide-vault/server/pg-repository';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';

// PATCH /decks/:deckId { archived: true | false } (docs/DECISIONS.md FD-50, FD-52)
// Archive hides a deck from the app, search and AI; restore brings it back. Nothing is deleted, and
// who did it and when are recorded. Anyone signed in may do it for the MVP (a tier decision for Alina).
export async function PATCH(request: Request, ctx: RouteContext<'/api/slide-vault/v1/decks/[deckId]'>) {
  const { deckId } = await ctx.params;
  return withUser(
    request,
    async (user) => {
      const body = await jsonBody(request);
      if (!body || typeof body.archived !== 'boolean') return fail(400, 'BAD_REQUEST', 'Send { "archived": true } to archive or { "archived": false } to restore.');
      const deck = await setDeckArchived(deckId, body.archived, user);
      return deck ? ok(deck) : fail(404, 'NOT_FOUND', 'That deck was not found.');
    },
    'Sign in to archive or restore decks.',
  );
}

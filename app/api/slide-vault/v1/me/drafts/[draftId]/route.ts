import { fail, ok } from '@/features/slide-vault/server';
import { withUser } from '@/features/slide-vault/server/user-route';
import { deleteDraft } from '@/features/slide-vault/server/user-data';

// DELETE /me/drafts/:draftId: delete one of the signed-in person's decks (FD-18).
export async function DELETE(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return withUser(request, async (user) => ((await deleteDraft(user, draftId)) ? ok({ deleted: draftId }) : fail(404, 'NOT_FOUND', 'That deck was not found.')));
}

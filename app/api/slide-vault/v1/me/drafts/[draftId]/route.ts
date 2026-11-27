import { fail, ok } from '@/features/slide-vault/server';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';
import { deleteDraft, readDraftInput, updateDraft } from '@/features/slide-vault/server/user-data';

// PATCH /me/drafts/:draftId { name, slideIds }: update one of the signed-in person's decks in place (same id).
export async function PATCH(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return withUser(request, async (user) => {
    const input = readDraftInput(await jsonBody(request));
    if (typeof input === 'string') return fail(400, 'BAD_REQUEST', input);
    const draft = await updateDraft(user, draftId, input.name, input.slideIds);
    return draft ? ok({ draft }) : fail(404, 'NOT_FOUND', 'That deck was not found.');
  });
}

// DELETE /me/drafts/:draftId: delete one of the signed-in person's decks (FD-18).
export async function DELETE(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return withUser(request, async (user) => ((await deleteDraft(user, draftId)) ? ok({ deleted: draftId }) : fail(404, 'NOT_FOUND', 'That deck was not found.')));
}

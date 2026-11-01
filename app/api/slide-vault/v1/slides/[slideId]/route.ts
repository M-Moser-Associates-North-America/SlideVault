import { fail, findSlide, getSlidePg, loadLibraryIndex, ok, toSummary } from '@/features/slide-vault/server';
import { renameSlidePg } from '@/features/slide-vault/server/pg-repository';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';
import { withPacks } from '@/features/slide-vault/server/packs';
import { withTags } from '@/features/slide-vault/server/tags';

// GET /slides/:id: slide details, provenance and text (docs/DATA_AND_API.md)
// Checks the fixture index first, then Postgres (uploaded decks).
export async function GET(_request: Request, ctx: RouteContext<'/api/slide-vault/v1/slides/[slideId]'>) {
  const { slideId } = await ctx.params;
  const index = await loadLibraryIndex();
  const found = index && findSlide(index, slideId);
  if (found) return ok({ ...toSummary(found.source, found.slide), text: found.slide.text });

  const pg = await getSlidePg(slideId).catch(() => null);
  if (pg) {
    const [summary] = await withTags(await withPacks([pg.summary]));
    return ok({ ...summary, text: pg.text });
  }

  return fail(404, 'NOT_FOUND', 'Slide not found.');
}

// PATCH /slides/:id { title }: rename a slide for everyone (FD-73). The title read from the slide is kept,
// with who renamed it and when ("last renamed by" on the slide page); { title: null } puts it back.
// Only uploaded slides; anyone signed in for the MVP (who may is a tier decision for Alina).
export async function PATCH(request: Request, ctx: RouteContext<'/api/slide-vault/v1/slides/[slideId]'>) {
  const { slideId } = await ctx.params;
  return withUser(
    request,
    async (user) => {
      const body = await jsonBody(request);
      const raw = body?.title;
      if (raw !== null && typeof raw !== 'string') return fail(400, 'BAD_REQUEST', 'Send { "title": "New name" }, or { "title": null } to put the original back.');
      const title = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : null;
      if (title !== null && (!title || title.length > 200 || /[\u0000-\u001f\u007f]/.test(title))) return fail(400, 'BAD_REQUEST', 'A slide name is 1 to 200 characters.');
      const saved = await renameSlidePg(slideId, title, user);
      return saved ? ok(saved) : fail(404, 'NOT_FOUND', 'That slide was not found.');
    },
    'Sign in to rename slides.',
  );
}

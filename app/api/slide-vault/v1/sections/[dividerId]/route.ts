import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { withPacks } from '@/features/slide-vault/server/packs';
import { sectionSlides } from '@/features/slide-vault/server/services/library-smart-search';
import { withTags } from '@/features/slide-vault/server/tags';

// GET /sections/:dividerId?hidden=include: one deck section in full, in deck order (docs/DECISIONS.md FD-80).
// dividerId is the one every search result carries in slide.section.dividerId. Returns { name, kind, slides }.
// Read-only. Hidden-in-source and internal-only slides are left out unless hidden=include, as in search.
export async function GET(request: Request, ctx: RouteContext<'/api/slide-vault/v1/sections/[dividerId]'>) {
  const limited = rateLimit(request, RATE_POLICIES.search);
  if (limited) return limited;
  const { dividerId } = await ctx.params;
  if (!dividerId || dividerId.length > 200) return fail(400, 'BAD_REQUEST', 'That is not a section.');
  try {
    const found = await sectionSlides(dividerId, new URL(request.url).searchParams.get('hidden') === 'include');
    if (!found) return fail(404, 'NOT_FOUND', 'That section was not found.');
    return ok({ ...found, slides: await withTags(await withPacks(found.slides)) });
  } catch (e) {
    console.error('Section failed', e);
    return fail(503, 'LIBRARY_NOT_READY', 'That section could not be loaded right now. Please try again.', true);
  }
}

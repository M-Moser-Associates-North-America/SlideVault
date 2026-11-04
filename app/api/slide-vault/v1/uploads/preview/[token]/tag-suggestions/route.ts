import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { previewTagSuggestions } from '@/features/slide-vault/server/slide-embeddings';
import { previewSlideTexts } from '@/features/slide-vault/server/services/upload-preview';

// GET /uploads/preview/:token/tag-suggestions (docs/DECISIONS.md FD-82)
// Tag suggestions for a file being uploaded, before it is saved: { deck: [...], slides: { "3": [...] } },
// each { tag, from: 'people' | 'reading', score }, from the library slides closest in meaning. Nothing is
// stored; the person picks which to keep. Empty lists when meaning search isn't set up. 404 once the
// preview has expired (about two hours).
export async function GET(request: Request, ctx: RouteContext<'/api/slide-vault/v1/uploads/preview/[token]/tag-suggestions'>) {
  const limited = rateLimit(request, RATE_POLICIES.uploadSuggest);
  if (limited) return limited;
  const { token } = await ctx.params;
  const slides = previewSlideTexts(token);
  if (!slides) return fail(404, 'NOT_FOUND', 'That preview has expired. Choose the file again.');
  return ok(await previewTagSuggestions(slides));
}

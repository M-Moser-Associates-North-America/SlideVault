import { fail, findSlide, loadLibraryIndex, ok, toSummary } from '@/features/slide-vault/server';

// GET /slides/:id: slide details, provenance and text (docs/DATA_AND_API.md)
export async function GET(_request: Request, ctx: RouteContext<'/api/slide-vault/v1/slides/[slideId]'>) {
  const { slideId } = await ctx.params;
  const index = await loadLibraryIndex();
  const found = index && findSlide(index, slideId);
  if (!found) return fail(404, 'NOT_FOUND', 'Slide not found.');
  return ok({ ...toSummary(found.source, found.slide), text: found.slide.text });
}

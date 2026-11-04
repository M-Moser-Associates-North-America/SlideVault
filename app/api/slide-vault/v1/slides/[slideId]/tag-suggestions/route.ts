import { ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { tagSuggestions } from '@/features/slide-vault/server/slide-embeddings';

// GET /slides/:id/tag-suggestions (docs/DECISIONS.md FD-82)
// Up to 5 tags worth adding to this slide, from the slides closest to it in meaning (pgvector):
// { suggestions: [{ tag, from: 'people' | 'reading', score }] }. Read-only; nothing is saved until a
// person adds one. An empty list when meaning search isn't set up or the slide has no fingerprint yet.
export async function GET(request: Request, ctx: RouteContext<'/api/slide-vault/v1/slides/[slideId]/tag-suggestions'>) {
  const limited = rateLimit(request, RATE_POLICIES.smartSearch);
  if (limited) return limited;
  const { slideId } = await ctx.params;
  return ok({ suggestions: await tagSuggestions(slideId) });
}

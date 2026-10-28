import { fail, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { previewImage } from '@/features/slide-vault/server/services/upload-preview';

// GET /uploads/preview/:token/:slide: one preview picture from POST /uploads/preview (FD-54).
// Kept for about two hours; 404 after that, or for a token that was never made.
export async function GET(request: Request, ctx: RouteContext<'/api/slide-vault/v1/uploads/preview/[token]/[slide]'>) {
  const limited = rateLimit(request, RATE_POLICIES.search);
  if (limited) return limited;
  const { token, slide } = await ctx.params;
  const png = previewImage(token, slide);
  if (!png) return fail(404, 'NOT_FOUND', 'That preview has expired. Choose the file again.');
  return new Response(png as BodyInit, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=7200' } });
}

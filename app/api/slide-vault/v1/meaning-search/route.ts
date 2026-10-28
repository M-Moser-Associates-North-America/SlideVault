import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { meaningSearch } from '@/features/slide-vault/server/meaning-search';
import { withPacks } from '@/features/slide-vault/server/packs';
import { isInternalOnly } from '@/features/slide-vault/server/pg-repository';
import { withTags } from '@/features/slide-vault/server/tags';

// GET /meaning-search?q=&limit= (docs/DECISIONS.md FD-55)
// Slides closest in meaning to the words, using pgvector in M Moser's database. Returns
// { available, model, items: [{ slide, similarity }] }; available is false when meaning search
// isn't set up or can't run right now, and keyword search should be used instead.
export async function GET(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.smartSearch);
  if (limited) return limited;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return fail(400, 'BAD_REQUEST', 'Type what you are looking for in q.');
  if (q.length > 500) return fail(400, 'BAD_REQUEST', 'Keep the search under 500 characters.');
  const limit = Number(url.searchParams.get('limit') ?? 24);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail(400, 'BAD_REQUEST', 'limit must be a whole number from 1 to 100.');
  const found = await meaningSearch(q, limit);
  if (!found) return ok({ available: false, model: null, items: [] });
  const includeHidden = url.searchParams.get('hidden') === 'include';
  const items = found.items.filter((i) => includeHidden || (!i.slide.hiddenInSource && !isInternalOnly(i.slide)));
  const slides = await withTags(await withPacks(items.map((i) => i.slide)));
  return ok({ available: true, model: found.model, items: items.map((i, n) => ({ slide: slides[n], similarity: Math.round(i.similarity * 1000) / 1000 })) });
}

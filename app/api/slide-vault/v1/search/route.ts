import { DEFAULT_LIMIT, fail, loadLibraryIndex, ok, searchSlides, searchSlidesPg } from '@/features/slide-vault/server';

// GET /search?q=&kind=slide&cursor=&limit= (docs/DATA_AND_API.md)
//
// Queries both the synthetic-fixture JSON index and the Postgres tables uploads write to,
// and concatenates the results. The two aren't merged into one cursor-paginated system yet
// (noted as a follow-up, not a silent gap) -- today's goal is an uploaded deck's slides
// actually showing up here, not full cross-source pagination correctness.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? 'slide';
  if (kind !== 'slide') return fail(400, 'BAD_REQUEST', 'Only kind=slide is available.');
  const limit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  if (!Number.isInteger(limit)) return fail(400, 'BAD_REQUEST', 'limit must be a whole number.');
  const query = url.searchParams.get('q') ?? '';

  const index = await loadLibraryIndex();
  const fixtureResult = index ? searchSlides(index, { query, cursor: url.searchParams.get('cursor'), limit }) : { items: [], nextCursor: null };

  let uploadedItems: Awaited<ReturnType<typeof searchSlidesPg>> = [];
  try {
    uploadedItems = await searchSlidesPg(query, limit);
  } catch (e) {
    // Supabase not configured on this checkout yet, or a transient error: fall back to
    // fixture-only results rather than failing the whole search.
    console.error('Postgres search unavailable, showing fixture results only', e);
  }

  if (!index && uploadedItems.length === 0) {
    return fail(503, 'LIBRARY_NOT_READY', 'The library is empty. Run `npm run ingest` or upload a deck.', true);
  }

  return ok([...uploadedItems, ...fixtureResult.items], { page: { nextCursor: fixtureResult.nextCursor } });
}

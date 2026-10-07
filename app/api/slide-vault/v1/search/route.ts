import { DEFAULT_LIMIT, fail, loadLibraryIndex, ok, searchSlides } from '@/features/slide-vault/server';

// GET /search?q=&kind=slide&cursor=&limit= (docs/DATA_AND_API.md)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? 'slide';
  if (kind !== 'slide') return fail(400, 'BAD_REQUEST', 'Only kind=slide is available.');
  const limit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  if (!Number.isInteger(limit)) return fail(400, 'BAD_REQUEST', 'limit must be a whole number.');

  const index = await loadLibraryIndex();
  if (!index) return fail(503, 'LIBRARY_NOT_READY', 'The library is empty. Run `npm run ingest`, then restart the app.', true);

  const { items, nextCursor } = searchSlides(index, { query: url.searchParams.get('q') ?? '', cursor: url.searchParams.get('cursor'), limit });
  return ok(items, { page: { nextCursor } });
}

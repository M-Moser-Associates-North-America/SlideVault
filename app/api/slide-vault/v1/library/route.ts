import { buildLibrary, fail, fixtureLibrary, listLibraryPg, loadLibraryIndex, ok } from '@/features/slide-vault/server';

// GET /library: every ready deck and slide (uploaded decks first, then fixture decks), with
// duplicate groups marked. For screens that browse and filter in the browser, like the V3
// prototype. Fine at prototype size (a few thousand slides); a paged API is the follow-up.
// ?source=upload leaves out the fixture decks.
export async function GET(request: Request) {
  const onlyUploads = new URL(request.url).searchParams.get('source') === 'upload';
  const index = onlyUploads ? null : await loadLibraryIndex();

  let uploaded: Awaited<ReturnType<typeof listLibraryPg>> = { decks: [], slides: [] };
  try {
    uploaded = await listLibraryPg();
  } catch (e) {
    console.error('Postgres library unavailable, showing fixture decks only', e);
  }

  const data = buildLibrary([uploaded, fixtureLibrary(index)]);
  if (data.slides.length === 0) return fail(503, 'LIBRARY_NOT_READY', 'The library is empty. Upload a deck or run `npm run ingest`.', true);
  return ok(data);
}

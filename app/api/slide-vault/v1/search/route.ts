import {
  DEFAULT_LIMIT,
  fail,
  fixtureSlideTexts,
  groupDuplicates,
  listSlideTextsPg,
  loadLibraryIndex,
  ok,
  RATE_POLICIES,
  rateLimit,
  searchSlides,
  searchSlidesPg,
  type SlideText,
  withDuplicateBadges,
} from '@/features/slide-vault/server';

// GET /search?q=&kind=slide&cursor=&limit= (docs/DATA_AND_API.md)
//
// Queries both the synthetic-fixture JSON index and the Postgres tables uploads write to,
// and concatenates the results. The two aren't merged into one cursor-paginated system yet
// (noted as a follow-up, not a silent gap) -- today's goal is an uploaded deck's slides
// actually showing up here, not full cross-source pagination correctness.
export async function GET(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.search);
  if (limited) return limited;
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

  // Duplicate grouping (PRD P1): one card per group, marked "also in N decks". Groups are
  // worked out over the whole library each time, which is fine at prototype size (a few
  // thousand slides); a stored group table is the follow-up for the full archive.
  let texts: SlideText[] = fixtureSlideTexts(index);
  try {
    texts = [...texts, ...(await listSlideTextsPg())];
  } catch (e) {
    console.error('Postgres slide text unavailable, grouping fixture slides only', e);
  }
  const groups = groupDuplicates(texts);
  const slideDeck = new Map(texts.map((t) => [t.id, t.sourceId]));
  // duplicates=all keeps every copy so a deck's page can list all its slides; the badge is still added.
  const collapse = url.searchParams.get('duplicates') !== 'all';
  const items = withDuplicateBadges([...uploadedItems, ...fixtureResult.items], groups, slideDeck, collapse);

  return ok(items, { page: { nextCursor: fixtureResult.nextCursor } });
}

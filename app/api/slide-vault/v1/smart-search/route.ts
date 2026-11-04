import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import type { PlanReader } from '@/features/slide-vault/server/ai/reader';
import { roleOf } from '@/features/slide-vault/server/ai/roles';
import { meaningSearch } from '@/features/slide-vault/server/meaning-search';
import { withPacks } from '@/features/slide-vault/server/packs';
import { hasMmoserConfig } from '@/features/slide-vault/server/config';
import { getSlideSummariesPg, isInternalOnly } from '@/features/slide-vault/server/pg-repository';
import { tagsInQuery, withTags } from '@/features/slide-vault/server/tags';
import { taggedFirst } from '@/features/slide-vault/server/services/tagged-first';
import { configuredReader, readerForSearch, searchLibrary } from '@/features/slide-vault/server/services/library-smart-search';

// GET /smart-search?q=&limit=&read=1&ai=off&role= (docs/DECISIONS.md FD-16, FD-17, FD-59, FD-79)
// One search over sample and uploaded decks. read=1 (sent when the person submits the search)
// lets the configured AI reader read a sentence or question; otherwise, and for basic searches,
// the rules do. ai=off (the "Deeper AI search" checkbox unticked) keeps the AI reader out of this one
// search; aiAvailable tells the screen whether to offer the checkbox at all. Each result says why it fits; near-identical slides are grouped.
// Response: { query, reader, readerNote, plan, chips, relaxed, items: [{ slide, why, matched }] }
export async function GET(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.smartSearch);
  if (limited) return limited;
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  if (!query) return fail(400, 'BAD_REQUEST', 'Type what you are looking for in q.');
  if (query.length > 500) return fail(400, 'BAD_REQUEST', 'Keep the search under 500 characters.');
  const limit = Number(url.searchParams.get('limit') ?? 24);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail(400, 'BAD_REQUEST', 'limit must be a whole number from 1 to 100.');

  // A provider that is named but misconfigured is a setup error, not a reason to quietly use another.
  let reader: PlanReader | null;
  try {
    reader = configuredReader();
  } catch (e) {
    console.error('AI search is misconfigured:', (e as Error).message);
    return fail(500, 'LIBRARY_NOT_READY', 'Search is not set up correctly on the server.');
  }

  try {
    const result = await searchLibrary(query, limit, { reader: readerForSearch(reader, url.searchParams.get('ai')), read: url.searchParams.get('read') === '1', force: url.searchParams.get('ai') === 'always', by: roleOf(url.searchParams.get('role')), includeHidden: url.searchParams.get('hidden') === 'include' });
    // Hidden-in-source slides (usually internal notes) only when asked for (FD-50).
    // ...and so are slides the team marked "internal - never show" (FD-53).
    if (url.searchParams.get('hidden') !== 'include') result.items = result.items.filter((i) => !i.slide.hiddenInSource && !isInternalOnly(i.slide));
    // Meaning search (FD-55): when the person submits a search, slides close in meaning are added
    // after the keyword results, so it never finds less than before. Off when it isn't set up.
    if (url.searchParams.get('read') === '1' && result.items.length < limit) {
      const minSimilarity = Number(process.env.SV_MEANING_MIN_SIMILARITY || 0.55);
      const meaning = await meaningSearch(query, limit);
      const have = new Set(result.items.map((i) => i.slide.id));
      for (const hit of meaning?.items ?? []) {
        if (result.items.length >= limit) break;
        if (have.has(hit.slide.id) || hit.similarity < minSimilarity) continue;
        if (url.searchParams.get('hidden') !== 'include' && (hit.slide.hiddenInSource || isInternalOnly(hit.slide))) continue;
        result.items.push({ slide: hit.slide, why: 'Close in meaning to your search, even where the words differ.', matched: [] });
        have.add(hit.slide.id);
      }
    }
    // People's own tags lead (FD-58): "Priya" finds the page someone tagged Priya. Off without a database.
    if (hasMmoserConfig()) {
      const hits = await tagsInQuery(query);
      const hide = url.searchParams.get('hidden') !== 'include';
      result.items = (await taggedFirst(query, result.items, hits, getSlideSummariesPg)).filter((i) => !hide || (!i.slide.hiddenInSource && !isInternalOnly(i.slide))).slice(0, limit);
    }
    // Each slide in a pack carries the whole pack (FD-38, FD-52).
    const packed = await withTags(await withPacks(result.items.map((i) => i.slide)));
    result.items = result.items.map((i, n) => ({ ...i, slide: packed[n] }));
    return ok({ ...result, aiAvailable: reader !== null });
  } catch (e) {
    console.error('Smart search failed', e);
    return fail(503, 'LIBRARY_NOT_READY', 'Search is unavailable right now. Please try again.', true);
  }
}

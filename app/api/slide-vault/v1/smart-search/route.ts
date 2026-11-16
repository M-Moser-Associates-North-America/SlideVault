import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import type { PlanReader } from '@/features/slide-vault/server/ai/reader';
import { roleOf } from '@/features/slide-vault/server/ai/roles';
import { asPerson } from '@/features/slide-vault/server/ai/usage';
import { userOf } from '@/features/slide-vault/server/principal';
import { meaningSearch } from '@/features/slide-vault/server/meaning-search';
import { blendByMeaning } from '@/features/slide-vault/server/services/hybrid-rank';
import { isSectionSearch } from '@/features/slide-vault/server/services/sections';
import { searchIntent } from '@/features/slide-vault/server/services/slide-intent';
import { withPacks } from '@/features/slide-vault/server/packs';
import { hasMmoserConfig } from '@/features/slide-vault/server/config';
import { getSlideSummariesPg, isInternalOnly } from '@/features/slide-vault/server/pg-repository';
import { tagsInQuery, withTags } from '@/features/slide-vault/server/tags';
import { taggedFirst } from '@/features/slide-vault/server/services/tagged-first';
import { applyFilters, parseFilters } from '@/features/slide-vault/server/services/search-filters';
import { ignoredWords, parseIgnore, withoutIgnored } from '@/features/slide-vault/server/services/search-ignore';
import { askedOrder, configuredReader, limitFor, looksWrongFor, readerForSearch, searchLibrary } from '@/features/slide-vault/server/services/library-smart-search';

// GET /smart-search?q=&limit=&read=1&ai=off&role=&ignore=&sections=off&filters= (docs/DECISIONS.md FD-16, FD-17, FD-59, FD-79, FD-107)
// One search over sample and uploaded decks. read=1 (sent when the person submits the search)
// lets the configured AI reader read a sentence or question; otherwise, and for basic searches,
// the rules do. ai=off (the "Deeper AI search" checkbox unticked) keeps the AI reader out of this one
// search; aiAvailable tells the screen whether to offer the checkbox at all. ignore=case studies|2024 (the words behind a chip the person
// crossed out) reads the request as if those words were not there (they are searched as plain words only when nothing else is left).
// sections=off: the words ask for no section. filters=<json>: the filters the person ticked, applied here over a larger pool of what the
// words found, so they search the whole library and not only the first slides (response: facets, the counts for the filter lists). Each result says why it fits; near-identical slides are grouped.
// Response: { query, reader, readerNote, plan, chips, relaxed, items: [{ slide, why, matched }] }
export async function GET(request: Request) {
  const limited = await rateLimit(request, RATE_POLICIES.smartSearch);
  if (limited) return limited;
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  if (!query) return fail(400, 'BAD_REQUEST', 'Type what you are looking for in q.');
  if (query.length > 500) return fail(400, 'BAD_REQUEST', 'Keep the search under 500 characters.');
  const asked = Number(url.searchParams.get('limit') ?? 24);
  if (!Number.isInteger(asked) || asked < 1 || asked > 100) return fail(400, 'BAD_REQUEST', 'limit must be a whole number from 1 to 100.');
  // "Every map", "all our offices": a request for all of something gets every match, up to the cap (FD-87).
  const limit = limitFor(query, asked);
  // Chips the person crossed out: their words stay in the search, only the reading of them is off (FD-107).
  const ignore = parseIgnore(url.searchParams.get('ignore'));
  const readQuery = withoutIgnored(query, ignore);
  // What the rest of the search (meaning, people's tags) reads: the words minus the ones whose reading is off.
  const searchText = readQuery || query;
  const noSections = url.searchParams.get('sections') === 'off';
  const filters = parseFilters(url.searchParams.get('filters'));
  // With filters ticked the words find a larger pool first, then the filters narrow it and the first `limit` slides are sent.
  const poolLimit = filters ? Math.min(limit * 4, 400) : limit;

  // A provider that is named but misconfigured is a setup error, not a reason to quietly use another.
  let reader: PlanReader | null;
  try {
    reader = configuredReader();
  } catch (e) {
    console.error('AI search is misconfigured:', (e as Error).message);
    return fail(500, 'LIBRARY_NOT_READY', 'Search is not set up correctly on the server.');
  }

  try {
    // AI calls inside are logged against this person (FD-91).
    const result = await asPerson(userOf(request), () => searchLibrary(query, poolLimit, { readQuery, noSections, alsoWords: readQuery ? [] : ignoredWords(ignore), reader: readerForSearch(reader, url.searchParams.get('ai')), read: url.searchParams.get('read') === '1', force: url.searchParams.get('ai') === 'always', by: roleOf(url.searchParams.get('role')), includeHidden: url.searchParams.get('hidden') === 'include' }));
    // Hidden-in-source slides (usually internal notes) only when asked for (FD-50).
    // ...and so are slides the team marked "internal - never show" (FD-53).
    if (url.searchParams.get('hidden') !== 'include') result.items = result.items.filter((i) => !i.slide.hiddenInSource && !isInternalOnly(i.slide));
    // Meaning search (FD-55, FD-95): when the person submits a search, the slides closest in meaning are
    // merged into the ranking with the word matches (reciprocal rank fusion), inside the search's filters.
    // A named thing ("Toronto"), a section, or a look ("map", "org chart", FD-86) keeps the word order, with
    // meaning only added after, and never a slide known to look otherwise.
    if (url.searchParams.get('read') === '1') {
      // When the AI read the request, its one-line reading of what is wanted joins the typed words, so the
      // meaning match follows what the person meant, not only how they put it (FD-95).
      const summary = result.reader === 'model' ? result.plan.summary?.trim() : '';
      const meaning = await meaningSearch(summary ? `${searchText}. ${summary}` : searchText, poolLimit);
      if (meaning?.items.length) {
        const hide = url.searchParams.get('hidden') !== 'include';
        const wrongLook = await looksWrongFor(readQuery);
        result.items = blendByMeaning(result.items, meaning.items, {
          limit: poolLimit,
          minSimilarity: Number(process.env.SV_MEANING_MIN_SIMILARITY || 0.55),
          filters: result.relaxed ? {} : result.plan,
          strict: (result.plan.named?.length ?? 0) > 0 || isSectionSearch(query) || searchIntent(readQuery).looks.length > 0,
          keep: (s) => !wrongLook(s.id) && (!hide || (!s.hiddenInSource && !isInternalOnly(s))),
        });
      }
    }
    // People's own tags lead (FD-58): "Priya" finds the page someone tagged Priya. Off without a database.
    if (hasMmoserConfig()) {
      const hits = await tagsInQuery(searchText);
      const hide = url.searchParams.get('hidden') !== 'include';
      result.items = (await taggedFirst(searchText, result.items, hits, getSlideSummariesPg)).filter((i) => !hide || (!i.slide.hiddenInSource && !isInternalOnly(i.slide))).slice(0, poolLimit);
    }
    // The order the request asked for holds over meaning and tag results too ("most recent", "most liked", FD-87).
    result.items = await askedOrder(readQuery, result.items);
    // The ticked filters narrow the pool (any value within a filter, all filters together); the lists' counts come from the pool (FD-107).
    let facets;
    if (filters) {
      const applied = applyFilters(result.items, filters);
      facets = applied.facets;
      result.items = applied.kept.slice(0, limit);
    }
    // Each slide in a pack carries the whole pack (FD-38, FD-52).
    const packed = await withTags(await withPacks(result.items.map((i) => i.slide)));
    result.items = result.items.map((i, n) => ({ ...i, slide: packed[n] }));
    return ok({ ...result, ...(facets ? { facets } : {}), aiAvailable: reader !== null });
  } catch (e) {
    console.error('Smart search failed', e);
    return fail(503, 'LIBRARY_NOT_READY', 'Search is unavailable right now. Please try again.', true);
  }
}

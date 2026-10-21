import 'server-only';
import { cachedReader, readAiConfig, readerFromConfig, type PlanReader } from '../ai/reader';
import { groupDuplicates, type SlideText } from '../duplicates';
import { hasMmoserConfig } from '../config';
import { loadLibraryIndex } from '../library-repository';
import { listFilterValuesPg, listSlideTextsPg, smartSearchPg } from '../pg-repository';
import { withDownloadCounts } from '../user-data';
import { fixtureSlideTexts, withDuplicateBadges } from './duplicate-badges';
import { fixtureFilterValues, smartSearchFixtures } from './fixture-smart-search';
import { smartSearch, type SmartSearchResponse } from './smart-search';

/**
 * Quick AI search over the whole library (docs/DECISIONS.md FD-16, FD-17): uploaded decks in
 * Postgres plus the sample decks, grouped like GET /search ("also in N decks").
 */

// One cached reader per configuration, so a repeated question doesn't call the model again.
let readerCache: { key: string; reader: PlanReader | null } | null = null;

/** The configured reader, cached. Throws when a provider is named but not fully set up. */
export function configuredReader(): PlanReader | null {
  const config = readAiConfig();
  const key = JSON.stringify(config);
  if (readerCache?.key !== key) {
    const reader = readerFromConfig(config);
    readerCache = { key, reader: reader && cachedReader(reader) };
  }
  return readerCache.reader;
}

/**
 * Uploaded decks live in Postgres. A checkout without database settings searches the sample decks
 * only, quietly; a configured database that fails is logged, and search carries on without it.
 */
async function orWithoutDb<T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> {
  if (!hasMmoserConfig()) return fallback;
  try {
    return await run();
  } catch (e) {
    console.error(`Postgres ${what} unavailable, using sample decks only`, e);
    return fallback;
  }
}

export async function searchLibrary(query: string, limit: number, opts: { reader: PlanReader | null; read: boolean }): Promise<SmartSearchResponse> {
  const index = await loadLibraryIndex();
  const result = await smartSearch(
    query,
    limit,
    {
      context: async () => {
        const db = await orWithoutDb('filter values', listFilterValuesPg, { clients: [], categories: [] });
        const fx = fixtureFilterValues(index);
        return {
          clients: [...new Set([...db.clients, ...fx.clients])].sort(),
          categories: [...new Set([...db.categories, ...fx.categories])].sort(),
        };
      },
      reader: opts.reader,
      search: async (plan, max) => [...(await orWithoutDb('search', () => smartSearchPg(plan, max), [])), ...smartSearchFixtures(index, plan, max)].slice(0, max),
      log: (m) => console.warn(m),
    },
    { read: opts.read },
  );

  const texts: SlideText[] = [...fixtureSlideTexts(index), ...(await orWithoutDb('slide text', listSlideTextsPg, [] as SlideText[]))];
  const slideDeck = new Map(texts.map((t) => [t.id, t.sourceId]));
  const badged = withDuplicateBadges(result.items.map((i) => i.slide), groupDuplicates(texts), slideDeck);
  // Real "Most downloaded" counts (FD-18); left off when there's no database.
  const counted = await withDownloadCounts(badged, (e) => console.error('Download counts unavailable', e));
  const byId = new Map(result.items.map((i) => [i.slide.id, i]));
  return { ...result, items: counted.map((slide) => ({ ...byId.get(slide.id)!, slide })) };
}

import 'server-only';
import { cachedReader, readAiConfig, readerFromConfig, type PlanReader } from '../ai/reader';
import type { SearchPlan } from '../ai/search-plan';
import { openAiCompatibleDeckFactsReader, type DeckFactsReader } from '../ai/deck-facts';
import { openAiCompatibleStoryReader, type StoryReader } from '../ai/storyboard';
import { groupDuplicates, type SlideText } from '../duplicates';
import { hasMmoserConfig } from '../config';
import { loadLibraryIndex } from '../library-repository';
import { listFilterValuesPg, listSlideTextsPg, smartSearchPg } from '../pg-repository';
import { withDownloadCounts } from '../user-data';
import { fixtureSlideTexts, withDuplicateBadges } from './duplicate-badges';
import { fixtureFilterValues, fixtureRowsWhere, smartSearchFixtures } from './fixture-smart-search';
import { loadSlideReadings } from '../slide-knowledge';
import { smartSearch, type SmartSearchResponse } from './smart-search';
import { buildStoryboard, type StoryboardResponse } from './storyboard';
import { suggestDeckFacts, type DeckSuggestionResult } from './suggest-deck';
import { learnedForTopics } from '../story-feedback';
import type { StoryUserRole } from '../../contracts/dto';

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

/** The configured storyboard reader, or null for the standard story order. Throws when misconfigured. */
export function configuredStoryReader(env: Record<string, string | undefined> = process.env): StoryReader | null {
  const config = readAiConfig(env);
  if (config.provider === 'none') return null;
  // Building a whole story is a bigger job than reading a search, and people expect it to take a
  // moment, so it gets its own, longer limit (SV_AI_STORY_TIMEOUT_MS, default 90 seconds).
  const storyMs = Number(env.SV_AI_STORY_TIMEOUT_MS || 90000);
  if (!Number.isInteger(storyMs) || storyMs < 1000 || storyMs > 300000) throw new Error('SV_AI_STORY_TIMEOUT_MS must be a whole number from 1000 to 300000.');
  return openAiCompatibleStoryReader({ ...config, timeoutMs: Math.max(config.timeoutMs, storyMs) });
}

/** A client situation turned into a story of slides from the whole library (FD-22). */
export async function storyboardLibrary(situation: string, opts: { reader: StoryReader | null; read: boolean; answers?: string; role?: StoryUserRole | null }): Promise<StoryboardResponse> {
  const index = await loadLibraryIndex();
  const search = async (plan: SearchPlan, max: number) =>
    [...(await orWithoutDb('search', () => smartSearchPg(plan, max), [])), ...smartSearchFixtures(index, plan, max)].slice(0, max);
  // What the local model read on each slide (FD-26), when the scan has been run on this library.
  const readings = await loadSlideReadings();
  const knowledge = readings.size
    ? { of: (id: string) => readings.get(id), forPart: async (role: string, limit: number) => fixtureRowsWhere(index, (id) => readings.get(id)?.role === role, limit) }
    : undefined;
  const result = await buildStoryboard(situation, { reader: opts.reader, search, learned: learnedForTopics, knowledge, log: (m) => console.warn(m) }, { read: opts.read, answers: opts.answers, role: opts.role ?? null });
  const all = result.sections.flatMap((s) => s.items.map((i) => i.slide));
  const counted = new Map((await withDownloadCounts(all, (e) => console.error('Download counts unavailable', e))).map((s) => [s.id, s]));
  return { ...result, sections: result.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, slide: counted.get(i.slide.id) ?? i.slide })) })) };
}

/** The configured deck-facts reader (FD-23), or null when no AI provider is set up. */
export function configuredDeckFactsReader(env: Record<string, string | undefined> = process.env): DeckFactsReader | null {
  const config = readAiConfig(env);
  return config.provider === 'none' ? null : openAiCompatibleDeckFactsReader(config);
}

/** Suggested deck facts for a file about to be uploaded, checked against the library's categories (FD-23). */
export async function suggestUploadFacts(fileName: string, bytes: Uint8Array, opts: { reader: DeckFactsReader | null; read: boolean; folderPath: string | null }): Promise<DeckSuggestionResult> {
  const db = await orWithoutDb('filter values', listFilterValuesPg, { clients: [], categories: [] });
  const categories = [...new Set([...db.categories, ...fixtureFilterValues(await loadLibraryIndex()).categories])].sort();
  return suggestDeckFacts(fileName, bytes, { reader: opts.reader, categories, log: (m) => console.warn(m) }, { folderPath: opts.folderPath, read: opts.read });
}

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
import { fixtureFilterValues, fixtureRowsWhere, smartSearchFixtures, type SearchKnowledge } from './fixture-smart-search';
import { answersIntent, asksForAnything, intentScore, intentWhy, knownFromStory, searchIntent } from './slide-intent';
import { loadSlideReadings } from '../slide-knowledge';
import { smartSearch, type SmartSearchResponse } from './smart-search';
import { buildStoryboard, type StoryboardResponse } from './storyboard';
import { deckFacts } from './search';
import { deckRequest } from '../ai/deck-request';
import { suggestDeckFacts, type DeckSuggestionResult } from './suggest-deck';
import { learnedForTopics } from '../story-feedback';
import type { SlideSummary, StoryUserRole } from '../../contracts/dto';

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
  // What the search asks for beyond its words (FD-33): a kind of slide, a sector, a theme, matched
  // against the reviewed metadata and the local model's reading of each slide.
  const readings = await loadSlideReadings();
  const intent = searchIntent(query);
  const known: SearchKnowledge | undefined = readings.size
    ? {
        about: (id) => { const k = readings.get(id); return k ? `${k.about} ${k.topics.join(' ')}` : ''; },
        boost: (id) => intentScore(intent, readings.get(id)),
        answers: (id) => asksForAnything(intent) && answersIntent(intent, readings.get(id)),
      }
    : undefined;
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
      // The real decks are searched with what's known about each slide too: kind, sector, theme (FD-56).
      search: async (plan, max) => [...(await orWithoutDb('search', () => smartSearchPg(plan, max, intent), [])), ...smartSearchFixtures(index, plan, max, known)].slice(0, max),
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
  // Say what each slide is in the search's terms, ahead of the words it matched.
  const said = (id: string, why: string) => {
    // What the local files know (sample decks), else what the database knows (real decks, FD-56).
    const kind = intentWhy(intent, readings.get(id) ?? knownFromStory(byId.get(id)!.slide));
    return kind ? `${kind} ${why}`.trim() : why;
  };
  return { ...result, items: counted.map((slide) => { const item = byId.get(slide.id)!; return { ...item, slide, why: said(slide.id, item.why) }; }) };
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
export async function storyboardLibrary(situation: string, opts: { reader: StoryReader | null; read: boolean; answers?: string; role?: StoryUserRole | null; mode?: 'retrieve' | 'reimagine' | 'build' }): Promise<StoryboardResponse> {
  const index = await loadLibraryIndex();
  // An existing deck asked for by name (FD-31): open it as saved, or retell it with all its slides.
  const decks = (index?.sources ?? []).map((src) => {
    const f = deckFacts(src);
    return { id: src.id, title: f.title, fileName: src.fileName, clientName: f.clientName, year: f.deckYear, category: f.category, location: f.location, versionId: src.versionId, slideCount: src.slides.length };
  });
  const asked = deckRequest(situation, decks, opts.mode);
  if (asked.mode === 'missing') {
    const what = asked.name ? `No ${asked.name} deck` : `No decks from ${asked.years.join(' or ')}`;
    return { reader: 'rules', readerNote: null, summary: '', questions: [], sections: [], topics: [], role: opts.role ?? null, title: `${what} in the library`, thesis: '', close: '', beats: [], composer: 'rules', considered: 0, mode: 'retrieve', missing: { name: asked.name, years: asked.years } };
  }
  const named = asked.mode === 'build' ? null : { id: asked.deck.id, title: asked.deck.title, slideCount: asked.deck.slideCount };
  if (asked.mode === 'retrieve' && named) {
    return { reader: 'rules', readerNote: null, summary: '', questions: [], sections: [], topics: [], role: opts.role ?? null, title: named.title, thesis: '', close: '', beats: [], composer: 'rules', considered: 0, mode: 'retrieve', deck: named };
  }
  const sourceIds = new Set(asked.mode === 'reimagine' ? (index?.sources.find((x) => x.id === asked.deck.id)?.slides.map((x) => x.id) ?? []) : []);
  const source = named && sourceIds.size ? { deck: named, rows: fixtureRowsWhere(index, (id) => sourceIds.has(id), sourceIds.size) } : undefined;
  // A new story about clients we already have decks for: those decks are context for it.
  const theirIds = new Set(asked.mode === 'build' ? asked.context.flatMap((d) => index?.sources.find((x) => x.id === d.id)?.slides.map((x) => x.id) ?? []) : []);
  const context = asked.mode === 'build' && theirIds.size ? { decks: asked.context.map((d) => ({ id: d.id, title: d.title })), rows: fixtureRowsWhere(index, (id) => theirIds.has(id), theirIds.size) } : undefined;
  // What the local model read on each slide (FD-26), when the scan has been run on this library.
  const readings = await loadSlideReadings();
  // The brief's words are searched in what was read on each slide too, as home search does (FD-33):
  // a slide that says "builders" can answer a brief about the people who built an app.
  const readText: SearchKnowledge | undefined = readings.size
    ? { about: (id) => { const k = readings.get(id); return k ? `${k.about} ${k.topics.join(' ')}` : ''; }, boost: () => 0, answers: () => false }
    : undefined;
  const search = async (plan: SearchPlan, max: number) =>
    [...(await orWithoutDb('search', () => smartSearchPg(plan, max), [])), ...smartSearchFixtures(index, plan, max, readText)].slice(0, max);
  const knowledge = readings.size
    ? { of: (id: string) => readings.get(id), forPart: async (role: string, limit: number, first?: (id: string) => boolean) => {
          const inPart = (id: string) => readings.get(id)?.role === role;
          const lead = first ? fixtureRowsWhere(index, (id) => inPart(id) && first(id), limit) : [];
          return [...lead, ...fixtureRowsWhere(index, (id) => inPart(id) && !lead.some((r) => r.summary.id === id), limit - lead.length)];
        } }
    : undefined;
  // Retelling a deck: what the deck is ("RFP, HQ relocation/renovation") tells the rest of the
  // library what a missing part should be about, when the request is only "the story of Moody's".
  const brief = source ? `${situation}\n${source.deck.title.replace(/ · /g, ', ')}` : situation;
  const result = await buildStoryboard(brief, { reader: opts.reader, search, learned: learnedForTopics, knowledge, source, context, log: (m) => console.warn(m) }, { read: opts.read, answers: opts.answers, role: opts.role ?? null });
  const all = [...result.sections.flatMap((s) => s.items.map((i) => i.slide)), ...result.beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide))];
  const counted = new Map((await withDownloadCounts(all, (e) => console.error('Download counts unavailable', e))).map((s) => [s.id, s]));
  const withCounts = <T extends { slide: SlideSummary }>(i: T): T => ({ ...i, slide: counted.get(i.slide.id) ?? i.slide });
  return {
    ...result,
    sections: result.sections.map((s) => ({ ...s, items: s.items.map(withCounts) })),
    beats: result.beats.map((b) => ({ ...b, lead: withCounts(b.lead), more: b.more.map(withCounts) })),
  };
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

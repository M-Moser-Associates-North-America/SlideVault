import 'server-only';
import { cachedReader, readAiConfig, readerFromConfig, type PlanReader } from '../ai/reader';
import { aiPicks, labelMenu, mergeLabels } from '../ai/label-menu';
import type { SearchPlan } from '../ai/search-plan';
import { openAiCompatibleDeckFactsReader, type DeckFactsReader } from '../ai/deck-facts';
import { cleanDeckTags, openAiCompatibleDeckTagsReader, slidesForTags, type DeckTagsReader, type UploadTagSuggestions } from '../ai/deck-tags';
import { extractSlides } from '../../../../workers/slide-vault/processors/extract-text';
import { openAiCompatibleStoryReader, type StoryReader } from '../ai/storyboard';
import { groupDuplicates, type SlideText } from '../duplicates';
import { hasMmoserConfig } from '../config';
import { loadLibraryIndex } from '../library-repository';
import { getSlideSummariesPg, listFilterValuesPg, listSlideTextsPg, smartSearchPg } from '../pg-repository';
import { tagsInQuery } from '../tags';
import { typedTags } from './tagged-first';
import { withDownloadCounts } from '../user-data';
import { fixtureSlideTexts, withDuplicateBadges } from './duplicate-badges';
import { fixtureFilterValues, fixtureRowsWhere, smartSearchFixtures, type SearchKnowledge } from './fixture-smart-search';
import { answersIntent, asksForAnything, intentScore, intentWhy, knownFromStory, searchIntent } from './slide-intent';
import { loadSlideReadings } from '../slide-knowledge';
import { mentionsWord, smartSearch, type SmartSearchResponse } from './smart-search';
import { buildStoryboard, clientSectors, keptOutOfStories, SECTOR_NAMES, type StoryboardResponse } from './storyboard';
import { deckFacts } from './search';
import { deckRequest } from '../ai/deck-request';
import { familiesOf } from './families';
import { askedSections, asksForCover, asksForSections, isSectionSearch, librarySections, sectionMembers, sectionWhy, type SlideSection } from './sections';
import { findSlide } from '../library-repository';
import { toSummary } from './search';
import { refineStory } from './story-refine';
import type { StoryBeat, StoryRefineRequest, StoryRefineResult, StoryboardSlide } from '../../contracts/dto';
import { suggestDeckFacts, type DeckSuggestionResult } from './suggest-deck';
import { learnedForTopics } from '../story-feedback';
import { learnedScore, searchLearning, sinks, type SearchLearned } from '../search-feedback';
import { isInternalOnly, listDeckSlidesPg, type DeckSlidesPg } from '../pg-repository';
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
 * The "Deeper AI search" checkbox (FD-79): ai=off skips the AI reader for one search, so the rules
 * read it, as they do with no AI set up. Meaning search and everything else run as usual. Only the
 * person can turn the AI off; ai=on can never turn on a reader the server doesn't have.
 */
export const readerForSearch = (reader: PlanReader | null, ai: string | null): PlanReader | null => (ai === 'off' ? null : reader);

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

/**
 * The uploaded decks' slides in order, for deck sections and named words (FD-57, FD-56), read at
 * most once a minute. None without database settings, so a checkout without them is unchanged.
 */
const NO_UPLOADS: { sources: DeckSlidesPg[] } = { sources: [] };
let uploads: { at: number; library: { sources: DeckSlidesPg[] } } | null = null;
async function uploadedDecks(): Promise<{ sources: DeckSlidesPg[] }> {
  if (!hasMmoserConfig()) return NO_UPLOADS;
  if (uploads && Date.now() - uploads.at < 60_000) return uploads.library;
  const sources = await orWithoutDb('deck slides', listDeckSlidesPg, [] as DeckSlidesPg[]);
  uploads = { at: Date.now(), library: sources.length ? { sources } : NO_UPLOADS };
  return uploads.library;
}
const currentUploads = () => uploads?.library ?? NO_UPLOADS;

/** Worked out once per sample-library load and uploaded-decks read. */
function onceFor<T>(cache: WeakMap<object, { uploads: object; value: T }>, key: object, make: () => T): T {
  const have = cache.get(key);
  if (have && have.uploads === currentUploads()) return have.value;
  const value = make();
  cache.set(key, { uploads: currentUploads(), value });
  return value;
}

/** Share of the library's slides whose title or text mentions a word, counted once per library load. */
const shares = new WeakMap<object, { uploads: object; value: Map<string, number> }>();
function wordShare(index: Awaited<ReturnType<typeof loadLibraryIndex>>, word: string): number {
  // Where each deck was made counts too: "Toronto" is named when the library has a Toronto deck,
  // even if no slide prints the word (31 Oct).
  const all: { slides: { title: string; text: string }[]; where: string | null }[] = [
    ...(index?.sources ?? []).map((s) => ({ slides: s.slides, where: deckFacts(s).location })),
    ...currentUploads().sources.map((d) => ({ slides: d.slides, where: d.location })),
  ];
  if (!all.length) return 1;
  const seen = onceFor(shares, index ?? NO_UPLOADS, () => new Map<string, number>());
  const cached = seen.get(word);
  if (cached !== undefined) return cached;
  const slides = all.flatMap((d) => d.slides.map((s) => `${s.title} ${s.text} ${d.where ?? ''}`));
  const share = slides.length ? slides.filter((s) => mentionsWord(s, word)).length / slides.length : 1;
  seen.set(word, share);
  return share;
}

/**
 * A light lean by how the person builds proposals (FD-59), in the words of each role (client/role-store):
 * a director's stories "lean on why M Moser, value"; a business developer's "lead with the client's
 * challenge and what we've learned"; BD support wants "one specific slide quickly" (survey), so no lean.
 * Small next to a named thing or a section, so it only reorders close calls.
 */
const LEAN: Partial<Record<StoryUserRole, { roles: string[]; types: string[] }>> = {
  director: { roles: ['why-us', 'outcome'], types: ['firm_profile', 'differentiator', 'fees_commercial'] },
  'business-developer': { roles: ['client-challenge', 'insight', 'experience'], types: ['case_study_detail', 'case_study_hero', 'client_understanding'] },
};
function roleLean(by: StoryUserRole | null, k: { role?: string; type?: string } | undefined): number {
  const lean = by ? LEAN[by] : undefined;
  if (!lean || !k) return 0;
  return (k.type && lean.types.includes(k.type)) || (k.role && lean.roles.includes(k.role)) ? 1.5 : 0;
}

/** Single words the library knows as names: clients, places, sectors, themes and projects. */
const names = new WeakMap<object, { uploads: object; value: Set<string> }>();
function knownNames(index: Awaited<ReturnType<typeof loadLibraryIndex>>, readings: Awaited<ReturnType<typeof loadSlideReadings>>): Set<string> {
  return onceFor(names, index ?? readings, () => {
    const out = new Set<string>();
    const add = (s?: string | null) => s?.toLowerCase().split(/[^a-z0-9]+/).forEach((w) => w.length >= 3 && out.add(w));
    for (const src of index?.sources ?? []) { const f = deckFacts(src); add(f.clientName); add(f.location); }
    // Uploaded decks name their client ("Unknown client" adds nothing new: both words are common).
    for (const deck of currentUploads().sources) {
      if (deck.client !== 'Unknown client') add(deck.client);
      add(deck.location);
    }
    for (const r of readings.values()) { r.sectors?.forEach(add); r.themes?.forEach(add); r.projects?.forEach(add); add(r.clientSector); }
    return out;
  });
}

/**
 * A database slide type counts for sections only when it uses the scan's names ("section_divider",
 * "team_resume"); any other wording would hide a divider, so it's left to the slide's own words.
 */
const scanTypes = new WeakMap<object, Set<string>>();
function typesFromScan(readings: Awaited<ReturnType<typeof loadSlideReadings>>): Set<string> {
  let have = scanTypes.get(readings);
  if (!have) scanTypes.set(readings, (have = new Set([...readings.values()].map((r) => r.type).filter((t): t is string => !!t))));
  return have;
}

/** Each slide's section, sample decks and uploaded decks (FD-57). */
const allSections = new WeakMap<object, { uploads: object; value: Map<string, SlideSection> }>();
function sectionsOf(index: Awaited<ReturnType<typeof loadLibraryIndex>>, readings: Awaited<ReturnType<typeof loadSlideReadings>>): Map<string, SlideSection> {
  return onceFor(allSections, index ?? readings, () => {
    const known = typesFromScan(readings);
    const dbType = new Map(currentUploads().sources.flatMap((d) => d.slides.map((s) => [s.id, s.type] as const)));
    const typeOf = (id: string) => readings.get(id)?.type ?? (known.has(dbType.get(id) ?? '') ? dbType.get(id)! : undefined);
    return new Map([...librarySections(index, typeOf), ...librarySections(currentUploads(), typeOf)]);
  });
}

export async function searchLibrary(query: string, limit: number, opts: { reader: PlanReader | null; read: boolean; force?: boolean; by?: StoryUserRole | null; includeHidden?: boolean }): Promise<SmartSearchResponse> {
  const index = await loadLibraryIndex();
  // What colleagues marked useful or not relevant for searches with these words (FD-59).
  const learned = await searchLearning(query, opts.by ?? null);
  // What the search asks for beyond its words (FD-33): a kind of slide, a sector, a theme, matched
  // against the reviewed metadata and the local model's reading of each slide.
  const readings = await loadSlideReadings();
  const intent = searchIntent(query);
  // The deck sections a search asks for (FD-57, "page breakers"): "resumes" finds each deck's résumé
  // section, "banner slides in case studies" each case-study section's cover.
  await uploadedDecks();
  const sections = sectionsOf(index, readings);
  const asked = askedSections(query);
  const cover = asksForCover(query);
  const inAsked = (id: string) => { const sec = sections.get(id); return !!sec && sec.kinds.some((k) => asked.includes(k)); };
  const sectionScore = (id: string) => {
    if (!inAsked(id)) return 0;
    const sec = sections.get(id)!;
    // The cover leads when one is asked for; otherwise the section's first pages ("the Priya page and the four after it").
    return 5 + (sec.divider ? (cover ? 12 : 1) : cover ? 0 : Math.max(0, 3 - sec.position) * 0.5);
  };
  const notRelevant = (id: string) => sinks(learned.get(id));
  // What the search asks for in labels: the rules' own reading, plus what the AI adds when it reads the search (FD-83).
  // The AI's picks arrive with the plan, so this is set when the search runs; the rules alone until then.
  let wanted = intent;
  const knownFor = (it: typeof intent): SearchKnowledge => ({
    about: (id) => { const k = readings.get(id); return k ? `${k.about} ${k.topics.join(' ')}` : ''; },
    boost: (id) => intentScore(it, readings.get(id)) + sectionScore(id) + learnedScore(learned.get(id)) + roleLean(opts.by ?? null, readings.get(id)),
    answers: (id) => (asksForAnything(it) && answersIntent(it, readings.get(id))) || inAsked(id),
    // Hidden-in-source and internal-only slides are left out before the limit (FD-50, FD-53): a deck
    // that opens with hidden notes (Ferrous MSA) otherwise fills "ferrous msa" with slides the app then drops.
    skip: (s) => !opts.includeHidden && (s.hiddenInSource || isInternalOnly(s)),
  });
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
          labels: labelMenu(SECTOR_NAMES),
        };
      },
      reader: opts.reader,
      // The real decks are searched with what's known about each slide too: kind, sector, theme (FD-70).
      search: async (plan, max) => {
        wanted = mergeLabels(intent, plan.labels);
        return [...byLearning(await orWithoutDb('search', () => smartSearchPg(plan, max, { ...wanted, ai: aiPicks(plan.labels) }), []), learned), ...smartSearchFixtures(index, plan, max, knownFor(wanted))].slice(0, max);
      },
      howCommon: (word) => wordShare(index, word),
      isKnownName: (word) => knownNames(index, readings).has(word),
      alsoMeans: (word) => clientSectors(word),
      madeIn: (s) => s.provenance.location ?? null,
      rankLast: (s) => (readings.get(s.id)?.type === 'team_resume' && !wanted.types.includes('team_resume')) || notRelevant(s.id),
      // A slide "mentions" Toronto when its deck was made there, and QNBC when the model read it on the slide.
      alsoSays: (s) => { const k = readings.get(s.id); return [k?.about, k?.topics.join(' '), k?.sectors?.join(' '), k?.clientSector, k?.themes?.join(' '), k?.projects?.join(' '), s.provenance.sourceTitle, s.provenance.sourceFileName, s.provenance.location, s.provenance.clientName].filter(Boolean).join(' '); },
      log: (m) => console.warn(m),
    },
    { read: opts.read, force: opts.force },
  );

  // A search for a section shows each deck's section once before the rest (Alina, 28 Oct: "search
  // between different decks for that particular bunch of slides"), led by its first page (Gabby: "the
  // Priya page… those 1, 2, 3, 4 next pages"), or by its cover when a cover is asked for.
  // A search that also asks for a kind of slide ("resumes", "case study") is led by its best slide of that kind.
  if (isSectionSearch(query)) {
    const lead = new Map<string, (typeof result.items)[number]>();
    // Only a narrow kind narrows the lead ("resumes": a résumé, not the team section's org chart). Every page
    // of a firm section is about the firm, so "firm overview" leads with each section's first page, reviewed or not.
    const byKind = intent.types.some((t) => t !== 'firm_profile' && t !== 'differentiator') && !cover;
    for (const item of result.items) {
      const sec = sections.get(item.slide.id);
      if (!sec || !sec.kinds.some((k) => asked.includes(k))) continue;
      // Only a slide of that kind leads ("resumes": a résumé, not the section's org chart).
      if (byKind && !intent.types.includes(readings.get(item.slide.id)?.type ?? '')) continue;
      const have = lead.get(sec.dividerId);
      const rank = (id: string) => { const x = sections.get(id)!; return cover ? (x.divider ? 0 : 1 + x.position) : x.divider ? 1000 : x.position; };
      if (!have || (!byKind && rank(item.slide.id) < rank(have.slide.id))) lead.set(sec.dividerId, item);
    }
    const first = new Set([...lead.values()].map((i) => i.slide.id));
    // Sections named in the search's own words go first ("firm overview": a deck's "Firm profile" before its
    // "About M Moser"), people type what the divider says. Otherwise the search's order stands.
    const said = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const named = (id: string) => { const n = sections.get(id)!.name.toLowerCase(); return said.filter((w) => n.includes(w)).length; };
    const order = result.items.filter((i) => first.has(i.slide.id)).map((i, n) => ({ i, n, hits: named(i.slide.id) })).sort((a, b) => b.hits - a.hits || a.n - b.n).map((x) => x.i);
    result.items = [...order, ...result.items.filter((i) => !first.has(i.slide.id))];
  }

  // Marked not relevant for searches like this more often than useful: shown last (Alina: "I didn't want to see… a director's interview").
  if (learned.size) result.items = [...result.items.filter((i) => !notRelevant(i.slide.id)), ...result.items.filter((i) => notRelevant(i.slide.id))];

  const texts: SlideText[] = [...fixtureSlideTexts(index), ...(await orWithoutDb('slide text', listSlideTextsPg, [] as SlideText[]))];
  const slideDeck = new Map(texts.map((t) => [t.id, t.sourceId]));
  const badged = withDuplicateBadges(result.items.map((i) => i.slide), groupDuplicates(texts), slideDeck);
  // Real "Most downloaded" counts (FD-18); left off when there's no database.
  const counted = await withDownloadCounts(badged, (e) => console.error('Download counts unavailable', e));
  const byId = new Map(result.items.map((i) => [i.slide.id, i]));
  // Say what each slide is in the search's terms, ahead of the words it matched.
  const said = (id: string, why: string) => {
    // What the local files know (sample decks), else what the database knows (real decks, FD-70).
    const kind = intentWhy(wanted, readings.get(id) ?? knownFromStory(byId.get(id)!.slide));
    const where = sectionWhy(sections.get(id), asked, cover);
    return [where, kind, why].filter(Boolean).join(' ').trim();
  };
  const sectionOf = (id: string) => { const sec = sections.get(id); return sec ? { name: sec.name, kind: sec.kind, divider: sec.divider, dividerId: sec.dividerId } : null; };
  return { ...result, sections: asksForSections(query) ? asked : undefined, items: counted.map((slide) => { const item = byId.get(slide.id)!; return { ...item, slide: { ...slide, section: sectionOf(slide.id) }, why: said(slide.id, item.why) }; }) };
}

/** Slide summaries by id for sample-deck and uploaded-deck slides alike (the database's are read in one go). */
async function summariesFor(index: Awaited<ReturnType<typeof loadLibraryIndex>>, ids: string[]): Promise<Map<string, SlideSummary>> {
  const out = new Map<string, SlideSummary>();
  if (index) for (const id of ids) { const found = findSlide(index, id); if (found) out.set(id, toSummary(found.source, found.slide)); }
  const rest = ids.filter((id) => !out.has(id));
  for (const s of rest.length ? await orWithoutDb('section slides', () => getSlideSummariesPg(rest), []) : []) out.set(s.id, s);
  return out;
}

const sectionTag = (sec: SlideSection) => ({ name: sec.name, kind: sec.kind, divider: sec.divider, dividerId: sec.dividerId });
const visibleSlide = (s: SlideSummary, includeHidden: boolean) => includeHidden || (!s.hiddenInSource && !isInternalOnly(s));

/**
 * One deck section in full, in deck order (FD-57, FD-80): every slide from its divider to the next, not
 * only the ones a search matched, so a section can be opened in the preview and added to a draft deck
 * whole. Hidden-in-source and internal-only slides are left out unless asked for, as in search.
 */
export async function sectionSlides(dividerId: string, includeHidden = false): Promise<{ name: string; kind: string; slides: SlideSummary[] } | null> {
  const index = await loadLibraryIndex();
  await uploadedDecks();
  const sections = sectionsOf(index, await loadSlideReadings());
  const members = sectionMembers(sections, dividerId);
  if (!members.length) return null;
  const found = await summariesFor(index, members.map(([id]) => id));
  const slides: SlideSummary[] = [];
  for (const [id, sec] of members) {
    const slide = found.get(id);
    if (slide && visibleSlide(slide, includeHidden)) slides.push({ ...slide, section: sectionTag(sec) });
  }
  return slides.length ? { name: members[0][1].name, kind: members[0][1].kind, slides } : null;
}

/**
 * Every deck's section of one standard kind, for browsing sections without a search (FD-80): the cover
 * (the divider, else the section's first slide), the name and how many slides it has. A section of two
 * kinds ("Firm background / relevant experience") is listed under both. At most MAX_SECTIONS.
 */
const MAX_SECTIONS = 120;
export async function sectionList(kind: string, includeHidden = false): Promise<{ dividerId: string; name: string; kind: string; slideCount: number; cover: SlideSummary }[]> {
  const index = await loadLibraryIndex();
  await uploadedDecks();
  const sections = sectionsOf(index, await loadSlideReadings());
  const byDivider = new Map<string, { sec: SlideSection; coverId: string; at: number; n: number }>();
  for (const [id, sec] of sections) {
    if (!(sec.kinds as string[]).includes(kind)) continue;
    const have = byDivider.get(sec.dividerId);
    if (!have) byDivider.set(sec.dividerId, { sec, coverId: id, at: sec.position, n: 1 });
    else { have.n += 1; if (sec.position < have.at) { have.at = sec.position; have.coverId = id; have.sec = sec; } }
  }
  const picked = [...byDivider.values()].slice(0, MAX_SECTIONS);
  const found = await summariesFor(index, picked.map((p) => p.coverId));
  const out: { dividerId: string; name: string; kind: string; slideCount: number; cover: SlideSummary }[] = [];
  for (const p of picked) {
    const cover = found.get(p.coverId);
    if (cover && visibleSlide(cover, includeHidden)) out.push({ dividerId: p.sec.dividerId, name: p.sec.name, kind: p.sec.kind, slideCount: p.n, cover: { ...cover, section: sectionTag(p.sec) } });
  }
  return out;
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

/**
 * The real decks in the database, re-ranked by what colleagues marked for searches like this one
 * (FD-59, FD-78): marked useful first, sent last by at least two Not relevant clicks (sinks), the
 * database's order kept otherwise; one Not relevant click doesn't move a database result (2 Nov).
 * The sample decks get the same through their boost; without this, the database's results never
 * learned, which is where M Moser's library lives.
 */
/** The learned score a database result needs before it is moved ahead of unrated results. */
export const LIFT = 1;

export function byLearning<T extends { summary: { id: string } }>(rows: T[], learned: Map<string, SearchLearned>): T[] {
  if (!learned.size) return rows;
  /* Last if sunk; ahead of the rest if clearly more useful than not, the more the further ahead; one stray Not relevant keeps its place (the database's order is already a good guess).
     "Clearly" is a score of at least LIFT: one Useful in a mostly-same search (2) lifts a slide, but one in a search that only
     shares some words (under 1) doesn't jump it ahead of every unrated result (3 Nov review: the Nov 2 spreading, coming back
     through partial matches). */
  const place = (l: SearchLearned | undefined) => (sinks(l) ? -1 : learnedScore(l) >= LIFT ? learnedScore(l) : 0);
  return rows.map((r, i) => ({ r, i, s: place(learned.get(r.summary.id)) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
}

/** What search learned (FD-59) for the brief's topics, counted as for a search of those words. */
const storySearchLearning = (topics: string[], role: StoryUserRole | null) => searchLearning(topics.join(' '), role, 'any');

const NO_TAGS = { of: () => undefined, rows: [] };

/**
 * People's own tags (FD-58) named in a brief, as search uses them: "a story for Priya's hospital
 * pitch" finds the slides someone tagged Priya. Off without a database, like search.
 */
async function storyTags(index: Awaited<ReturnType<typeof loadLibraryIndex>>, brief: string) {
  const hits = typedTags(brief, await orWithoutDb('tags', () => tagsInQuery(brief), []));
  if (!hits.length) return NO_TAGS;
  const onSlide = new Map(hits.filter((h) => h.on === 'slide').map((h) => [h.id, h.tag]));
  const onDeck = new Map(hits.filter((h) => h.on === 'deck').map((h) => [h.id, h.tag]));
  const local = fixtureRowsWhere(index, (id) => onSlide.has(id), onSlide.size);
  const missing = [...onSlide.keys()].filter((id) => !local.some((r) => r.summary.id === id));
  const fromDb = missing.length ? await orWithoutDb('tagged slides', () => getSlideSummariesPg(missing), []) : [];
  const rows = [
    ...local,
    // Uploaded slides: their title is what's known here; what the scan read on them comes through knowledge.
    ...fromDb.map((summary) => ({ summary, facts: { title: summary.title, text: '', client: null, year: null, category: null, bestOfTheBest: false } })),
  ].filter((r) => !keptOutOfStories(r.summary));
  return { of: (slideId: string, deckId: string) => onSlide.get(slideId) ?? onDeck.get(deckId), rows };
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
  // Slides that belong together (FD-42), for a story one family clearly answers.
  const familyOf = familiesOf(index);
  const families = {
    of: (id: string) => familyOf.get(id),
    rows: async (f: { slideIds: string[] }) => {
      const at = new Map(f.slideIds.map((id, i) => [id, i]));
      return fixtureRowsWhere(index, (id) => at.has(id), f.slideIds.length).sort((a, b) => at.get(a.summary.id)! - at.get(b.summary.id)!);
    },
  };
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
  // library what a missing part should be about, when the request is only "the story of Barlow's".
  // The page breakers search found (FD-57) split a retold deck where the deck itself does.
  await uploadedDecks();
  const sections = sectionsOf(index, readings);
  const isDivider = (id: string) => sections.get(id)?.dividerId === id;
  const sectionOf = (id: string) => { const x = sections.get(id); return x && { key: x.dividerId, name: x.name, kind: /\bappendix\b/i.test(x.name) ? 'appendix' : x.kind }; };
  const brief = source ? `${situation}\n${source.deck.title.replace(/ · /g, ', ')}` : situation;
  const result = await buildStoryboard(brief, { reader: opts.reader, search, learned: learnedForTopics, searchLearned: storySearchLearning, tagged: (text) => storyTags(index, text), isDivider, sectionOf, knowledge, source, context, families, log: (m) => console.warn(m) }, { read: opts.read, answers: opts.answers, role: opts.role ?? null });
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

/** The AI that suggests tags for an upload (FD-85); null when no AI is set up. A bad setting throws, as for the other readers. */
export function configuredDeckTagsReader(env: Record<string, string | undefined> = process.env): DeckTagsReader | null {
  const config = readAiConfig(env);
  return config.provider === 'none' ? null : openAiCompatibleDeckTagsReader(config);
}

/**
 * Deck and slide tags the AI reads from a file about to be uploaded (FD-85). Null when it can't: the person still
 * has the details and the tags suggested from similar slides. Nothing is stored.
 */
export async function suggestUploadTags(fileName: string, bytes: Uint8Array, opts: { reader: DeckTagsReader | null; clientName?: string | null }): Promise<UploadTagSuggestions | null> {
  if (!opts.reader) return null;
  try {
    const slides = slidesForTags(await extractSlides(bytes));
    if (!slides.length) return null;
    const menu = labelMenu(SECTOR_NAMES);
    const answer = await opts.reader.read({ fileName, slides, themes: menu.themes, sectors: menu.sectors });
    return cleanDeckTags(answer, { slides, themes: menu.themes, sectors: menu.sectors, clientName: opts.clientName });
  } catch (e) {
    console.warn(`Deck tags reader ${opts.reader.name} unavailable, no AI tags: ${(e as Error).message}`);
    return null;
  }
}

/** Suggested deck facts for a file about to be uploaded, checked against the library's categories (FD-23). */
export async function suggestUploadFacts(fileName: string, bytes: Uint8Array, opts: { reader: DeckFactsReader | null; read: boolean; folderPath: string | null }): Promise<DeckSuggestionResult> {
  const db = await orWithoutDb('filter values', listFilterValuesPg, { clients: [], categories: [] });
  const categories = [...new Set([...db.categories, ...fixtureFilterValues(await loadLibraryIndex()).categories])].sort();
  return suggestDeckFacts(fileName, bytes, { reader: opts.reader, categories, log: (m) => console.warn(m) }, { folderPath: opts.folderPath, read: opts.read });
}

/**
 * One message in a conversation about the story on screen (FD-43). The story continues: Useful slides
 * stay, things asked for are found and added where they belong, things asked away are taken out. A
 * message that asks for none of that is more context: the story is rebuilt with it, Useful slides kept.
 */
export async function refineStoryboard(req: StoryRefineRequest, opts: { reader: StoryReader | null; read: boolean }): Promise<StoryRefineResult> {
  const index = await loadLibraryIndex();
  const readings = await loadSlideReadings();
  const familyOf = familiesOf(index);
  const known = (id: string) => readings.get(id);
  const neverShow = (id: string) => { const k = readings.get(id); return k?.reuse === 'internal - never show' || !!k?.flags?.some((f) => /names another client|leftover/i.test(f)); };
  // Only the ids come from the browser: every slide is read again from the library.
  const ids = [...new Set(req.beats.flatMap((b) => b.slideIds))];
  const rows = new Map(fixtureRowsWhere(index, (id) => ids.includes(id), ids.length).map((r) => [r.summary.id, r]));
  const asSlide = (id: string, why: string): StoryboardSlide | null => { const r = rows.get(id); return r ? { slide: r.summary, why: why.slice(0, 600), matched: [], reasons: { brief: [], part: [], from: [] } } : null; };
  const beats: StoryBeat[] = req.beats
    .map((b): StoryBeat | null => {
      const items = b.slideIds.map((id) => asSlide(id, b.why)).filter((x): x is StoryboardSlide => !!x);
      if (!items.length) return null;
      const cut = (t: string, n: number) => String(t ?? '').slice(0, n);
      return { role: b.role, ...(b.kind ? { kind: b.kind } : {}), title: cut(b.title, 140), bridge: cut(b.bridge, 400), narration: cut(b.narration, 900), why: cut(b.why, 500), matches: (b.matches ?? []).slice(0, 2).map((m) => cut(m, 40)), lead: items[0], more: items.slice(1) };
    })
    .filter((b): b is StoryBeat => !!b);
  const pinned = new Set(req.pinned.filter((id) => ids.includes(id)));
  const tellable = (i: StoryboardSlide) => !keptOutOfStories(i.slide) && !neverShow(i.slide.id);
  const toSlide = (r: { summary: SlideSummary }, why: string): StoryboardSlide => ({ slide: r.summary, why, matched: [], reasons: { brief: [], part: [], from: [] } });

  const result = await refineStory(beats, req.message, pinned, {
    find: async (phrase, limit) => (await searchLibrary(phrase, limit, { reader: null, read: false })).items.map((i) => ({ slide: i.slide, why: i.why, matched: i.matched, reasons: { brief: [], part: [], from: [] } })),
    known: (id) => { const k = known(id); return k && { role: k.role, about: k.about, type: k.type }; },
    familyMates: async (id) => {
      const f = familyOf.get(id);
      if (!f) return [];
      const at = new Map(f.slideIds.map((x, i) => [x, i]));
      return fixtureRowsWhere(index, (x) => at.has(x) && x !== id, f.slideIds.length).sort((a, b) => at.get(a.summary.id)! - at.get(b.summary.id)!).map((r) => toSlide(r, `From the same set: ${f.title}.`));
    },
    tellable,
  });
  if (result.understood) return { reply: result.reply, beats: result.beats };

  // Not a request to change the story: more context about the client. Rebuild with it, keep the Useful slides.
  const story = await storyboardLibrary(req.situation, { reader: opts.reader, read: opts.read, answers: req.message, role: req.role ?? null, mode: 'build' });
  const have = new Set(story.beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id)));
  const back = [...pinned].filter((id) => !have.has(id)).map((id) => asSlide(id, 'You marked this useful.')).filter((x): x is StoryboardSlide => !!x);
  for (const item of back) {
    const role = (known(item.slide.id)?.role ?? 'why-us') as StoryBeat['role'];
    const home = [...story.beats].reverse().find((b) => b.role === role) ?? story.beats[story.beats.length - 1];
    if (home) home.more.push(item);
  }
  const kept = pinned.size ? ` Kept the ${pinned.size} slide${pinned.size === 1 ? '' : 's'} you marked useful.` : '';
  return { reply: `Rebuilt the story with that in mind.${kept}`, story };
}

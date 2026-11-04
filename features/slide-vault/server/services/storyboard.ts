import type { SlideSummary, StoryboardResult, StoryboardSection, StoryboardSlide } from '../../contracts/dto';
import { cleanPlan, MAX_KEYWORDS, whyItFits, type PlanContext, type SearchPlan, type SlideFacts } from '../ai/search-plan';
import { isStopWord } from '../../components/search-rules';
import { missingContext, STORY_ARC, standInStory, type StoryPlan, type StoryReader } from '../ai/storyboard';
import { DEFAULT_SLIDES_PER_PART, ROLE_TUNING } from '../ai/roles';
import { composeStory, weaveDeck } from './story-beats';
import type { StoryRole, StoryUserRole } from '../../contracts/dto';

/**
 * Storyboard (docs/DECISIONS.md FD-22): a client situation in, a story out. Each part of the story
 * gets the best slides that prove it, from any deck, each slide used once, with a reason built from
 * what is on the slide. A part with no slide is flagged as a gap rather than filled with a weak
 * match. The route wires in the configured reader and the library search; tests pass fakes.
 */

export const SLIDES_PER_SECTION = DEFAULT_SLIDES_PER_PART;

/**
 * Up to how many slides each part offers: about 30 in all, weighted the way a proposal is. The
 * approach and the proof carry the most; the firm's own pitch (why us) stays short so it never buries
 * the client's story. A part only fills as far as it has strong slides. A role that wants more
 * options per part (FD-25) gets at least its own number.
 */
export const PART_SLIDES: Record<StoryRole, number> = { 'client-challenge': 4, insight: 3, strategy: 8, experience: 8, 'why-us': 4, outcome: 3 };

const quoted = (words: string[]) => words.map((w) => `“${w}”`).join(', ');

/** How a slide the local model read as doing a part is described in its reason. */
const READ_AS: Record<StoryRole, string> = {
  'client-challenge': "shows the client's challenge",
  insight: 'shares an insight',
  strategy: 'explains the approach',
  experience: "proves we've done this before",
  'why-us': 'shows why M Moser',
  outcome: 'shows what the client gets',
};

export type StoryboardResponse = StoryboardResult;

/** Slides hidden in their deck, and every slide of an archived deck (FD-50), never go in a story. */
export const keptOutOfStories = (slide: SlideSummary) => slide.hiddenInSource || slide.provenance.archived === true;

export type StoryboardDeps = {
  reader?: StoryReader | null;
  search: (plan: SearchPlan, limit: number) => Promise<{ summary: SlideSummary; facts: SlideFacts }[]>;
  log?: (message: string) => void;
  /** What colleagues said about slides per part for briefs with these topics, keyed "role:slideId" (FD-24) */
  learned?: (topics: string[], role: StoryUserRole | null) => Promise<Map<string, { useful: number; notRight: number }>>;
  /**
   * What search has learned (FD-59): Useful / Not relevant on search results for searches that share
   * words with this brief, keyed by slide. Not tied to a part: it says a slide is (or isn't) about
   * these words, never which part of a story it does.
   */
  searchLearned?: (topics: string[], role: StoryUserRole | null) => Promise<Map<string, { useful: number; notRelevant: number }>>;
  /**
   * People's own tags (FD-58) whose words are in the brief: `of` gives the tag on a slide or its deck,
   * `rows` the tagged slides themselves, so a tagged slide can be picked even if no search found it.
   */
  tagged?: (brief: string) => Promise<{ of: (slideId: string, deckId: string) => string | undefined; rows: { summary: SlideSummary; facts: SlideFacts }[] }>;
  /**
   * What the local model read on each slide (FD-26): `of` gives one slide's reading, `forPart` the
   * slides it read as doing that part of a story, so a part can find a slide that never uses its words.
   */
  knowledge?: {
    of: (slideId: string) => { role: string; topics: string[]; about: string; reviewed?: boolean; uncertain?: boolean; reuse?: string; flags?: string[]; sectors?: string[]; type?: string; projects?: string[]; themes?: string[]; pack?: string } | undefined;
    /** `first`, when given, picks which slides come first, so the client's own sector isn't crowded out by library order. */
    forPart: (role: StoryRole, limit: number, first?: (slideId: string) => boolean) => Promise<{ summary: SlideSummary; facts: SlideFacts }[]>;
  };
  /**
   * Reimagine an existing deck (FD-31): its slides in their original order. Every one of them is
   * used: story pages go to their part of the story, the rest follow it as they were. Only a part
   * the deck never covers is filled from other decks, and says so.
   */
  source?: { deck: { id: string; title: string; slideCount: number }; rows: { summary: SlideSummary; facts: SlideFacts }[] };
  /**
   * Build: the decks we already made for clients the brief names (FD-31). What they say about the
   * client (its situation, what we saw, how we'd approach it) leads those parts of the new story.
   */
  context?: { decks: { id: string; title: string }[]; rows: { summary: SlideSummary; facts: SlideFacts }[] };
  /** Families of slides that belong together (FD-42): a slide's family, and a family's slides in its own order */
  /** Page breakers found by the section reader (FD-57), so a retold deck splits where the deck itself does. */
  isDivider?: (slideId: string) => boolean;
  /** The deck's own sections (FD-57): a retold deck keeps each chapter together, under the deck's name for it. */
  sectionOf?: (slideId: string) => { key: string; name: string; kind?: string } | undefined;
  families?: { of: (slideId: string) => { id: string; title: string; slideIds: string[] } | undefined; rows: (family: { id: string; title: string; slideIds: string[] }) => Promise<{ summary: SlideSummary; facts: SlideFacts }[]> };
};

/** How much of the best matches one family must hold to be the story: most of the top 20, and at least 5 */
const FAMILY_TOP = 20;
const FAMILY_SHARE = 0.6;
const FAMILY_MIN = 5;

/** The family that clearly answers a request, if one does (FD-42) */
export function dominantFamily<F extends { id: string; slideIds: string[] }>(rows: { summary: SlideSummary }[], familyOf: (slideId: string) => F | undefined): F | null {
  const top = rows.slice(0, FAMILY_TOP);
  const count = new Map<string, { family: F; n: number }>();
  for (const r of top) {
    const f = familyOf(r.summary.id);
    if (f) count.set(f.id, { family: f, n: (count.get(f.id)?.n ?? 0) + 1 });
  }
  const best = [...count.values()].sort((a, b) => b.n - a.n)[0];
  return best && best.n >= Math.max(FAMILY_MIN, FAMILY_SHARE * top.length) && best.family.slideIds.length >= 3 ? best.family : null;
}

/** The parts of a story about the client, where its own decks lead */
const ABOUT_THE_CLIENT = new Set<StoryRole>(['client-challenge', 'insight', 'strategy']);

/** Pages a proposal needs that aren't story (FD-32): a retold deck keeps them where they were. */
const REQUIRED_PAGES = /^(cover|cover_letter|table_of_contents|section_divider|rfp_worksheet|team_resume|team_time_allocation|fees_commercial|schedule|legal_admin|scope_assumptions|blank_or_placeholder)$/;
/** Parts a reimagined deck fills from elsewhere when it has nothing for them */
const FILL_PER_GAP = 2;

/** Page furniture (covers, contents, dividers, admin pages): never the proof for a part of a story. */
const NOT_PROOF = new Set(['divider', 'admin', 'intro']);

/**
 * Slides that never go into a storyboard, whatever anyone marked (FD-28): internal-only pages, and
 * slides that still name another client (a copy left over from an earlier pitch).
 */
const neverInStory = (k: { reuse?: string; flags?: string[] } | undefined) =>
  k?.reuse === 'internal - never show' || !!k?.flags?.some((f) => /names another client|leftover/i.test(f));

/** Three-letter words that say nothing about a client's need */
const SHORT_FILLER = new Set(['new', 'two', 'six', 'ten', 'his', 'her', 'him', 'she', 'who', 'how', 'why', 'all', 'any', 'can', 'get', 'got', 'let', 'say', 'see', 'use', 'way', 'yet', 'via', 'per', 'out', 'off', 'too', 'now', 'day', 'big']);

/** The situation's own words, searched on their own and used to rank every part. */
const MAX_TOPICS = MAX_KEYWORDS;
/** Words that describe the pitch, not the client's need ("we just won a contract for the client"). */
const SITUATION_FILLER = new Set(['just', 'won', 'win', 'already', 'another', 'client', 'clients', 'firm', 'company', 'wants', 'want', 'would', 'could', 'pitching', 'pitch', 'proposal', 'contract', 'new', 'their', 'they', 'them', 'will', 'also', 'need', 'needs', 'help', 'make', 'work', 'working', 'way', 'ways', 'losing', 'lose', 'own', 'worries', 'worried', 'move', 'moving', 'wants', 'board', 'worri', 'will', 'their', 'pitching', 'group', 'three', 'last', 'year', 'story', 'across', 'tell', 'tells', 'one', 'project', 'site', 'outline', 'face', 'facing', 'concern', 'those', 'these', 'please', 'tell', 'were', 'assigned']);

/**
 * The words in a situation that describe this client's need ("hybrid", "sustainability", "desks"),
 * in the order they were written: no filler, no story words, plurals made singular so "desks"
 * also finds "desk".
 */
export function situationTopics(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9/-]+/)) {
    // Three letters is enough when the word means something ("app", "lab"); filler and stop words never count.
    if (raw.length < 3 || isStopWord(raw) || SITUATION_FILLER.has(raw) || SHORT_FILLER.has(raw)) continue;
    // Plurals made singular: "desks" -> "desk", "studies" -> "study", "campuses" -> "campus"; "process", "analysis" stay.
    const w = raw.length <= 4 ? raw : raw.endsWith('ies') ? `${raw.slice(0, -3)}y` : /(s|x|ch|sh)es$/.test(raw) ? raw.slice(0, -2) : raw.endsWith('s') && !/(ss|us|is)$/.test(raw) ? raw.slice(0, -1) : raw;
    if (!SITUATION_FILLER.has(w) && !out.includes(w)) out.push(w);
  }
  return out.slice(0, MAX_TOPICS);
}

/**
 * The client's sector, read from plain words in the situation, so proof from the same kind of client
 * leads ("hospital" -> healthcare). Matched against the sectors on reviewed slides (FD-28), which
 * start with these names ("healthcare / life sciences"). Rules only, no model.
 */
const SECTOR_WORDS: [string, RegExp][] = [
  ['healthcare', /\b(hospitals?|clinics?|clinical|patients?|health ?care|healthcare|medical|pharma\w*|biotech|life sciences|medtech|nurses?|doctors?)\b/],
  ['financial services', /\b(banks?|banking|financial|insurers?|insurance|asset manag\w+|investment|fintech|wealth)\b/],
  ['legal', /\b(law firms?|legal|lawyers?|attorneys?)\b/],
  // \"Smart building technology\" is a theme, not a sector: only a tech client counts.
  ['technology', /\b((tech|technology) (company|companies|firm|client|group)|software|saas|semiconductors?)\b/],
  ['media', /\b(media|broadcast\w*|publish\w*|newsroom|studios?)\b/],
  ['retail', /\b(retail\w*|consumer brands?|fashion|apparel)\b/],
  ['gaming', /\b(gaming|games|game studio)\b/],
  ['professional services', /\b(consult\w+|accounting|professional services)\b/],
  ['resources', /\b(mining|energy|oil|gas|resources)\b/],
];

/** The sector names the rules know, for the AI's label menu (FD-83). */
export const SECTOR_NAMES = SECTOR_WORDS.map(([name]) => name);

/**
 * The needs a brief can name, each read from the brief's plain words and found on slides by the
 * words decks use for it ("burnt out" in a brief, "wellbeing" on a slide). Every slide in a storyboard
 * must speak to this brief, so a slide that only does a part's job (a résumé as "why us", another
 * sector's case study as proof) never stands in for this client's story (FD-29). Rules only, no
 * model, so it holds when the AI is off.
 */
const NEEDS: { name: string; told: RegExp; finds: RegExp }[] = [
  { name: 'healthcare', told: /\b(hospitals?|clinics?|clinical|patients?|health ?care|medical|nurses?|doctors?|life sciences)\b/, finds: /\b(hospitals?|health ?care|clinics?|clinical|patients?|medical|life sciences?)\b/ },
  { name: 'bringing sites together', told: /\b(merg\w*|combin\w*|campus\w*|consolidat\w*|multi-?site|sites|locations|integrat\w*|acquisitions?)\b/, finds: /\b(campus\w*|multi-?site|consolidat\w*|merg\w*|portfolio|across (all|multiple|three|several) (sites|locations|offices|campuses))\b/ },
  { name: 'staff wellbeing', told: /\b(burn ?out|burnt out|exhaust\w*|stress\w*|morale|well-?being|wellness|retention|turnover|fatigue|attrition)\b/, finds: /\b(burn ?out|well-?being|wellness|stress|mental health|staff experience|employee experience|retention|fatigue|morale)\b/ },
  { name: 'the board', told: /\b(board|stakeholders?|leadership|executives?|c-suite|investors?)\b/, finds: /\b(board|stakeholders?|governance)\b/ },
  { name: 'cost and budget', told: /\b(costs?|overruns?|budgets?|spend\w*|afford\w*|savings?)\b/, finds: /\b(budgets?|overruns?|cost certainty|cost control|cost plan\w*|on budget|on time|value engineering|costs?|savings?)\b/ },
  { name: 'a past project gone wrong', told: /\b(failed|failure|went wrong|delays?|delayed|lost trust|bad experience)\b/, finds: /\b(risk management|de-?risk\w*|certainty|delivered on time|lessons learned)\b/ },
  { name: 'hybrid work', told: /\b(hybrid|remote|return to (the )?office|flexib\w*)\b/, finds: /\b(hybrid|remote|return to (the )?office|flexib\w*|agile working|activity[- ]based)\b/ },
  { name: 'sustainability', told: /\b(sustainab\w*|net zero|carbon|esg|green|leed|well building)\b/, finds: /\b(sustainab\w*|net zero|carbon|esg|leed|well (building|certif\w*))\b/ },
  { name: 'culture and brand', told: /\b(culture|brand\w*|identity|values)\b/, finds: /\b(culture|brand\w*|identity|values)\b/ },
  { name: 'growth', told: /\b(grow\w*|expan\w*|scal\w*|headcount)\b/, finds: /\b(grow\w*|expan\w*|scal\w*|future-?proof\w*)\b/ },
];

/** The needs a brief names, in the order of the list. */
export function briefNeeds(text: string): string[] {
  const t = text.toLowerCase();
  return NEEDS.filter((n) => n.told.test(t)).map((n) => n.name);
}

/** Which of the brief's needs a slide speaks to, from its words and what was read on it. */
function needsMet(needs: string[], text: string): string[] {
  const t = text.toLowerCase();
  return NEEDS.filter((n) => needs.includes(n.name) && n.finds.test(t)).map((n) => n.name);
}

/** The same slide copied into several decks: same title and opening words. */
const sameSlideKey = (f: SlideFacts) => `${f.title} ${f.text}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);

export function clientSectors(text: string): string[] {
  const t = text.toLowerCase();
  return SECTOR_WORDS.filter(([, re]) => re.test(t)).map(([name]) => name);
}

/** No client or category filters in a storyboard: the story decides what each part needs. */
const NO_FILTERS: PlanContext = { clients: [], categories: [], thisYear: new Date().getFullYear() };

export async function buildStoryboard(situation: string, deps: StoryboardDeps, opts: { read?: boolean; answers?: string; role?: StoryUserRole | null } = {}): Promise<StoryboardResponse> {
  // The same engine for everyone; the role only changes what parts look for, how many options they
  // offer and what is worth asking (FD-25).
  const role = opts.role ?? null;
  const tuning = role ? ROLE_TUNING[role] : null;
  const slidesFor = (part: StoryRole) => Math.max(PART_SLIDES[part], tuning?.slidesPerPart ?? 0);
  const text = [situation.trim(), opts.answers?.trim()].filter(Boolean).join('\n\n');
  let plan: StoryPlan;
  let reader: StoryboardResponse['reader'] = 'rules';
  let readerNote: string | null = null;
  if (deps.reader && opts.read) {
    try {
      plan = await deps.reader.plan(text);
      reader = 'model';
    } catch (e) {
      deps.log?.(`Story reader ${deps.reader.name} unavailable, using the standard story: ${(e as Error).message}`);
      readerNote = 'AI reading is unavailable right now, so this storyboard follows the standard story order.';
      plan = standInStory(text);
    }
  } else {
    plan = standInStory(text);
  }
  // Ask only about what the situation doesn't already say (the audience, the real worry, what a win
  // looks like): a model left alone asks about things the brief states plainly. Once the person has
  // answered, don't ask again.
  const missing = missingContext(text).length;
  const roleAsks = (tuning?.asks ?? []).filter((a) => !a.told.test(text)).map((a) => a.ask);
  // The role's own question first: it's the one only this person can answer best.
  const questions = [...roleAsks, ...plan.questions.slice(0, missing)].slice(0, tuning?.maxQuestions ?? missing + roleAsks.length);
  plan = { ...plan, questions: opts.answers?.trim() ? [] : questions };

  // What's specific to this client ("hybrid", "sustainability", "desks") is searched on its own and
  // leads every part; the story words ("approach", "case study") decide which part a slide belongs to.
  const topics = cleanPlan({ keywords: situationTopics(text) }, NO_FILTERS);
  const sectors = clientSectors(text);
  const needs = briefNeeds(text);
  // A wide first cut: in a library of thousands, a slide that answers the brief can sit past the first 60.
  const onTopicRows = topics.keywords.length ? await deps.search(topics, 120) : [];
  // A slide's words plus what the local model read on it, so the brief can match what a slide is
  // about ("a hospital merger") as well as what it literally says.
  const read = (facts: SlideFacts, id: string): SlideFacts => {
    const k = deps.knowledge?.of(id);
    return k ? { ...facts, text: `${facts.text} ${k.about} ${k.topics.join(' ')}` } : facts;
  };
  // A topic on every other slide ("workplace") says little; a rare one ("hybrid") says a lot.
  const slidesWith = new Map(topics.keywords.map((k) => [k, onTopicRows.filter((r) => whyItFits({ ...topics, keywords: [k] }, r.facts).matched.length).length]));
  const weight = (k: string) => 1 / Math.max(1, slidesWith.get(k) ?? 1);

  // The firm's memory: slides marked useful for this part on similar briefs lead, ones marked not
  // right go last. A failure here never stops the storyboard.
  const learned = deps.learned ? await deps.learned(topics.keywords, role).catch((e) => (deps.log?.(`Story feedback unavailable: ${(e as Error).message}`), new Map())) : new Map();
  // What search has learned feeds the story too (FD-59, FD-58): a slide colleagues marked useful when
  // searching these words speaks to the brief, one they marked not relevant stays out unless the
  // storyboard's own votes say otherwise, and a slide someone tagged with a word of the brief leads.
  const searched = deps.searchLearned && topics.keywords.length ? await deps.searchLearned(topics.keywords, role).catch((e) => (deps.log?.(`Search feedback unavailable: ${(e as Error).message}`), new Map())) : new Map();
  const tags = deps.tagged ? await deps.tagged(text).catch((e) => (deps.log?.(`Tags unavailable: ${(e as Error).message}`), null)) : null;
  // A need on few slides ("healthcare") says more than one on most ("cost"), so rarer needs weigh more.
  const needCount = new Map<string, number>();
  const needScore = (met: string[]) => met.reduce((sum, n) => sum + 1 / Math.max(1, needCount.get(n) ?? 1), 0);
  const used = new Set<string>();
  const usedCopies = new Set<string>();
  const contextIds = new Set((deps.context?.rows ?? []).map((r) => r.summary.id));
  const considered = new Set<string>();
  const sections: StoryboardSection[] = [];
  // First every part ranks what could fill it; then each part fills in story order, leaving a slide
  // for a later part when it fits that part better (fees and value belong in the outcome, not in why us).
  const candidates = [];
  for (const section of plan.sections) {
    const perPart = slidesFor(section.role);
    // The role's words go first: the search keeps the first twelve.
    const story = cleanPlan({ keywords: [...(tuning?.words[section.role] ?? []), ...section.words] }, NO_FILTERS);
    const storyRows = story.keywords.length ? await deps.search(story, perPart * 8) : [];
    const ownSector = (id: string) => !!deps.knowledge?.of(id)?.sectors?.some((x) => sectors.some((f) => x.toLowerCase().startsWith(f)));
    const readRows = deps.knowledge ? await deps.knowledge.forPart(section.role, perPart * 8, sectors.length ? ownSector : undefined).catch(() => []) : [];
    const theirRows = ABOUT_THE_CLIENT.has(section.role) ? (deps.context?.rows ?? []) : [];
    const seen = new Set<string>();
    const pool = [...theirRows, ...(tags?.rows ?? []), ...onTopicRows, ...storyRows, ...readRows]
      .filter((row) => !keptOutOfStories(row.summary) && !seen.has(row.summary.id) && seen.add(row.summary.id))
      .map((row, order) => {
        const l = learned.get(`${section.role}:${row.summary.id}`);
        const known = deps.knowledge?.of(row.summary.id);
        const readAs = known?.role;
        const facts = read(row.facts, row.summary.id);
        // Same sector: the reviewed metadata says so, or the slide's own words name the client's sector.
        // Reviewed slides go by their reviewed sectors only; others by their own words.
        const sameSector = (known?.reviewed ? !!known.sectors?.some((x) => sectors.some((f) => x.toLowerCase().startsWith(f))) : SECTOR_WORDS.some(([name, re]) => sectors.includes(name) && re.test(`${facts.title} ${facts.text}`.toLowerCase()))) ? 1 : 0;
        const met = needsMet(needs, `${facts.title} ${facts.text}`);
        const theirs = ABOUT_THE_CLIENT.has(section.role) && contextIds.has(row.summary.id) ? 1 : 0;
        const s = searched.get(row.summary.id);
        const tag = tags?.of(row.summary.id, row.summary.provenance.sourceId);
        return { row, order, l, readAs, known, sameSector, met, theirs, s, tag, ours: tag ? 1 : 0, found: Math.sign((s?.useful ?? 0) - (s?.notRelevant ?? 0)), said: Math.sign((l?.useful ?? 0) - (l?.notRight ?? 0)), onTopic: whyItFits(topics, facts).matched.reduce((sum, k) => sum + weight(k), 0), inPart: whyItFits(story, row.facts).matched.length, readHere: readAs === section.role ? 1 : 0 };
      })
      // A slide must do this part's job: its words say so, it was read that way, or colleagues said
      // it does. A slide whose role is known (reviewed metadata, FD-28, or a confident reading by the
      // local model, FD-26) only fills that part unless colleagues said otherwise, so a team résumé
      // can't stand in for the client's challenge. Uncertain readings fall back to the words.
      // Covers, contents, dividers and admin pages never stand as proof. Among those left, what
      // colleagues found useful leads, then the ones about this client's situation, then the ones
      // read as doing this part.
      .filter((r) => {
        if (neverInStory(r.known)) return false;
        // Reviewed as page furniture (a résumé, an admin page): never a part of the story, whatever the votes.
        if (r.known?.reviewed && NOT_PROOF.has(r.known.role)) return false;
        // Marked not relevant in search for these words: out, unless the storyboard's votes or a tag say otherwise.
        if (r.found < 0 && r.said <= 0 && !r.ours) return false;
        // It must speak to this brief (FD-29): a need the brief names, the client's sector, the
        // brief's own words, or colleagues said so. Doing the part's job alone is not enough.
        if (!(r.said > 0 || r.ours > 0 || r.found > 0 || r.theirs > 0 || r.sameSector > 0 || r.met.length > 0 || r.onTopic > 0 || !topics.keywords.length)) return false;
        if (r.known && (r.known.reviewed || !r.known.uncertain)) return r.readHere > 0 || r.said > 0;
        return (r.inPart > 0 || r.readHere > 0 || r.said > 0) && !(r.readAs && NOT_PROOF.has(r.readAs) && r.said <= 0);
      });
    // Don't pad a part with weak matches (24 Oct, the builders' story): a slide must score near the
    // best in its part on the brief's words, unless it meets a need, is the client's sector or their
    // own deck, or colleagues said it helps here.
    const bestOnTopic = Math.max(0, ...pool.map((r) => r.onTopic));
    const strong = (r: (typeof pool)[number]) => r.said > 0 || r.ours > 0 || r.found > 0 || r.theirs > 0 || r.sameSector > 0 || r.met.length > 0 || r.onTopic >= bestOnTopic * 0.3;
    pool.splice(0, pool.length, ...pool.filter(strong));
    for (const r of pool) considered.add(r.row.summary.id);
    needCount.clear();
    for (const r of pool) for (const n of r.met) needCount.set(n, (needCount.get(n) ?? 0) + 1);
    // In the proof, past work for the same kind of client leads: "have you done this for a hospital?"
    const sectorFirst = section.role === 'experience' ? 1 : 0;
    const ranked = pool.sort((a, b) => b.said - a.said || b.ours - a.ours || b.found - a.found || b.theirs - a.theirs || sectorFirst * (b.sameSector - a.sameSector) || needScore(b.met) - needScore(a.met) || b.sameSector - a.sameSector || b.onTopic - a.onTopic || b.readHere - a.readHere || b.inPart - a.inPart || a.order - b.order);
    candidates.push({ section, perPart, story, ranked });
  }
  const partFit = (r: { inPart: number; readHere: number; said: number }) => r.said * 100 + r.readHere * 10 + r.inPart;
  const bestFit = new Map<string, number>();
  for (const { ranked } of candidates) for (const r of ranked) bestFit.set(r.row.summary.id, Math.max(bestFit.get(r.row.summary.id) ?? -Infinity, partFit(r)));
  for (const { section, perPart, story, ranked } of candidates) {
    const items: StoryboardSlide[] = [];
    const packsHere = new Set<string>();
    for (const r of ranked) {
      const { row, l, readHere, sameSector, met, theirs, s, tag } = r;
      const { summary } = row;
      const facts = read(row.facts, summary.id);
      if (used.has(summary.id) || usedCopies.has(sameSlideKey(row.facts)) || partFit(r) < (bestFit.get(summary.id) ?? -Infinity)) continue;
      // A full part still takes the rest of a pack it has started: slides that only work together stay together.
      const pack = deps.knowledge?.of(summary.id)?.pack;
      if (items.length >= perPart && !(pack && packsHere.has(pack))) continue;
      if (pack) packsHere.add(pack);
      // The reason shows its working, from the slide and its deck only: which of the brief's words
      // are on it (most telling first), what on it does this part's job, and where it comes from.
      const brief = whyItFits(topics, facts).matched.sort((a, b) => weight(b) - weight(a)).slice(0, 3);
      const part = whyItFits(story, row.facts).matched.filter((k) => !brief.includes(k)).slice(0, 2);
      const fit = whyItFits(cleanPlan({ keywords: [...brief, ...story.keywords] }, NO_FILTERS), facts);
      const from = [facts.bestOfTheBest ? 'Best of the Best' : null, facts.category, facts.year ? String(facts.year) : null].filter((x): x is string => !!x);
      const why = [
        theirs ? `From the deck we made for this client: ${row.summary.provenance.sourceTitle}.` : null,
        met.length ? `Speaks to: ${met.join(', ')}.` : null,
        brief.length ? `Matches your brief: ${quoted(brief)}.` : null,
        part.length ? `Does this part's job: ${quoted(part)} on the slide.` : null,
        readHere ? `Read as: ${READ_AS[section.role]}.` : null,
        sameSector ? `Same sector as your client: ${sectors.join(', ')}.` : null,
        from.length ? `Deck: ${from.join(' · ')}.` : null,
        l?.useful ? `Colleagues marked it useful for this part on ${l.useful === 1 ? 'a similar brief' : `${l.useful} similar briefs`}.` : null,
        s?.useful && s.useful > s.notRelevant ? `Colleagues marked it useful when searching for ${s.useful === 1 ? 'these words' : `these words (${s.useful} times)`}.` : null,
        tag ? `Tagged “${tag}” by someone on the team.` : null,
      ].filter(Boolean).join(' ');
      used.add(summary.id);
      usedCopies.add(sameSlideKey(row.facts));
      items.push({ slide: summary, why, matched: fit.matched, reasons: { brief, part, from }, needs: met, ...(l ? { learned: l } : {}) });

    }
    const label = STORY_ARC.find((a) => a.role === section.role)!.label;
    sections.push({ role: section.role, label, title: section.title, need: section.need, items, gap: items.length === 0 });
  }
  const known = (id: string) => deps.knowledge?.of(id);
  const compose = { reader: deps.reader, read: opts.read && reader === 'model', log: deps.log, needs };
  // The part of the story a slide does, or null for a page that isn't story (cover, résumés, fees...).
  const partOf = (id: string): StoryRole | null => {
    const k = known(id);
    if (!k || NOT_PROOF.has(k.role) || (k.type && REQUIRED_PAGES.test(k.type))) return null;
    return (STORY_ARC.some((a) => a.role === k.role) ? k.role : null) as StoryRole | null;
  };
  const asItem = (row: { summary: SlideSummary; facts: SlideFacts }, why: string): StoryboardSlide => ({
    slide: row.summary,
    why,
    matched: [],
    reasons: { brief: [], part: [], from: [] },
    needs: needsMet(needs, `${row.facts.title} ${row.facts.text} ${known(row.summary.id)?.about ?? ''}`),
  });
  // Slides hidden in their deck or from an archived deck, never-show pages and copies naming another client are never told.
  const tellable = (row: { summary: SlideSummary }) => !keptOutOfStories(row.summary) && !neverInStory(known(row.summary.id));
  // What the deck itself is about, for a thesis when the request names no needs ("the story of Barlow's")
  const themesOf = (ids: string[]) => {
    const count = new Map<string, number>();
    for (const id of ids) for (const t of known(id)?.themes ?? []) count.set(t, (count.get(t) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
  };
  if (deps.source) {
    // Reimagine (FD-31): the deck's own slides, every one, placed by what each one does.
    const { deck } = deps.source;
    const rows = deps.source.rows.filter((r) => !keptOutOfStories(r.summary));
    const inDeck = new Set(rows.map((r) => r.summary.id));
    // Retold without breaking it (FD-32): every slide stays where the deck had it, because it may
    // answer an RFP whose required pages and order we can't see. The story is woven through instead.
    const items = rows.map((r) => asItem(r, `From the original ${deck.title}.`));
    const owned = new Set(rows.map((r) => partOf(r.summary.id)).filter((x): x is StoryRole => !!x));
    // Slides from other decks for a part the deck never had: offered, never slipped in.
    const fills = new Map(
      plan.sections
        .filter((sec) => !owned.has(sec.role))
        .map((sec) => [sec.role, (sections.find((x) => x.role === sec.role)?.items ?? []).filter((i) => !inDeck.has(i.slide.id)).slice(0, FILL_PER_GAP).map((i) => ({ ...i, why: `Not in the original: from ${i.slide.provenance.sourceTitle}. ${i.why}` }))] as const),
    );
    const fromDeck = plan.sections.map((sec): StoryboardSection => {
      const label = STORY_ARC.find((a) => a.role === sec.role)!.label;
      const own = items.filter((i) => partOf(i.slide.id) === sec.role);
      const offered = fills.get(sec.role) ?? [];
      return { role: sec.role, label, title: sec.title, need: sec.need, items: own.length ? own : offered, gap: own.length + offered.length === 0 };
    });
    const story = await weaveDeck(text, items, partOf, fills, known, { ...compose, order: plan.sections.map((x) => x.role), client: deck.title.split(' · ')[0], themes: themesOf(rows.map((r) => r.summary.id)), isDivider: deps.isDivider, sectionOf: deps.sectionOf });
    return { reader, readerNote, summary: plan.summary, questions: plan.questions, sections: fromDeck, topics: topics.keywords, role, ...story, considered: rows.length, mode: 'reimagine', deck };
  }
  // A family that clearly answers the request is told whole, in its own order (FD-42): when most of the
  // best matches come from slides that belong together (same client, year and template), that family
  // is the story, so "the story of those three people" gets all their slides and nobody else's.
  const family = deps.families ? dominantFamily(onTopicRows.filter(tellable), deps.families.of) : null;
  if (family && deps.families) {
    const rows = (await deps.families.rows(family)).filter(tellable);
    const items = rows.map((r) => asItem(r, `One of the ${rows.length} slides that belong together: ${family.title}.`));
    const story = await weaveDeck(text, items, partOf, new Map(), known, { ...compose, order: plan.sections.map((x) => x.role), client: family.title.split(' · ')[0], themes: themesOf(rows.map((r) => r.summary.id)), isDivider: deps.isDivider, sectionOf: deps.sectionOf });
    return { reader, readerNote, summary: plan.summary, questions: plan.questions, sections, topics: topics.keywords, role, ...story, considered: rows.length, mode: 'build', family: { title: family.title, slides: items.length } };
  }
  // The story told slide by slide (FD-30): the AI chooses and narrates from this shortlist when it is on.
  const story = await composeStory(text, sections, known, compose);
  return { reader, readerNote, summary: plan.summary, questions: plan.questions, sections, topics: topics.keywords, role, ...story, considered: considered.size, mode: 'build', ...(deps.context?.decks.length ? { context: deps.context.decks } : {}) };
}

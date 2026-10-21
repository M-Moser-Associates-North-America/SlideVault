import type { SlideSummary, StoryboardResult, StoryboardSection, StoryboardSlide } from '../../contracts/dto';
import { cleanPlan, MAX_KEYWORDS, whyItFits, type PlanContext, type SearchPlan, type SlideFacts } from '../ai/search-plan';
import { isStopWord } from '../../components/simulation';
import { missingContext, STORY_ARC, standInStory, type StoryPlan, type StoryReader } from '../ai/storyboard';
import { DEFAULT_SLIDES_PER_PART, ROLE_TUNING } from '../ai/roles';
import type { StoryRole, StoryUserRole } from '../../contracts/dto';

/**
 * Storyboard (docs/DECISIONS.md FD-22): a client situation in, a story out. Each part of the story
 * gets the best slides that prove it, from any deck, each slide used once, with a reason built from
 * what is on the slide. A part with no slide is flagged as a gap rather than filled with a weak
 * match. The route wires in the configured reader and the library search; tests pass fakes.
 */

export const SLIDES_PER_SECTION = DEFAULT_SLIDES_PER_PART;

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

export type StoryboardDeps = {
  reader?: StoryReader | null;
  search: (plan: SearchPlan, limit: number) => Promise<{ summary: SlideSummary; facts: SlideFacts }[]>;
  log?: (message: string) => void;
  /** What colleagues said about slides per part for briefs with these topics, keyed "role:slideId" (FD-24) */
  learned?: (topics: string[], role: StoryUserRole | null) => Promise<Map<string, { useful: number; notRight: number }>>;
  /**
   * What the local model read on each slide (FD-26): `of` gives one slide's reading, `forPart` the
   * slides it read as doing that part of a story, so a part can find a slide that never uses its words.
   */
  knowledge?: {
    of: (slideId: string) => { role: string; topics: string[]; about: string } | undefined;
    forPart: (role: StoryRole, limit: number) => Promise<{ summary: SlideSummary; facts: SlideFacts }[]>;
  };
};

/** Slides the scan read as page furniture: never the proof for a part of a story. */
const NOT_PROOF = new Set(['divider', 'admin']);

/** The situation's own words, searched on their own and used to rank every part. */
const MAX_TOPICS = MAX_KEYWORDS;
/** Words that describe the pitch, not the client's need ("we just won a contract for the client"). */
const SITUATION_FILLER = new Set(['just', 'won', 'win', 'already', 'another', 'client', 'clients', 'firm', 'company', 'wants', 'want', 'would', 'could', 'pitching', 'pitch', 'proposal', 'contract', 'new', 'their', 'they', 'them', 'will', 'also', 'need', 'needs', 'help', 'make', 'work', 'working', 'way', 'ways', 'losing', 'lose', 'own', 'worries', 'worried', 'move', 'moving', 'wants', 'board', 'worri', 'will', 'their', 'pitching']);

/**
 * The words in a situation that describe this client's need ("hybrid", "sustainability", "desks"),
 * in the order they were written: no filler, no story words, plurals made singular so "desks"
 * also finds "desk".
 */
export function situationTopics(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9/-]+/)) {
    if (raw.length < 4 || isStopWord(raw) || SITUATION_FILLER.has(raw)) continue;
    // Plurals made singular: "desks" -> "desk", "studies" -> "study", "campuses" -> "campus"; "process", "analysis" stay.
    const w = raw.length <= 4 ? raw : raw.endsWith('ies') ? `${raw.slice(0, -3)}y` : /(s|x|ch|sh)es$/.test(raw) ? raw.slice(0, -2) : raw.endsWith('s') && !/(ss|us|is)$/.test(raw) ? raw.slice(0, -1) : raw;
    if (!SITUATION_FILLER.has(w) && !out.includes(w)) out.push(w);
  }
  return out.slice(0, MAX_TOPICS);
}

/** No client or category filters in a storyboard: the story decides what each part needs. */
const NO_FILTERS: PlanContext = { clients: [], categories: [], thisYear: new Date().getFullYear() };

export async function buildStoryboard(situation: string, deps: StoryboardDeps, opts: { read?: boolean; answers?: string; role?: StoryUserRole | null } = {}): Promise<StoryboardResponse> {
  // The same engine for everyone; the role only changes what parts look for, how many options they
  // offer and what is worth asking (FD-25).
  const role = opts.role ?? null;
  const tuning = role ? ROLE_TUNING[role] : null;
  const perPart = tuning?.slidesPerPart ?? SLIDES_PER_SECTION;
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
  const onTopicRows = topics.keywords.length ? await deps.search(topics, 60) : [];
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
  const used = new Set<string>();
  const sections: StoryboardSection[] = [];
  for (const section of plan.sections) {
    // The role's words go first: the search keeps the first twelve.
    const story = cleanPlan({ keywords: [...(tuning?.words[section.role] ?? []), ...section.words] }, NO_FILTERS);
    const storyRows = story.keywords.length ? await deps.search(story, perPart * 8) : [];
    const readRows = deps.knowledge ? await deps.knowledge.forPart(section.role, perPart * 8).catch(() => []) : [];
    const seen = new Set<string>();
    const ranked = [...onTopicRows, ...storyRows, ...readRows]
      .filter((row) => !seen.has(row.summary.id) && seen.add(row.summary.id))
      .map((row, order) => {
        const l = learned.get(`${section.role}:${row.summary.id}`);
        const readAs = deps.knowledge?.of(row.summary.id)?.role;
        const facts = read(row.facts, row.summary.id);
        return { row, order, l, readAs, said: Math.sign((l?.useful ?? 0) - (l?.notRight ?? 0)), onTopic: whyItFits(topics, facts).matched.reduce((sum, k) => sum + weight(k), 0), inPart: whyItFits(story, row.facts).matched.length, readHere: readAs === section.role ? 1 : 0 };
      })
      // A slide must do this part's job: its words say so, the local model read it that way, or
      // colleagues said it does. Dividers and admin pages never stand as proof. Among those, what
      // colleagues found useful leads, then the ones about this client's situation, then the ones
      // the model read as doing this part.
      .filter((r) => (r.inPart > 0 || r.readHere > 0 || r.said > 0) && !(r.readAs && NOT_PROOF.has(r.readAs) && r.said <= 0))
      .sort((a, b) => b.said - a.said || b.onTopic - a.onTopic || b.readHere - a.readHere || b.inPart - a.inPart || a.order - b.order);
    const items: StoryboardSlide[] = [];
    for (const { row, l, readHere } of ranked) {
      const { summary } = row;
      const facts = read(row.facts, summary.id);
      if (used.has(summary.id)) continue;
      // The reason shows its working, from the slide and its deck only: which of the brief's words
      // are on it (most telling first), what on it does this part's job, and where it comes from.
      const brief = whyItFits(topics, facts).matched.sort((a, b) => weight(b) - weight(a)).slice(0, 3);
      const part = whyItFits(story, row.facts).matched.filter((k) => !brief.includes(k)).slice(0, 2);
      const fit = whyItFits(cleanPlan({ keywords: [...brief, ...story.keywords] }, NO_FILTERS), facts);
      const from = [facts.bestOfTheBest ? 'Best of the Best' : null, facts.category, facts.year ? String(facts.year) : null].filter((x): x is string => !!x);
      const why = [
        brief.length ? `Matches your brief: ${quoted(brief)}.` : null,
        part.length ? `Does this part's job: ${quoted(part)} on the slide.` : null,
        readHere ? `Read as: ${READ_AS[section.role]}.` : null,
        from.length ? `Deck: ${from.join(' · ')}.` : null,
        l?.useful ? `Colleagues marked it useful for this part on ${l.useful === 1 ? 'a similar brief' : `${l.useful} similar briefs`}.` : null,
      ].filter(Boolean).join(' ');
      used.add(summary.id);
      items.push({ slide: summary, why, matched: fit.matched, reasons: { brief, part, from }, ...(l ? { learned: l } : {}) });
      if (items.length >= perPart) break;
    }
    const label = STORY_ARC.find((a) => a.role === section.role)!.label;
    sections.push({ role: section.role, label, title: section.title, need: section.need, items, gap: items.length === 0 });
  }
  return { reader, readerNote, summary: plan.summary, questions: plan.questions, sections, topics: topics.keywords, role };
}

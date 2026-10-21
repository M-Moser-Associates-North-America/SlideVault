import type { SlideSummary, StoryboardResult, StoryboardSection, StoryboardSlide } from '../../contracts/dto';
import { cleanPlan, MAX_KEYWORDS, whyItFits, type PlanContext, type SearchPlan, type SlideFacts } from '../ai/search-plan';
import { isStopWord } from '../../components/simulation';
import { STORY_ARC, standInStory, type StoryPlan, type StoryReader } from '../ai/storyboard';

/**
 * Storyboard (docs/DECISIONS.md FD-22): a client situation in, a story out. Each part of the story
 * gets the best slides that prove it, from any deck, each slide used once, with a reason built from
 * what is on the slide. A part with no slide is flagged as a gap rather than filled with a weak
 * match. The route wires in the configured reader and the library search; tests pass fakes.
 */

export const SLIDES_PER_SECTION = 3;

export type StoryboardResponse = StoryboardResult;

export type StoryboardDeps = {
  reader?: StoryReader | null;
  search: (plan: SearchPlan, limit: number) => Promise<{ summary: SlideSummary; facts: SlideFacts }[]>;
  log?: (message: string) => void;
  /** What colleagues said about slides per part for briefs with these topics, keyed "role:slideId" (FD-24) */
  learned?: (topics: string[]) => Promise<Map<string, { useful: number; notRight: number }>>;
};

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
    const w = raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw;
    if (!SITUATION_FILLER.has(w) && !out.includes(w)) out.push(w);
  }
  return out.slice(0, MAX_TOPICS);
}

/** No client or category filters in a storyboard: the story decides what each part needs. */
const NO_FILTERS: PlanContext = { clients: [], categories: [], thisYear: new Date().getFullYear() };

export async function buildStoryboard(situation: string, deps: StoryboardDeps, opts: { read?: boolean; answers?: string } = {}): Promise<StoryboardResponse> {
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
  // Once the person has answered, don't ask again.
  if (opts.answers?.trim()) plan = { ...plan, questions: [] };

  // What's specific to this client ("hybrid", "sustainability", "desks") is searched on its own and
  // leads every part; the story words ("approach", "case study") decide which part a slide belongs to.
  const topics = cleanPlan({ keywords: situationTopics(text) }, NO_FILTERS);
  const onTopicRows = topics.keywords.length ? await deps.search(topics, 60) : [];
  // A topic on every other slide ("workplace") says little; a rare one ("hybrid") says a lot.
  const slidesWith = new Map(topics.keywords.map((k) => [k, onTopicRows.filter((r) => whyItFits({ ...topics, keywords: [k] }, r.facts).matched.length).length]));
  const weight = (k: string) => 1 / Math.max(1, slidesWith.get(k) ?? 1);

  // The firm's memory: slides marked useful for this part on similar briefs lead, ones marked not
  // right go last. A failure here never stops the storyboard.
  const learned = deps.learned ? await deps.learned(topics.keywords).catch((e) => (deps.log?.(`Story feedback unavailable: ${(e as Error).message}`), new Map())) : new Map();
  const used = new Set<string>();
  const sections: StoryboardSection[] = [];
  for (const section of plan.sections) {
    const story = cleanPlan({ keywords: section.words }, NO_FILTERS);
    const storyRows = story.keywords.length ? await deps.search(story, SLIDES_PER_SECTION * 8) : [];
    const seen = new Set<string>();
    const ranked = [...onTopicRows, ...storyRows]
      .filter((row) => !seen.has(row.summary.id) && seen.add(row.summary.id))
      .map((row, order) => {
        const l = learned.get(`${section.role}:${row.summary.id}`);
        return { row, order, l, said: Math.sign((l?.useful ?? 0) - (l?.notRight ?? 0)), onTopic: whyItFits(topics, row.facts).matched.reduce((sum, k) => sum + weight(k), 0), inPart: whyItFits(story, row.facts).matched.length };
      })
      // A slide must do this part's job (or colleagues said it does); among those, what colleagues
      // found useful leads, then the ones about this client's situation.
      .filter((r) => r.inPart > 0 || r.said > 0)
      .sort((a, b) => b.said - a.said || b.onTopic - a.onTopic || b.inPart - a.inPart || a.order - b.order);
    const items: StoryboardSlide[] = [];
    for (const { row, l } of ranked) {
      const { summary, facts } = row;
      if (used.has(summary.id)) continue;
      // The reason names the client's most telling topics on this slide first, then this part's words.
      const telling = whyItFits(topics, facts).matched.sort((a, b) => weight(b) - weight(a)).slice(0, 4);
      const fit = whyItFits(cleanPlan({ keywords: [...telling, ...story.keywords] }, NO_FILTERS), facts);
      used.add(summary.id);
      const said = l?.useful ? ` Colleagues marked it useful for this part on ${l.useful === 1 ? 'a similar brief' : `${l.useful} similar briefs`}.` : '';
      items.push({ slide: summary, why: `${section.need} ${fit.why}${said}`, matched: fit.matched, ...(l ? { learned: l } : {}) });
      if (items.length >= SLIDES_PER_SECTION) break;
    }
    const label = STORY_ARC.find((a) => a.role === section.role)!.label;
    sections.push({ role: section.role, label, title: section.title, need: section.need, items, gap: items.length === 0 });
  }
  return { reader, readerNote, summary: plan.summary, questions: plan.questions, sections, topics: topics.keywords };
}

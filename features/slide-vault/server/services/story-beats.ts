import type { StoryBeat, StoryboardSection, StoryboardSlide, StoryRole } from '../../contracts/dto';
import type { ComposeCandidate, StoryReader } from '../ai/storyboard';

/**
 * The story told slide by slide (docs/DECISIONS.md FD-30). The rules have already found the slides
 * that speak to this brief and sorted them into the parts of the story; the parts only decide the
 * order and are never shown. The AI, when it is on, chooses from that shortlist the slide that best
 * tells each moment and the slides behind it, and writes what to say. Without it, or if its answer
 * is unusable, the rules build the same shape so there is always a story.
 */

export type KnownSlide = { type?: string; about: string; projects?: string[] } | undefined;

/** How many beats each part tells at most when the rules build the story. */
const BEATS_PER_PART: Record<StoryRole, number> = { 'client-challenge': 2, insight: 1, strategy: 3, experience: 3, 'why-us': 2, outcome: 1 };
const MAX_MORE = 8;

/** A beat's title from the kind of slide that leads it, when it isn't the first beat of its part. */
const TYPE_TITLE: Record<string, string> = {
  client_understanding: 'Your situation',
  design_concept: 'The idea',
  planning_testfit: 'Planning the space',
  approach_process: 'How we get there',
  risk_governance: 'Keeping it on track',
  process_technology: 'How we work',
  case_study_detail: 'Work like this',
  case_study_hero: 'Work like this',
  image_gallery: 'What it can look like',
  client_references: 'Clients who trust us',
  team_structure: 'Your team',
  capability_service: 'What we bring',
  differentiator: 'Why us',
  firm_profile: 'Who we are',
  closing: 'What you get',
};

/** Without the AI, a beat that leads its part is titled in the client's terms, never with the part's own name. */
const ROLE_TITLE: Record<StoryRole, string> = {
  'client-challenge': 'Where you are today',
  insight: 'What we see',
  strategy: 'How we get there',
  experience: "We've done this before",
  'why-us': "Who you'll work with",
  outcome: 'What you get',
};

/** What a part must show ("Show we understand…"), read as why the slide is here ("Shows we understand…"). */
const asWhy = (need: string) => need.replace(/^Show /, 'Shows ');

/**
 * The story in one line, when the AI isn't writing it: what the deck must convince the client of,
 * from the needs its brief names (FD-30, tightened 24 Oct: the beats should read as one argument).
 */
/** Each need the brief can name (storyboard.ts NEEDS), said the way a person would: what we understand, and what they get. */
const NEED_WORDS: Record<string, { understand: string; get?: string; proof?: string }> = {
  healthcare: { understand: 'how a hospital works', proof: 'for a hospital' },
  'bringing sites together': { understand: 'what it takes to bring their sites together', get: 'one organisation across every site', proof: 'bringing sites together' },
  'staff wellbeing': { understand: 'what their people are going through', get: 'a place their people want to work', proof: 'putting people first' },
  'the board': { understand: 'what their board needs to see', get: 'a plan their board can sign off' },
  'cost and budget': { understand: 'how much cost certainty matters', get: 'cost certainty', proof: 'on budget' },
  'a past project gone wrong': { understand: 'why the last project went wrong', get: 'a project that lands this time' },
  'hybrid work': { understand: 'how their people work now', get: 'space that fits how they work' },
  sustainability: { understand: 'their sustainability goals', get: 'a building that meets their sustainability goals' },
  'culture and brand': { understand: 'what makes them who they are', get: 'a space that feels like them' },
  growth: { understand: 'where they are growing', get: 'room to grow' },
};
const said = (need: string) => NEED_WORDS[need]?.understand ?? need;
const proven = (need: string) => NEED_WORDS[need]?.proof ?? `on ${said(need)}`;
const joined = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''));

export function rulesThesis(needs: string[]): string {
  const list = needs.slice(0, 3).map(said);
  return list.length ? `Show them we understand ${joined(list)}, have a clear plan, and have done it before.` : 'Show them we understand their situation, have a clear plan, and have done it before.';
}

/** How a beat follows from the one before, when the AI isn't writing it: the turn the story takes from one part to the next. */
export function rulesBridge(prev: StoryRole | null, role: StoryRole, needs: string[]): string {
  const on = needs[0] ? `, this time on ${said(needs[0])}` : '';
  const gets = needs.map((n) => NEED_WORDS[n]?.get).filter((x): x is string => !!x).slice(0, 2);
  if (prev === null) return role === 'client-challenge' ? 'Start with them: their situation, in their terms, before anything about us.' : 'Open on what matters most to them.';
  if (prev === role)
    return {
      'client-challenge': `Stay with their situation a moment longer${on}.`,
      insight: `One more thing we see in it${on}.`,
      strategy: `The next step of the plan${on}.`,
      experience: `More proof${needs[0] ? `, this time ${proven(needs[0])}` : ', from another angle'}.`,
      'why-us': 'More on who they would be working with.',
      outcome: 'And what else they get.',
    }[role];
  return {
    'client-challenge': 'Bring it back to their situation.',
    insight: 'Once they feel understood, show what we see in it that others might miss.',
    strategy: prev === 'client-challenge' ? 'From their situation straight to the plan: how we would solve it.' : 'That insight leads to the plan: how we would solve it, step by step.',
    experience: `A plan is only a promise until it's proven: this shows we've done it before${needs[0] ? `, ${proven(needs[0])}` : ''}.`,
    'why-us': 'With the proof in, introduce the people and what sets us apart.',
    outcome: `Close on what they get${gets.length ? `: ${joined(gets)}` : ', in their terms'}.`,
  }[role];
}

/** Bridges for beats whose order the app set, or whose neighbour changed after the AI wrote them. */
function bridgeAll(beats: StoryBeat[], keep: (b: StoryBeat, i: number) => boolean = () => false) {
  beats.forEach((b, i) => {
    if (!keep(b, i)) b.bridge = rulesBridge(i ? beats[i - 1].role : null, b.role, b.lead.needs ?? b.matches);
  });
}

const firstSentence = (text: string, max = 260) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return (t.match(/^.{20,}?[.!?](?=\s|$)/)?.[0] ?? t).slice(0, max);
};

/** Without the AI the story is named from the brief's opening words: "A hospital group is merging three campuses". */
export function rulesTitle(brief: string): string {
  const words = (brief.split(/(?<=[.!?])\s/)[0] ?? brief).replace(/[.!?]+$/, '').trim().split(/\s+/);
  return words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '');
}

/**
 * The rules' story: each part in order, its slides grouped into beats by project (a case study and
 * its pictures belong together) or by kind of slide, the best-ranked slide leading each beat.
 */
export function rulesBeats(sections: StoryboardSection[], known: (id: string) => KnownSlide, keepAll = false): StoryBeat[] {
  const beats: StoryBeat[] = [];
  for (const s of sections) {
    const groups = new Map<string, StoryboardSlide[]>();
    for (const item of s.items) {
      const k = known(item.slide.id);
      const key = k?.projects?.[0] ?? k?.type ?? 'slide';
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const all = [...groups.values()];
    const kept = all.slice(0, BEATS_PER_PART[s.role]);
    if (kept.length) kept[kept.length - 1] = [...kept[kept.length - 1], ...all.slice(kept.length).flat()];
    kept.forEach((group, i) => {
      const [lead, ...more] = group;
      const k = known(lead.slide.id);
      // The AI's heading for the part is in the client's terms; the standard label is not.
      const partTitle = s.title !== s.label ? s.title : ROLE_TITLE[s.role];
      const title = i === 0 ? partTitle : s.role === 'experience' && k?.projects?.[0] ? k.projects[0] : (TYPE_TITLE[k?.type ?? ''] ?? partTitle);
      beats.push({ role: s.role, title, bridge: '', narration: k?.about ? firstSentence(k.about) : '', why: asWhy(s.need), matches: (lead.needs?.length ? lead.needs : lead.reasons.brief).slice(0, 2), lead, more: keepAll ? more : more.slice(0, MAX_MORE) });
    });
  }
  return beats;
}

/**
 * The AI chose the lead slides and the slides behind them; any slide it left out goes behind the last
 * beat of its own part, or into a new beat for a part it skipped, so nothing from the deck is lost.
 */
function keepEverySlide(beats: StoryBeat[], sections: StoryboardSection[], known: (id: string) => KnownSlide) {
  const shown = new Set(beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id)));
  for (const s of sections) {
    const left = s.items.filter((i) => !shown.has(i.slide.id));
    if (!left.length) continue;
    const home = [...beats].reverse().find((b) => b.role === s.role);
    if (home) home.more.push(...left);
    else beats.push(...rulesBeats([{ ...s, items: left }], known, true).map((b) => ({ ...b, bridge: '' })));
  }
  const at = (r: StoryRole) => sections.findIndex((s) => s.role === r);
  beats.sort((a, b) => at(a.role) - at(b.role));
}

export async function composeStory(
  brief: string,
  sections: StoryboardSection[],
  known: (id: string) => KnownSlide,
  /** keepAll: every shortlisted slide stays in the story (a reimagined deck loses none of its slides) */
  opts: { reader?: StoryReader | null; read?: boolean; log?: (m: string) => void; keepAll?: boolean; needs?: string[] },
): Promise<{ title: string; thesis: string; beats: StoryBeat[]; composer: 'model' | 'rules' }> {
  // The brief's own needs, in the order it names them (the slides only add what they speak to)
  const briefNeeds = opts.needs ?? [...new Set(sections.flatMap((s) => s.items.flatMap((i) => i.needs ?? [])))];
  const rules = () => {
    const beats = rulesBeats(sections, known, opts.keepAll);
    bridgeAll(beats);
    return { title: rulesTitle(brief), thesis: rulesThesis(briefNeeds), beats, composer: 'rules' as const };
  };
  const compose = opts.reader?.compose;
  if (!opts.read || !compose) return rules();
  // Short codes stand in for the library's ids: the model can only point at what it was shown.
  const byCode = new Map<string, { section: StoryboardSection; item: StoryboardSlide }>();
  const candidates: ComposeCandidate[] = sections.flatMap((section) =>
    section.items.map((item) => {
      const code = `s${byCode.size + 1}`;
      byCode.set(code, { section, item });
      const k = known(item.slide.id);
      return { code, role: section.role, type: k?.type ?? null, title: item.slide.title, reading: k?.about ?? '', needs: item.needs ?? [] };
    }),
  );
  if (candidates.length < 3) return rules();
  try {
    const story = await compose.call(opts.reader, brief, candidates);
    const told = new Map<string, number>();
    const beats = story.beats.map((b): StoryBeat => {
      told.set(b.lead, b.told);
      const { section, item: lead } = byCode.get(b.lead)!;
      return {
        role: b.role,
        title: b.title || (section.title !== section.label ? section.title : ROLE_TITLE[section.role]),
        bridge: b.bridge,
        narration: b.narration,
        why: b.why || asWhy(section.need),
        // Only words the brief really uses; anything else (a slide code, a made-up theme) falls back to the needs.
        matches: b.matches.filter((m) => brief.toLowerCase().includes(m)).length ? b.matches.filter((m) => brief.toLowerCase().includes(m)) : (lead.needs ?? []).slice(0, 2),
        lead,
        more: b.more.map((c) => byCode.get(c)!.item),
      };
    });
    // Past work for the client's own kind of organisation leads the proof, whatever the model chose.
    const proof = beats.find((b) => b.role === 'experience');
    const shown = new Set(beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id)));
    const sameSector = (i: StoryboardSlide) => i.why.includes('Same sector as your client');
    if (proof && !sameSector(proof.lead)) {
      const better = proof.more.find(sameSector) ?? sections.find((s) => s.role === 'experience')?.items.find((i) => sameSector(i) && !shown.has(i.slide.id));
      if (better) {
        proof.more = [proof.lead, ...proof.more.filter((i) => i !== better)];
        proof.lead = better;
        proof.matches = (better.needs ?? proof.matches).slice(0, 2);
      }
    }
    if (opts.keepAll) keepEverySlide(beats, sections, known);
    // The AI's bridge only holds where its beat still follows the beat it was written after.
    const codeOf = new Map([...byCode].map(([code, v]) => [v.item.slide.id, code]));
    const position = (b: StoryBeat) => told.get(codeOf.get(b.lead.slide.id) ?? '') ?? -1;
    bridgeAll(beats, (b, i) => !!b.bridge && position(b) >= 0 && (i === 0 ? position(b) === 0 : position(beats[i - 1]) === position(b) - 1));
    return { title: story.title || rulesTitle(brief), thesis: story.thesis || rulesThesis(briefNeeds), beats, composer: 'model' };
  } catch (e) {
    opts.log?.(`Story composer unavailable, using the rules' order: ${(e as Error).message}`);
    return rules();
  }
}

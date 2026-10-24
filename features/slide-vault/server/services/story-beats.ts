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
      beats.push({ role: s.role, title, narration: k?.about ? firstSentence(k.about) : '', why: asWhy(s.need), matches: (lead.needs?.length ? lead.needs : lead.reasons.brief).slice(0, 2), lead, more: keepAll ? more : more.slice(0, MAX_MORE) });
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
    else beats.push(...rulesBeats([{ ...s, items: left }], known, true));
  }
  const at = (r: StoryRole) => sections.findIndex((s) => s.role === r);
  beats.sort((a, b) => at(a.role) - at(b.role));
}

export async function composeStory(
  brief: string,
  sections: StoryboardSection[],
  known: (id: string) => KnownSlide,
  /** keepAll: every shortlisted slide stays in the story (a reimagined deck loses none of its slides) */
  opts: { reader?: StoryReader | null; read?: boolean; log?: (m: string) => void; keepAll?: boolean },
): Promise<{ title: string; beats: StoryBeat[]; composer: 'model' | 'rules' }> {
  const rules = () => ({ title: rulesTitle(brief), beats: rulesBeats(sections, known, opts.keepAll), composer: 'rules' as const });
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
    const beats = story.beats.map((b): StoryBeat => {
      const { section, item: lead } = byCode.get(b.lead)!;
      return {
        role: b.role,
        title: b.title || (section.title !== section.label ? section.title : ROLE_TITLE[section.role]),
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
    return { title: story.title || rulesTitle(brief), beats, composer: 'model' };
  } catch (e) {
    opts.log?.(`Story composer unavailable, using the rules' order: ${(e as Error).message}`);
    return rules();
  }
}

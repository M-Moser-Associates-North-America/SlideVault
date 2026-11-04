import type { StoryBeat, StoryboardSection, StoryboardSlide, StoryRole } from '../../contracts/dto';
import { wholeSentences, type ComposeCandidate, type StoryReader } from '../ai/storyboard';

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
export const TYPE_TITLE: Record<string, string> = {
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
export const ROLE_TITLE: Record<StoryRole, string> = {
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
export const joined = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''));

export function rulesThesis(needs: string[]): string {
  const list = needs.slice(0, 3).map(said);
  return list.length ? `Show them we understand ${joined(list)}, have a clear plan, and have done it before.` : 'Show them we understand their situation, have a clear plan, and have done it before.';
}

/** The story's last words, when the AI isn't writing them: what the client gets, from the needs the brief names. */
export function rulesClose(needs: string[]): string {
  const gets = needs.map((n) => NEED_WORDS[n]?.get).filter((x): x is string => !!x).slice(0, 3);
  return gets.length ? `In the end, they get ${joined(gets)}.` : '';
}

/**
 * Why a case study is in this client's story, when the AI isn't writing it: direct when it's work for
 * the same kind of client, transferable otherwise, and either way what it shows for them (24 Oct: every
 * deck we read left the proof untied to the client).
 */
export function proofWhy(item: StoryboardSlide): string {
  const same = item.why.includes('Same sector as your client');
  const need = (item.needs ?? []).find((n) => n !== 'healthcare') ?? item.needs?.[0];
  const shows = need ? `it shows we know ${said(need)}` : 'say what carries over to them';
  return same ? `Direct: the same kind of client, and ${shows}.` : `Transferable: a different kind of client, but ${shows}.`;
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

export const firstSentence = (text: string, max = 260) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return wholeSentences(t.match(/^.{20,}?[.!?](?=\s|$)/)?.[0] ?? t, max);
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
export function rulesBeats(sections: StoryboardSection[], known: (id: string) => KnownSlide): StoryBeat[] {
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
      beats.push({ role: s.role, title, bridge: '', narration: k?.about ? firstSentence(k.about) : '', why: s.role === 'experience' ? proofWhy(lead) : asWhy(s.need), matches: (lead.needs?.length ? lead.needs : lead.reasons.brief).slice(0, 2), lead, more: more.slice(0, MAX_MORE) });
    });
  }
  return beats;
}

export async function composeStory(
  brief: string,
  sections: StoryboardSection[],
  known: (id: string) => KnownSlide,
  opts: { reader?: StoryReader | null; read?: boolean; log?: (m: string) => void; needs?: string[] },
): Promise<{ title: string; thesis: string; close: string; beats: StoryBeat[]; composer: 'model' | 'rules' }> {
  // The brief's own needs, in the order it names them (the slides only add what they speak to)
  const briefNeeds = opts.needs ?? [...new Set(sections.flatMap((s) => s.items.flatMap((i) => i.needs ?? [])))];
  const rules = () => {
    const beats = rulesBeats(sections, known);
    bridgeAll(beats);
    return { title: rulesTitle(brief), thesis: rulesThesis(briefNeeds), close: rulesClose(briefNeeds), beats, composer: 'rules' as const };
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
        why: b.why || (section.role === 'experience' ? proofWhy(lead) : asWhy(section.need)),
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
    // The AI's bridge only holds where its beat still follows the beat it was written after.
    const codeOf = new Map([...byCode].map(([code, v]) => [v.item.slide.id, code]));
    const position = (b: StoryBeat) => told.get(codeOf.get(b.lead.slide.id) ?? '') ?? -1;
    bridgeAll(beats, (b, i) => !!b.bridge && position(b) >= 0 && (i === 0 ? position(b) === 0 : position(beats[i - 1]) === position(b) - 1));
    return { title: story.title || rulesTitle(brief), thesis: story.thesis || rulesThesis(briefNeeds), close: story.close || rulesClose(briefNeeds), beats, composer: 'model' };
  } catch (e) {
    opts.log?.(`Story composer unavailable, using the rules' order: ${(e as Error).message}`);
    return rules();
  }
}

/* ---- Retelling a deck without breaking it (FD-32) ------------------------------------------ */

/** Kinds of page a proposal needs that aren't story, as a person would name them */
const REQUIRED_PAGE: Record<string, string> = {
  cover: 'cover',
  cover_letter: 'cover letter',
  table_of_contents: 'contents',
  section_divider: 'divider',
  rfp_worksheet: 'RFP forms',
  team_resume: 'résumés',
  team_time_allocation: 'team time',
  fees_commercial: 'fees',
  schedule: 'schedule',
  legal_admin: 'legal',
  scope_assumptions: 'scope',
  blank_or_placeholder: 'blank page',
};
/** What a deck is missing when it has nothing for a part of the story */
const NEVER: Record<StoryRole, string> = {
  'client-challenge': "sets out the client's situation",
  insight: 'says what we see in their situation',
  strategy: 'lays out how we would do it',
  experience: 'shows proof from past work',
  'why-us': 'introduces who they would work with',
  outcome: 'closes on what they get',
};
const PART_WHY: Record<StoryRole, string> = {
  'client-challenge': 'Shows we understand their situation before talking about ourselves.',
  insight: 'Shows what we see in their situation that others might miss.',
  strategy: 'Shows how we would solve it, step by step.',
  experience: 'Proves we have done this before.',
  'why-us': 'Shows the people and what sets us apart.',
  outcome: 'Shows what the client gets.',
};
const NOT_A_LEAD = /^(cover|section_divider|table_of_contents|blank_or_placeholder)$/;

/** The line that opens a story section and ties it back to the thesis, when the AI isn't writing it */
export function weaveLine(role: StoryRole, needs: string[]): string {
  const key = needs[0] ? said(needs[0]) : 'what they need';
  return {
    'client-challenge': 'Their situation, in their terms: everything after this answers it.',
    insight: 'What we see in it that others might miss: the thread for the rest of the deck.',
    strategy: `How we would do it, tied back to ${key}.`,
    experience: `Proof we've done this before${needs[0] ? `, ${proven(needs[0])}` : ''}: each project should say what it shows for them.`,
    'why-us': `Who they would work with, and why that matters for ${key}.`,
    outcome: 'What they get, in their terms: close on it.',
  }[role];
}

type Section = { code: string; role: StoryRole; kind?: 'required' | 'suggested'; items: StoryboardSlide[]; sec?: string; name?: string; secKind?: string };

/** About how many sections a long retold deck is read in, before suggested additions. */
const MAX_SECTIONS = 12;
/** Longest run of slides kept together as one chapter of a retold deck. */
const MAX_CHAPTER = 30;
/** What a standard deck section does in the story (FD-57 kinds); fees and the appendix are required pages. */
const CHAPTER_ROLE: Record<string, StoryRole | 'required'> = { firm: 'why-us', team: 'why-us', 'case-studies': 'experience', approach: 'strategy', understanding: 'client-challenge', fees: 'required', appendix: 'required' };
/** The deck's own name for a chapter, with a capital first letter ("team" → "Team"). */
const chapterName = (name: string) => name.trim().replace(/^./, (c) => c.toUpperCase());

/**
 * An existing deck, retold without breaking it (FD-32): every slide stays where it was, in the
 * deck's own sections, because the proposal may answer an RFP whose required pages and order we
 * can't see. The story is woven through instead: a thesis, and a line opening each section that ties
 * it back. A part the deck never had is offered as a suggested addition where that part belongs.
 */
export async function weaveDeck(
  brief: string,
  deck: StoryboardSlide[],
  partOf: (id: string) => StoryRole | null,
  fills: Map<StoryRole, StoryboardSlide[]>,
  known: (id: string) => KnownSlide,
  opts: { reader?: StoryReader | null; read?: boolean; log?: (m: string) => void; needs: string[]; order: StoryRole[]; client?: string; themes?: string[]; isDivider?: (id: string) => boolean; sectionOf?: (id: string) => { key: string; name: string; kind?: string } | undefined },
): Promise<{ title: string; thesis: string; close: string; beats: StoryBeat[]; composer: 'model' | 'rules' }> {
  // A divider is what the scan read as one, or a page breaker the section reader found (FD-57: zero-padded
  // numbers, "Section: AA", name-only and creative divider titles the scan can miss).
  const isDivider = (id: string) => known(id)?.type === 'section_divider' || !!opts.isDivider?.(id);
  // The deck's sections: a new one at each divider, and wherever it turns from story to required pages or from one part to the next.
  const sections: Section[] = [];
  let last: StoryRole = opts.order[0];
  // A chapter too long to read as one (the section reader found few breaks, as in a 100-slide deck
  // with two) is split where the deck turns, as before.
  const chapterSize = new Map<string, number>();
  for (const item of deck) { const k = opts.sectionOf?.(item.slide.id)?.key; if (k) chapterSize.set(k, (chapterSize.get(k) ?? 0) + 1); }
  const chapterOf = (id: string) => { const sec = opts.sectionOf?.(id); return sec && (chapterSize.get(sec.key) ?? 0) <= MAX_CHAPTER ? sec : undefined; };
  for (const item of deck) {
    const part = partOf(item.slide.id);
    const kind = part ? undefined : ('required' as const);
    const role = part ?? last;
    const prev = sections[sections.length - 1];
    // Inside a section the deck marked with a page breaker (Gabby, 28 Oct: "if it follows the page
    // breaker… it would pull those slides"), the slides stay together as the deck's own chapter,
    // whatever each one does; outside one, a new section starts wherever the deck turns.
    const sec = chapterOf(item.slide.id);
    if (sec) {
      if (prev?.sec === sec.key) prev.items.push(item);
      else sections.push({ code: '', role, kind, items: [item], sec: sec.key, name: chapterName(sec.name), secKind: sec.kind });
    } else {
      const divider = isDivider(item.slide.id);
      if (!prev || prev.sec || divider || prev.kind !== kind || (!kind && prev.role !== role)) sections.push({ code: '', role, kind, items: [item] });
      else prev.items.push(item);
    }
    if (part) last = part;
  }
  // A chapter is a story section if any slide in it tells the story, about what most of them do.
  for (const s of sections) {
    if (!s.sec) continue;
    // A standard section says what it does: case studies are the proof, fees and the appendix are required pages.
    const known = CHAPTER_ROLE[s.secKind ?? ''];
    if (known === 'required') { s.kind = 'required'; continue; }
    if (known) { s.role = known; s.kind = undefined; continue; }
    const parts = s.items.map((i) => partOf(i.slide.id)).filter((x): x is StoryRole => !!x);
    if (!parts.length) continue;
    const count = new Map<StoryRole, number>();
    for (const p of parts) count.set(p, (count.get(p) ?? 0) + 1);
    s.role = [...count].sort((a, b) => b[1] - a[1])[0][0];
    s.kind = undefined;
  }
  // A divider opens the section after it: keep it with that section, not on its own.
  for (let i = sections.length - 2; i >= 0; i--) {
    const s = sections[i];
    if (!s.sec && !sections[i + 1].sec && s.items.length === 1 && isDivider(s.items[0].slide.id) && sections[i + 1]) {
      sections[i + 1].items.unshift(...s.items);
      sections.splice(i, 1);
    }
  }
  // A long deck with few page breakers turns from story to required pages every slide or two; read
  // that way it's dozens of one-slide sections. Merge the smallest run outside a chapter into its
  // smaller neighbour (never across a chapter) until the deck reads in about MAX_SECTIONS parts.
  const loose = (i: number) => i >= 0 && i < sections.length && !sections[i].sec;
  while (sections.length > MAX_SECTIONS) {
    let at = -1;
    for (let i = 0; i < sections.length; i++) if (loose(i) && (loose(i - 1) || loose(i + 1)) && (at < 0 || sections[i].items.length < sections[at].items.length)) at = i;
    if (at < 0) break;
    const into = !loose(at - 1) ? at + 1 : !loose(at + 1) ? at - 1 : sections[at - 1].items.length <= sections[at + 1].items.length ? at - 1 : at + 1;
    const [a, b] = at < into ? [sections[at], sections[into]] : [sections[into], sections[at]];
    const items = [...a.items, ...b.items];
    const parts = items.map((i) => partOf(i.slide.id)).filter((x): x is StoryRole => !!x);
    const count = new Map<StoryRole, number>();
    for (const p of parts) count.set(p, (count.get(p) ?? 0) + 1);
    const merged: Section = { code: '', role: parts.length ? [...count].sort((x, y) => y[1] - x[1])[0][0] : a.role, kind: parts.length ? undefined : 'required', items };
    sections.splice(Math.min(at, into), 2, merged);
  }
  // Parts the deck never had, offered where they belong in the story.
  const told = new Set(deck.map((i) => partOf(i.slide.id)).filter((x): x is StoryRole => !!x));
  for (const role of opts.order) {
    const offer = fills.get(role);
    if (told.has(role) || !offer?.length) continue;
    const at = opts.order.indexOf(role);
    const before = sections.findIndex((s) => !s.kind && opts.order.indexOf(s.role) > at);
    // After the last story (or suggested) section, so suggestions keep story order; a deck with no story
    // pages at all gets them after its cover.
    const lastTold = sections.map((s) => s.kind !== 'required').lastIndexOf(true);
    const at2 = before >= 0 ? before : lastTold >= 0 ? lastTold + 1 : sections.length > 1 ? 1 : sections.length;
    sections.splice(at2, 0, { code: '', role, kind: 'suggested', items: offer });
  }
  sections.forEach((s, i) => (s.code = `w${i + 1}`));

  const firstOfRole = new Set<string>();
  const beats = sections.map((s): StoryBeat => {
    const lead = s.items.find((i) => !NOT_A_LEAD.test(known(i.slide.id)?.type ?? '')) ?? s.items[0];
    const more = s.items.filter((i) => i !== lead);
    const needs = lead.needs ?? [];
    const pages = [...new Set(s.items.map((i) => REQUIRED_PAGE[known(i.slide.id)?.type ?? '']).filter(Boolean))];
    const first = !firstOfRole.has(s.role) && !s.kind;
    if (!s.kind) firstOfRole.add(s.role);
    if (s.kind === 'required')
      return { role: s.role, kind: 'required', title: s.name ? s.name : pages.length ? pages.slice(0, 3).join(', ').replace(/^./, (c) => c.toUpperCase()) : 'Required pages', bridge: `Pages the proposal needs${pages.length ? ` (${pages.join(', ')})` : ''}: kept where they were, as they are.`, narration: '', why: 'Required pages stay as the original had them.', matches: [], lead, more };
    if (s.kind === 'suggested') {
      const from = [...new Set(s.items.map((i) => i.slide.provenance.sourceTitle))].join(', ');
      return { role: s.role, kind: 'suggested', title: `Suggested: ${ROLE_TITLE[s.role].toLowerCase()}`, bridge: `Suggested addition: the original never ${NEVER[s.role]}. These slides from ${from} could fill it here.`, narration: '', why: PART_WHY[s.role], matches: needs.slice(0, 2), lead, more };
    }
    const k = known(lead.slide.id);
    // A run merged from a long deck with no chapter name goes by its lead slide's own title, so parts of one kind don't all read the same.
    const own = !first && !s.sec && s.items.length > 2 && lead.slide.title.length <= 70 && !/^slide \d+$/i.test(lead.slide.title.trim()) && (lead.slide.title.match(/\p{L}/gu)?.length ?? 0) >= 3 ? lead.slide.title.trim() : null;
    const title = s.name ? s.name : own ? own : first ? ROLE_TITLE[s.role] : s.role === 'experience' && k?.projects?.[0] ? k.projects[0] : (TYPE_TITLE[k?.type ?? ''] ?? ROLE_TITLE[s.role]);
    return { role: s.role, title, bridge: weaveLine(s.role, needs.length ? needs : opts.needs), narration: k?.about ? firstSentence(k.about) : '', why: s.role === 'experience' ? proofWhy(lead) : PART_WHY[s.role], matches: needs.slice(0, 2), lead, more };
  });
  // No needs named ("the story of Barlow's"): the thesis comes from what the deck itself is about.
  const thesis = opts.needs.length || !opts.themes?.length ? rulesThesis(opts.needs) : `Show ${opts.client ?? 'them'} we understand what matters to them (${joined(opts.themes)}), have a clear plan, and have done it before.`;
  const rules = { title: rulesTitle(brief), thesis, close: rulesClose(opts.needs), beats, composer: 'rules' as const };

  const weave = opts.reader?.weave;
  if (!opts.read || !weave) return rules;
  try {
    const woven = await weave.call(
      opts.reader,
      brief,
      sections.map((s, i) => ({ code: s.code, role: s.role, required: s.kind === 'required', suggested: s.kind === 'suggested', slides: s.items.length, title: s.name ?? beats[i].lead.slide.title, reading: known(beats[i].lead.slide.id)?.about ?? '' })),
    );
    // The AI's words where it wrote them; the slides and their order are never its to change.
    const out = beats.map((b, i) => {
      const w = woven.sections.get(sections[i].code);
      if (!w) return b;
      return { ...b, title: w.title || b.title, bridge: w.bridge || b.bridge, narration: b.kind === 'required' ? '' : w.narration || b.narration, why: w.why || b.why };
    });
    return { title: woven.title || rules.title, thesis: woven.thesis || rules.thesis, close: woven.close || rules.close, beats: out, composer: 'model' };
  } catch (e) {
    opts.log?.(`Story weaver unavailable, using the rules' lines: ${(e as Error).message}`);
    return rules;
  }
}

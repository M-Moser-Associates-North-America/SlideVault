import type { SlideSummary } from '../contracts/dto';

/**
 * Rules-based reading of searches and slides: no model, no randomness. It matches fixed topic words
 * against what a person typed and against each slide's own title, deck name and category. The server
 * uses parseQuery as the stand-in reader when no AI provider is set or the model fails (FD-17), and
 * the filter row uses the same topics for "Slide type". FD-14's simulated features (approval statuses,
 * sample people, suggested labels) were removed from this file; see FD-14 in docs/DECISIONS.md.
 */

/* --------------------------------------------------------------- Slide types */

/** The slide types the filter row offers, each matched by a topic word on the slide (see topicTags). */
export const SLIDE_TYPES: { label: string; tag: string }[] = [
  { label: 'About us', tag: 'about us' },
  { label: 'Services', tag: 'services' },
  { label: 'Vision and values', tag: 'values' },
  { label: 'Team', tag: 'team' },
  { label: 'Cost and fees', tag: 'cost' },
  { label: 'Process and timeline', tag: 'process' },
  { label: 'Case study', tag: 'case study' },
  { label: 'Problem', tag: 'problem' },
  { label: 'Options', tag: 'options' },
  { label: 'Concept and solution', tag: 'concept' },
  { label: 'Next steps', tag: 'next steps' },
  { label: 'Scope and brief', tag: 'scope' },
  { label: 'Cover', tag: 'cover' },
  { label: 'Frameworks and diagrams', tag: 'framework' },
  { label: 'Portfolio', tag: 'portfolio' },
];

/** Does this slide's title, deck name or category contain a topic word for the given slide type? */
export function hasSlideType(s: SlideSummary, label: string): boolean {
  const tag = SLIDE_TYPES.find((t) => t.label === label)?.tag;
  return !!tag && topicTags(s).includes(tag);
}

/* --------------------------------------------------------------- Topic rules */

type Concept = { id: string; label: string; words: string[]; tags: string[] };

const CONCEPTS: Concept[] = [
  {
    id: 'about',
    label: 'About the firm',
    words: ['about us', 'who we are', 'capabilities', 'capability', 'company', 'firm', 'overview', 'what we do'],
    tags: ['about us', 'services'],
  },
  {
    id: 'services',
    label: 'Services',
    words: ['services', 'service', 'offer', 'offering'],
    tags: ['services'],
  },
  {
    id: 'values',
    label: 'Values and culture',
    words: ['values', 'culture', 'mission', 'principles'],
    tags: ['values', 'culture'],
  },
  {
    id: 'team',
    label: 'Team and people',
    words: ['team', 'teams', 'bio', 'bios', 'people', 'leadership', 'leaders', 'staff', 'resume', 'resumes'],
    tags: ['team', 'leadership'],
  },
  {
    id: 'cost',
    label: 'Cost and fees',
    words: ['cost', 'costs', 'price', 'pricing', 'budget', 'fee', 'fees', 'economics', 'financial', 'business case', 'roi', 'commercial'],
    tags: ['cost', 'fees'],
  },
  {
    id: 'process',
    label: 'Process and approach',
    words: ['process', 'how we work', 'approach', 'method', 'methodology', 'steps', 'timeline', 'programme', 'program', 'phasing', 'schedule'],
    tags: ['process', 'timeline'],
  },
  {
    id: 'proof',
    label: 'Proof and references',
    words: ['reference', 'references', 'testimonial', 'quote', 'proof', 'evidence', 'results', 'outcomes', 'case study', 'case studies', 'track record', 'experience'],
    tags: ['case study', 'outcomes'],
  },
  {
    id: 'problem',
    label: 'The problem',
    words: ['problem', 'challenge', 'challenges', 'issue', 'current state'],
    tags: ['problem'],
  },
  {
    id: 'options',
    label: 'Options compared',
    words: ['option', 'options', 'compare', 'comparison', 'alternatives', 'scenarios'],
    tags: ['options'],
  },
  {
    id: 'solution',
    label: 'Concept and solution',
    words: ['concept', 'solution', 'idea', 'vision'],
    tags: ['concept'],
  },
  {
    id: 'next',
    label: 'Recommendation',
    words: ['recommend', 'recommendation', 'next steps', 'decision', 'closing', 'conclusion'],
    tags: ['next steps'],
  },
  {
    id: 'scope',
    label: 'Scope and brief',
    words: ['scope', 'brief', 'requirements'],
    tags: ['scope'],
  },
  {
    id: 'cover',
    label: 'Cover and headings',
    words: ['cover', 'title slide', 'opening', 'heading', 'headings'],
    tags: ['cover'],
  },
  {
    id: 'hybrid',
    label: 'Hybrid work',
    words: ['hybrid', 'remote', 'flexible', 'utilisation', 'utilization', 'occupancy'],
    tags: ['hybrid', 'utilisation'],
  },
  {
    id: 'move',
    label: 'Relocation',
    words: ['relocation', 'relocate', 'move', 'moving', 'consolidation', 'consolidate'],
    tags: ['relocation', 'consolidation'],
  },
  {
    id: 'wellbeing',
    label: 'Wellbeing',
    words: ['wellbeing', 'well-being', 'health', 'biophilic', 'daylight'],
    tags: ['wellbeing'],
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    words: ['portfolio', 'projects', 'showcase', 'gallery'],
    tags: ['portfolio'],
  },
  {
    id: 'framework',
    label: 'Frameworks and diagrams',
    words: ['framework', 'frameworks', 'diagram', 'diagrams', 'model'],
    tags: ['framework', 'diagram'],
  },
];

const STOP = new Set(
  'intro a an the for to of and or show me find need needs want looking look slide slides deck decks about from our we with in on that this is are any some please give get something one into by at my us i can you what which how do does work works have has had was were it its be using use large introduce pitch project recent latest newest newer whats most greatest best add include could would there where should'.split(
    ' ',
  ),
);

/** Filler words the rules never search for ("the", "show me", "slides"). */
export const isStopWord = (w: string) => STOP.has(w);

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '');
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[- ]');
const hasWord = (text: string, w: string) => new RegExp(`(^|[^a-z0-9])${esc(w)}([^a-z0-9]|$)`).test(text);

type Fields = {
  title: string;
  deck: string;
  client: string | null;
  year: number | null;
  category: string | null;
};
const fieldsOf = (s: SlideSummary): Fields => ({
  title: s.title,
  deck: s.provenance.sourceTitle,
  client: s.provenance.clientName ?? null,
  year: s.provenance.deckYear ?? null,
  category: s.provenance.category ?? null,
});
const hayOf = (f: Fields) => norm([f.title, f.deck, f.client ?? '', f.category ?? ''].join(' '));

/** Topic words found on the slide's title, deck name and category (rules only). */
function topicTags(s: SlideSummary): string[] {
  const hay = hayOf(fieldsOf(s));
  const category = s.provenance.category;
  const out: string[] = [];
  for (const c of CONCEPTS) {
    if (c.words.some((w) => hasWord(hay, w))) for (const t of c.tags) if (!out.includes(t)) out.push(t);
  }
  const cat = category?.toLowerCase();
  if (cat && !out.includes(cat)) out.push(cat);
  return out.slice(0, 4);
}

export type Chip = {
  key: string;
  kind: string;
  label: string;
  strip: string[];
};
export type Parsed = {
  chips: Chip[];
  tokens: string[];
  concepts: Concept[];
  client: string | null;
  year: number | null;
  recent: boolean;
};

/** How the rules read a search: topics, a client, a year, and leftover words. */
export function parseQuery(q: string, clients: string[]): Parsed {
  const nq = ` ${norm(q)
    .replace(/[^a-z0-9\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
  let rest = nq;
  const strip = (w: string) => {
    rest = rest.replace(new RegExp(` ${esc(w)} `, 'g'), '  ');
  };
  const P: Parsed = {
    chips: [],
    tokens: [],
    concepts: [],
    client: null,
    year: null,
    recent: false,
  };
  for (const c of CONCEPTS) {
    const hit = c.words.filter((w) => nq.includes(` ${norm(w)} `));
    if (!hit.length) continue;
    hit.sort((a, b) => b.length - a.length).forEach(strip);
    P.concepts.push(c);
    P.chips.push({
      key: `k:${c.id}`,
      kind: 'Topic',
      label: c.label,
      strip: hit,
    });
  }
  for (const name of clients) {
    const words = norm(name)
      .split(' ')
      .filter((w) => w.length >= 3 && w !== 'unknown' && w !== 'client');
    const hit = words.filter((w) => nq.includes(` ${w} `));
    if (hit.length && !P.client) {
      hit.forEach(strip);
      P.client = name;
      P.chips.push({ key: 'client', kind: 'Client', label: name, strip: hit });
    }
  }
  const ym = nq.match(/ (20\d\d) /);
  if (ym) {
    strip(ym[1]);
    P.year = Number(ym[1]);
    P.chips.push({ key: 'year', kind: 'Year', label: ym[1], strip: [ym[1]] });
  }
  const rec = ['recent', 'latest', 'newest', 'newer'].filter((w) => nq.includes(` ${w} `));
  if (rec.length) {
    rec.forEach(strip);
    P.recent = true;
    P.chips.push({
      key: 'recent',
      kind: 'Newest',
      label: 'Recent work',
      strip: rec,
    });
  }
  for (const w of rest.split(' ')) {
    if (w.length < 3 || STOP.has(w) || /^20\d\d$/.test(w)) continue;
    const t = w.length > 4 ? w.replace(/(es|s)$/, '') : w;
    if (!STOP.has(t) && !P.tokens.includes(t)) P.tokens.push(t);
  }
  return P;
}

/** The slide type a search topic (e.g. "Team and people") stands for, if it matches one of the fixed slide types. */
export function slideTypeForTopic(topic: string): string | null {
  const concept = CONCEPTS.find((k) => k.label === topic);
  return SLIDE_TYPES.find((t) => t.tag === concept?.tags[0])?.label ?? null;
}

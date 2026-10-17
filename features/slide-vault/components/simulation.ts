import type { SlideSummary } from '../contracts/dto';

/**
 * SIMULATED features, front end only (decision FD-14). The backend has no approval status, AI labels,
 * download counts or AI search yet, so these are worked out here from the slide's own id and text so
 * they stay the same on every visit. Every place that shows one carries the orange "Simulated" mark.
 * Nothing here is saved, sent anywhere, or read from a model.
 */

export type Tier = 'Approved' | 'Suggested' | 'Retired';

/** Plain-language names shown to people. The internal names (Suggested, Retired) stay in the code. */
export const TIER_LABEL: Record<Tier, string> = {
  Approved: 'Approved',
  Suggested: 'Awaiting approval',
  Retired: 'Out of date',
};

export const TIER_TEXT: Record<Tier, string> = {
  Approved: 'Approved: checked by a person and cleared for client use.',
  Suggested: 'Awaiting approval: added or labelled by AI. Not yet checked by a person.',
  Retired: 'Out of date: kept for records only. Can’t be downloaded.',
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function simTier(s: SlideSummary): Tier {
  if (s.provenance.bestOfTheBest) return 'Approved';
  const n = hash(`tier:${s.id}`) % 100;
  return n < 80 ? 'Approved' : n < 95 ? 'Suggested' : 'Retired';
}

/** Sample download count. */
export function simUsed(s: SlideSummary): number {
  return (hash(`used:${s.id}`) % 180) + (s.provenance.bestOfTheBest ? 120 : 0);
}

/** Access rules from the v3 table: Viewer sees Approved; Editor adds Suggested; Curator adds Retired. */
export function canSeeTier(tier: Tier, caps: ReadonlySet<string>): boolean {
  if (tier === 'Approved') return true;
  if (tier === 'Suggested') return caps.has('metadata.edit');
  return caps.has('content.retire');
}

export const visibleTiers = (caps: ReadonlySet<string>): Tier[] => (['Approved', 'Suggested', 'Retired'] as Tier[]).filter((t) => canSeeTier(t, caps));

/* ------------------------------------------------------- Slide types and people */

/**
 * Fixed list of slide types for the filter bar for now (the label the AI would suggest, matched to
 * the labels worked out below). When real decks are uploaded, this list grows from the tags added
 * to each upload.
 */
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

/** Does this slide carry the given slide-type label (simulated AI label)? */
export function simHasSlideType(s: SlideSummary, label: string): boolean {
  const tag = SLIDE_TYPES.find((t) => t.label === label)?.tag;
  return !!tag && simTags(s).includes(tag);
}

/** Sample names for "Uploaded by" and "Contributed by". Real names come from sign-in later. */
export const SIM_PEOPLE = ['Person A', 'Person B', 'Person C', 'Person D'];

export const simUploader = (s: SlideSummary) => SIM_PEOPLE[hash(`up:${s.provenance.sourceId}`) % SIM_PEOPLE.length];
export const simContributor = (s: SlideSummary) => SIM_PEOPLE[hash(`con:${s.provenance.sourceId}`) % SIM_PEOPLE.length];

/* ------------------------------------------------------------ Smart search */

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
  'intro a an the for to of and or show me find need needs want looking look slide slides deck decks about from our we with in on that this is are any some please give get something one into by at my us i can you what which how do does work works have has had was were it its be using use large introduce pitch project recent latest newest newer'.split(
    ' ',
  ),
);

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

/** Labels the AI would suggest, worked out from the slide title, deck name and category. */
export function simTags(s: SlideSummary): string[] {
  return simTagsFromText(hayOf(fieldsOf(s)), s.provenance.category);
}

export function simTagsFromText(text: string, category?: string | null): string[] {
  const hay = norm(text);
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

/** How the simulated AI "reads" a sentence: topics, a client, a year, and leftover words. */
export function simParse(q: string, clients: string[]): Parsed {
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
    if (!P.tokens.includes(t)) P.tokens.push(t);
  }
  return P;
}

/** The slide type a "Topic" chip stands for, if it matches one of the fixed slide types. */
export function slideTypeForChip(P: Parsed, chip: Chip): string | null {
  if (chip.kind !== 'Topic') return null;
  const concept = P.concepts.find((k) => `k:${k.id}` === chip.key);
  return SLIDE_TYPES.find((t) => t.tag === concept?.tags[0])?.label ?? null;
}

/** Client, year and slide type are shown in the filter row under the search box, so results needn't repeat them. */
export const chipShownInFilterRow = (P: Parsed, chip: Chip) => chip.key === 'client' || chip.key === 'year' || slideTypeForChip(P, chip) !== null;

/** Remove the words a chip stood for from the typed search, so "removing the chip" changes the search. */
export function stripFromQuery(q: string, chip: Chip): string {
  let out = ` ${q} `;
  for (const w of chip.strip) out = out.replace(new RegExp(`(^|[^A-Za-z0-9])${esc(w)}(?![A-Za-z0-9])`, 'gi'), '$1 ');
  return out.replace(/\s+/g, ' ').trim();
}

export type SimResult = { slide: SlideSummary; score: number; why: string };

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const listJoin = (a: string[]) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : (a[0] ?? ''));

/**
 * Score every slide against the parsed request, add a bonus for real keyword hits from the server
 * (`realIds`), and write a short "why it fits" line for each one.
 */
export function simSearch(P: Parsed, slides: SlideSummary[], realIds: ReadonlySet<string>): SimResult[] {
  const hasTerms = P.concepts.length > 0 || P.tokens.length > 0;
  const out: SimResult[] = [];
  for (const s of slides) {
    const f = fieldsOf(s);
    if (P.client && (f.client ?? '') !== P.client) continue;
    if (P.year && f.year !== P.year) continue;
    const hay = hayOf(f);
    const title = norm(f.title);
    const tags = simTags(s);
    const why: string[] = [];
    let sc = 0;
    for (const c of P.concepts) {
      const tg = c.tags.filter((t) => tags.includes(t));
      if (tg.length) {
        sc += 2 * Math.min(2, tg.length);
        why.push(`covers ${tg[0]}`);
      } else {
        const w = c.words.find((x) => hasWord(hay, norm(x)));
        if (w) {
          sc += 1.5;
          why.push(`mentions “${w}”`);
        }
      }
    }
    for (const t of P.tokens) {
      if (title.includes(t)) {
        sc += 2;
        why.push(`has “${t}” in its title`);
      } else if (hay.includes(t)) {
        sc += 1;
        why.push(`mentions “${t}”`);
      } else if (realIds.has(s.id)) {
        sc += 1;
        why.push(`mentions “${t}” in its text`);
      }
    }
    if (realIds.has(s.id)) sc += 2.5;
    if (!hasTerms) sc = 1;
    if (sc <= 0) continue;
    let lead = '';
    if (P.client && P.year) lead = `From ${P.client}, made in ${P.year}.`;
    else if (P.client) lead = `From ${P.client}.`;
    else if (P.year) lead = `Made in ${P.year}.`;
    if (P.recent && (f.year ?? 0) >= new Date().getFullYear() - 1) sc += 1;
    if (simTier(s) === 'Suggested') sc -= 0.4;
    sc += simUsed(s) / 400;
    const uniq = [...new Set(why)].slice(0, 3);
    if (!uniq.length && !hasTerms) uniq.push('matches your filters');
    const body = uniq.length ? `${cap(listJoin(uniq))}.` : '';
    out.push({
      slide: s,
      score: sc,
      why: [lead, body].filter(Boolean).join(' '),
    });
  }
  const top = out.reduce((m, x) => Math.max(m, x.score), 0);
  const cut = Math.max(1, top * 0.4);
  return out.filter((x) => x.score >= cut);
}

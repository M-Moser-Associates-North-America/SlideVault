import 'server-only';

/**
 * The reasoning map: how someone preparing a proposal thinks, written down once so search can
 * follow it for free instead of asking a model every time (docs/DECISIONS.md FD-20).
 *
 *   situation  ->  what they need to show  ->  slide types that show it  ->  slides
 *
 * Slide-type groups follow M Moser's own headings for their example searches (About M Moser,
 * General Design, IDD, Methodology, MSA, SME, Case studies). Words are matched against slide
 * text and, once they exist, slide descriptions; keep them lowercase.
 *
 * Every entry starts as `draft`. A person moves it to `reviewed` once it has been checked
 * against real decks. Edit freely: test:reasoning-map checks every reference still resolves.
 */

export type MapStatus = 'draft' | 'reviewed';

export type SlideGroup = 'About M Moser' | 'General Design' | 'IDD' | 'Methodology' | 'MSA' | 'SME' | 'Case studies';

export type SlideType = {
  id: string;
  label: string;
  group: SlideGroup;
  /** Words or phrases likely on (or describing) a slide of this type */
  words: string[];
  status: MapStatus;
};

export type Need = {
  id: string;
  /** What the person has to convince the client of, in plain words */
  label: string;
  slideTypes: string[];
  status: MapStatus;
};

export type Situation = {
  id: string;
  label: string;
  /** How someone at M Moser might actually say it */
  example: string;
  /** Words or phrases that signal this situation; two or more matching is a confident match */
  triggers: string[];
  needs: string[];
  status: MapStatus;
};

export const SLIDE_TYPES: SlideType[] = [
  // About M Moser
  { id: 'company-overview', label: 'Company overview', group: 'About M Moser', words: ['about us', 'who we are', 'overview', 'our story', 'at a glance'], status: 'draft' },
  { id: 'regional-overview', label: 'Regional overview', group: 'About M Moser', words: ['north america', 'americas', 'emea', 'asia', 'regional', 'region'], status: 'draft' },
  { id: 'office-map', label: 'Map of our offices', group: 'About M Moser', words: ['map', 'our offices', 'locations', 'global presence', 'studios'], status: 'draft' },
  { id: 'people-profile', label: 'Person profile or photo', group: 'About M Moser', words: ['photo', 'portrait', 'profile', 'principal', 'director', 'leadership'], status: 'draft' },
  // General Design
  { id: 'roles-responsibilities', label: 'Roles and responsibilities', group: 'General Design', words: ['roles', 'responsibilities', 'raci', 'who does what'], status: 'draft' },
  { id: 'team-intro', label: 'Team introduction', group: 'General Design', words: ['our team', 'meet the team', 'project team', 'your team', 'key people'], status: 'draft' },
  // IDD
  { id: 'idd-overview', label: 'IDD overview', group: 'IDD', words: ['integrated design delivery', 'idd', 'design and build', 'single point'], status: 'draft' },
  { id: 'delivery-options', label: 'Delivery options table', group: 'IDD', words: ['options', 'comparison', 'compare', 'table', 'procurement routes'], status: 'draft' },
  { id: 'phasing-timeline', label: 'Phasing or timeline (waterfall)', group: 'IDD', words: ['waterfall', 'timeline', 'programme', 'program', 'schedule', 'phasing', 'phases', 'gantt', 'milestones'], status: 'draft' },
  // Methodology
  { id: 'qa-qc', label: 'QA/QC', group: 'Methodology', words: ['qa/qc', 'quality assurance', 'quality control', 'inspection', 'snagging', 'punch list'], status: 'draft' },
  { id: 'section-banner', label: 'Section banner', group: 'Methodology', words: ['banner', 'divider', 'section'], status: 'draft' },
  { id: 'site-logistics', label: 'Site logistics and safety', group: 'Methodology', words: ['logistics', 'site safety', 'health and safety', 'hoarding', 'out of hours', 'noise', 'access plan'], status: 'draft' },
  // MSA
  { id: 'org-chart', label: 'Org chart', group: 'MSA', words: ['org chart', 'organisation chart', 'organization chart', 'structure', 'reporting lines', 'multiple locations'], status: 'draft' },
  { id: 'service-model', label: 'Service model', group: 'MSA', words: ['master service agreement', 'msa', 'service model', 'account management', 'framework'], status: 'draft' },
  // SME
  { id: 'sector-expertise', label: 'Sector expertise', group: 'SME', words: ['hospitality', 'hotel', 'financial services', 'banking', 'legal', 'law firm', 'technology', 'healthcare', 'life sciences'], status: 'draft' },
  { id: 'additional-services', label: 'Additional services', group: 'SME', words: ['additional services', 'our services', 'capabilities', 'what we do'], status: 'draft' },
  { id: 'branding-services', label: 'Branding services', group: 'SME', words: ['branding', 'brand', 'experiential graphics', 'wayfinding'], status: 'draft' },
  { id: 'sustainability-services', label: 'Sustainability services', group: 'SME', words: ['sustainability', 'esg', 'leed', 'well', 'net zero', 'carbon'], status: 'draft' },
  { id: 'change-management', label: 'Change management', group: 'SME', words: ['change management', 'adoption', 'engagement', 'occupant experience', 'move management'], status: 'draft' },
  // Case studies
  { id: 'case-study', label: 'Case study', group: 'Case studies', words: ['case study', 'case studies', 'project', 'completed', 'client:'], status: 'draft' },
  { id: 'case-study-stats', label: 'Case study results and stats', group: 'Case studies', words: ['stats', 'statistics', 'numbers', 'results', 'outcomes', 'savings', 'sq ft', 'square feet', 'reduction', 'increase', '%'], status: 'draft' },
  { id: 'case-study-challenge', label: 'Case study: challenge and approach', group: 'Case studies', words: ['challenge', 'challenges', 'approach', 'solution', 'constraints'], status: 'draft' },
  { id: 'occupied-building-case', label: 'Case study in an occupied building', group: 'Case studies', words: ['occupied', 'live environment', 'business as usual', 'phased', 'out of hours', 'existing tenant'], status: 'draft' },
];

export const NEEDS: Need[] = [
  { id: 'speed', label: 'We can deliver fast', slideTypes: ['phasing-timeline', 'idd-overview'], status: 'draft' },
  { id: 'minimal-disruption', label: 'We will not disrupt the people already in the building', slideTypes: ['site-logistics', 'occupied-building-case', 'phasing-timeline'], status: 'draft' },
  { id: 'proven-experience', label: 'We have done this before', slideTypes: ['occupied-building-case', 'case-study', 'case-study-stats'], status: 'draft' },
  { id: 'right-team', label: 'The right people will run it', slideTypes: ['team-intro', 'roles-responsibilities', 'org-chart'], status: 'draft' },
  { id: 'quality', label: 'The work will be done right', slideTypes: ['qa-qc'], status: 'draft' },
  { id: 'who-we-are', label: 'Who M Moser is', slideTypes: ['company-overview', 'regional-overview', 'office-map'], status: 'draft' },
];

export const SITUATIONS: Situation[] = [
  {
    id: 'short-occupied-fitout',
    label: 'Short contract in a building that is already occupied',
    example: 'We just won a 30-day contract in a building that already has another tenant. Which slides should I start with?',
    triggers: ['30-day', '30 day', 'short contract', 'short-term', 'short term', 'tight deadline', 'occupied', 'another tenant', 'existing tenant', 'shared building', 'live building'],
    needs: ['speed', 'minimal-disruption', 'proven-experience', 'right-team'],
    status: 'draft',
  },
];

/** Every broken reference or duplicate id in the map, as plain sentences; empty when the map is sound. */
export function mapProblems(map = { slideTypes: SLIDE_TYPES, needs: NEEDS, situations: SITUATIONS }): string[] {
  const problems: string[] = [];
  const dupes = (kind: string, ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => problems.push(`${kind} "${id}" is listed twice`));
  dupes('Slide type', map.slideTypes.map((t) => t.id));
  dupes('Need', map.needs.map((n) => n.id));
  dupes('Situation', map.situations.map((s) => s.id));
  const typeIds = new Set(map.slideTypes.map((t) => t.id));
  const needIds = new Set(map.needs.map((n) => n.id));
  for (const n of map.needs) for (const t of n.slideTypes) if (!typeIds.has(t)) problems.push(`Need "${n.id}" points to a missing slide type "${t}"`);
  for (const s of map.situations) {
    for (const n of s.needs) if (!needIds.has(n)) problems.push(`Situation "${s.id}" points to a missing need "${n}"`);
    if (s.triggers.length < 2) problems.push(`Situation "${s.id}" needs at least two trigger words`);
  }
  for (const t of map.slideTypes) {
    if (!t.words.length) problems.push(`Slide type "${t.id}" has no words`);
    for (const w of t.words) if (w !== w.toLowerCase()) problems.push(`Slide type "${t.id}" word "${w}" should be lowercase`);
  }
  return problems;
}

/** True when the phrase appears in the text as whole words ("map" matches "the map", not "mapping"). */
export function hasPhrase(text: string, phrase: string): boolean {
  const esc = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(text.toLowerCase());
}

/** Slide types whose words appear in the text, most matching words first. */
export function slideTypesIn(text: string, types = SLIDE_TYPES): SlideType[] {
  return types
    .map((t) => ({ t, n: t.words.filter((w) => hasPhrase(text, w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.t);
}

/** Situations with at least two trigger words in the text, most triggers first. */
export function situationsIn(text: string, situations = SITUATIONS): Situation[] {
  return situations
    .map((s) => ({ s, n: s.triggers.filter((w) => hasPhrase(text, w)).length }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.s);
}

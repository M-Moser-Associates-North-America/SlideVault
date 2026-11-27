/**
 * The labels the team put on slides (Schiffon's review: slide type, theme, the sector a case study proves),
 * as a menu the AI reader can pick from (docs/DECISIONS.md FD-83). The regular search turns words into
 * labels with fixed word lists, so a request worded another way ("people coming back to the office") gets
 * no help from them. The AI reads the request and names the labels it points at; those are added to what
 * the rules found, and the usual search, scoring and filters do the rest. Only these names go to the AI,
 * never slide text, and whatever it returns is checked against this menu.
 *
 * FOR NOW the menu is what exists, with no clean-up: the 29 slide types in use, the sector names the rules
 * already know, and the themes that are clearly the curated ones (the most-used in the database on 3 Nov).
 * The thousands of other theme values are left out, and near-duplicates are not merged. Schiffon to review;
 * see NOTES.md, hand-off notes.
 */

export type LabelMenu = { types: { value: string; meaning: string }[]; themes: string[]; sectors: string[] };
/** What the AI picked, each value copied from the menu */
export type PlanLabels = { types: string[]; themes: string[]; sectors: string[] };
/** The reader's raw answer, before it is checked against the menu */
export type RawLabels = { slideTypes?: unknown; themes?: unknown; sectors?: unknown };

export const MAX_LABEL_TYPES = 2;
export const MAX_LABEL_THEMES = 3;
export const MAX_LABEL_SECTORS = 2;

/** Slide types as the reviewed metadata names them, with a plain meaning the AI can match a request to. */
const TYPES: [string, string][] = [
  ['cover', 'a cover or title slide'],
  ['cover_letter', 'a cover letter'],
  ['table_of_contents', 'a contents page or agenda'],
  ['section_divider', 'a section banner or divider'],
  ['firm_profile', 'about the firm: who M Moser is'],
  ['differentiator', 'what sets M Moser apart'],
  ['capability_service', 'a capability or service M Moser offers'],
  ['client_understanding', 'our understanding of the client and what they need'],
  ['approach_process', 'how we approach and deliver the work'],
  ['process_technology', 'delivery process and technology, such as VDC'],
  ['design_concept', 'a design concept'],
  ['planning_testfit', 'space planning or a test fit'],
  ['scope_assumptions', 'scope and assumptions'],
  ['schedule', 'a schedule or timeline'],
  ['fees_commercial', 'fees and commercial terms'],
  ['risk_governance', 'risk and governance'],
  ['team_structure', 'the project team structure or org chart'],
  ['team_time_allocation', 'how team members’ time is allocated'],
  ['team_resume', 'a team member’s résumé or bio'],
  ['case_study_hero', 'the opening banner of a case study'],
  ['case_study_detail', 'the detail of one past project (a case study)'],
  ['image_gallery', 'project photography'],
  ['client_references', 'client references and testimonials'],
  ['client_logos', 'a wall of client logos'],
  ['certifications_esg', 'certifications and ESG credentials'],
  ['awards', 'awards and recognition'],
  ['rfp_worksheet', 'an RFP worksheet or questionnaire answers'],
  ['legal_admin', 'legal or administrative pages'],
  ['closing', 'a closing or thank-you slide'],
];

/** Exactly as stored on slides (themes are matched as written), the curated ones only. */
const THEMES = [
  'sustainability / net zero',
  'masterplanning & portfolio strategy',
  'hybrid / flexible work',
  'workplace strategy & data',
  'cost certainty & risk',
  'health & wellbeing',
  'technology & smart building',
  'inclusion & DEI',
  'brand experience',
  'amenities & hospitality',
  'global-local delivery',
  'VDC / 3D process',
  'interconnecting stair / vertical connection',
  'design & build delivery',
  'AI',
  'heritage / adaptive reuse',
];

/** The menu to give the reader. `sectors` are the names the rules already use (each also matches longer ones, "retail" and "retail / consumer"). */
export function labelMenu(sectors: string[]): LabelMenu {
  return { types: TYPES.map(([value, meaning]) => ({ value, meaning })), themes: [...THEMES], sectors: [...sectors] };
}

const pickAll = (raw: unknown, from: string[], max: number): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const found = from.find((x) => x.toLowerCase() === v.trim().toLowerCase());
    if (found && !out.includes(found)) out.push(found);
    if (out.length >= max) break;
  }
  return out;
};

/** Keeps only values that are on the menu, copied as the menu spells them, and only a few of each kind. */
export function cleanLabels(raw: RawLabels, menu: LabelMenu): PlanLabels {
  return {
    types: pickAll(raw.slideTypes, menu.types.map((t) => t.value), MAX_LABEL_TYPES),
    themes: pickAll(raw.themes, menu.themes, MAX_LABEL_THEMES),
    sectors: pickAll(raw.sectors, menu.sectors, MAX_LABEL_SECTORS),
  };
}

export const hasLabels = (l: PlanLabels | undefined): l is PlanLabels => !!l && l.types.length + l.themes.length + l.sectors.length > 0;

/** What a search asks for in labels: the rules' own reading plus the AI's, each once. */
export function mergeLabels<I extends { types: string[]; sectors: string[]; themes: string[] }>(intent: I, labels: PlanLabels | undefined): I {
  if (!hasLabels(labels)) return intent;
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  return { ...intent, types: union(intent.types, labels.types), themes: union(intent.themes, labels.themes), sectors: union(intent.sectors, labels.sectors.map((s) => s.toLowerCase())) };
}

/** The labels the AI picked, for the database search to weigh more than the rules' own guesses (FD-83). */
export const aiPicks = (labels: PlanLabels | undefined) => (hasLabels(labels) ? { themes: labels.themes, sectors: labels.sectors.map((s) => s.toLowerCase()) } : undefined);

/** A label as a person reads it: "case_study_detail" is "Case study detail", "health & wellbeing" is "Health & wellbeing". */
export const labelName = (value: string) => {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

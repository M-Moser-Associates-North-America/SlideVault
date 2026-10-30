/**
 * Reasoning map checks (docs/DECISIONS.md FD-20): the map holds together, and M Moser's own
 * example searches reach the slide type a person would expect. No database, no model.
 *
 *   npm run test:reasoning-map
 */
import { mapProblems, NEEDS, situationsIn, slideTypesIn, SITUATIONS, SLIDE_TYPES } from '../features/slide-vault/server/ai/reasoning-map';

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

const problems = mapProblems();
check(problems.length === 0, 'map: every reference resolves, no duplicate ids', problems);
check(mapProblems({ slideTypes: SLIDE_TYPES, needs: [{ id: 'x', label: 'x', slideTypes: ['nope'], status: 'draft' }], situations: [] }).length === 1, 'map: a broken reference is caught');

// M Moser's example searches (business development team, 2026-10-20) and the slide type each should reach.
const EXAMPLES: [string, string][] = [
  ['Can we add the North America Overview', 'regional-overview'],
  ['Can we add the slide with Priya’s photo', 'people-profile'],
  ['Can you add the map with all our offices', 'office-map'],
  ['Can we include the roles and responsibility slide?', 'roles-responsibilities'],
  ['What are the most recent/greatest IDD slides?', 'idd-overview'],
  ['Can you add the IDD slide with a table showing our different options?', 'delivery-options'],
  ['Can we add the slide that looks like a waterfall?', 'phasing-timeline'],
  ['Do we have a QA/QC slide?', 'qa-qc'],
  ['Can you add the banner?', 'section-banner'],
  ['Can we add the org chart with multiple locations and services?', 'org-chart'],
  ['What is our most recent hospitality deck?', 'sector-expertise'],
  ['Can we add our additional services slides?', 'additional-services'],
  ['Can you find a page explaining our branding or sustainability services?', 'branding-services'],
  ['Can you add our ‘change management’ slides?', 'change-management'],
  ['Can you find any stats for case studies?', 'case-study-stats'],
  ['Can you find any case studies were we talk about challenges?', 'case-study-challenge'],
];
let hits = 0;
for (const [q, want] of EXAMPLES) {
  const got = slideTypesIn(q.replace(/[’‘]/g, "'")).map((t) => t.id);
  const ok = got.includes(want);
  if (ok) hits++;
  check(ok, `example: "${q}" reaches ${want}`, got);
}
console.log(`\nExample searches reaching the expected slide type: ${hits} of ${EXAMPLES.length}`);

// Situations
const short = situationsIn(SITUATIONS[0].example);
check(short[0]?.id === 'short-occupied-fitout', 'situation: the 30-day example is recognised without a model', short.map((s) => s.id));
check(situationsIn('Can we add the banner?').length === 0, 'situation: a plain "find" request matches no situation');
check(situationsIn('we have an occupied floor').length === 0, 'situation: one trigger word alone is not enough');
{
  const s = SITUATIONS[0];
  const types = new Set(s.needs.flatMap((n) => NEEDS.find((x) => x.id === n)?.slideTypes ?? []));
  check(types.has('phasing-timeline') && types.has('occupied-building-case') && types.has('site-logistics'), 'situation: the 30-day example leads to timeline, occupied-building case study and logistics slides', [...types]);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll reasoning map checks passed');
process.exit(failures ? 1 : 0);

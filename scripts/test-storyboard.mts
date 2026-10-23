/**
 * Storyboard checks (docs/DECISIONS.md FD-22). No database and no real model: the library search
 * and the AI reader are fakes, so every rule can be checked exactly.
 *
 *   npm run test:storyboard
 */
import type { SlideSummary } from '../features/slide-vault/contracts/dto';
import type { SearchPlan, SlideFacts } from '../features/slide-vault/server/ai/search-plan';
import { cleanStoryPlan, missingContext, openAiCompatibleStoryReader, standInStory, STORY_ROLES, type StoryReader } from '../features/slide-vault/server/ai/storyboard';
import { buildStoryboard, clientSectors, situationTopics } from '../features/slide-vault/server/services/storyboard';

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

// A tiny fake library: each slide is found when the search asks for any word in its title.
const LIB = [
  { id: 's-challenge', title: 'Understanding your objectives and challenge', text: 'Your goals for the new headquarters.' },
  { id: 's-phasing', title: 'Phasing and programme', text: 'A phased approach keeps the business running.' },
  { id: 's-case', title: 'Case study: occupied building refurbishment', text: 'Project completed with results for the client.' },
  { id: 's-case2', title: 'Case study: hospital project', text: 'Results after the project completed.' },
  { id: 's-team', title: 'Meet the team', text: 'Our people and leadership.' },
];
const slide = (id: string, title: string): SlideSummary => ({
  id, title, hiddenInSource: false, previewPath: `/slides/${id}/preview`,
  provenance: { sourceId: 'd', sourceVersionId: 'v', sourceTitle: 'Sample deck', sourceFileName: 'sample.pptx', slideNumber: 1, owner: null, approvalStatus: null, reviewedAt: null },
});
const searches: SearchPlan[] = [];
const search = async (plan: SearchPlan) => {
  searches.push(plan);
  return LIB.filter((s) => plan.keywords.some((k) => `${s.title} ${s.text}`.toLowerCase().includes(k)))
    .map((s) => ({ summary: slide(s.id, s.title), facts: { title: s.title, text: s.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts }));
};

const situation = 'We just won a 30-day contract to refit a floor in a building that already has another tenant. The client is a bank.';

// ---- Rules only (no AI)
{
  const r = await buildStoryboard(situation, { search });
  check(r.reader === 'rules' && r.readerNote === null, 'rules: no AI set up means the standard story, with no warning');
  check(JSON.stringify(r.sections.map((s) => s.role)) === JSON.stringify(STORY_ROLES), 'rules: the story runs client first: challenge, insight, approach, proof, why us, outcome', r.sections.map((s) => s.role));
  const ids = r.sections.flatMap((s) => s.items.map((i) => i.slide.id));
  check(new Set(ids).size === ids.length, 'rules: each slide is used once in the whole story', ids);
  check(r.sections.find((s) => s.role === 'client-challenge')!.items[0]?.slide.id === 's-challenge', 'rules: the challenge part opens with the slide about the client\'s objectives');
  check(r.sections.find((s) => s.role === 'insight')!.gap, 'rules: a part with no matching slide is flagged as a gap, not filled with a weak match');
  check(r.sections.every((s) => s.items.every((i) => i.why.length > 0 && !i.why.includes(s.need))), 'rules: every slide has a reason, and it does not repeat what the part must show', r.sections.map((s) => s.items.map((i) => i.why)));
  const proof = r.sections.find((s) => s.role === 'experience')!.items[0];
  check(/Does this part's job: .*“case study”/.test(proof?.why ?? '') && proof?.reasons.part.includes('case study'), "rules: the reason says what on the slide does this part's job", proof);
  check(searches.some((p) => p.keywords.includes('phasing')), 'rules: a known situation (short contract, occupied building) adds phasing to the approach search', searches.map((p) => p.keywords));
}

// ---- The client's own topics
{
  const t = situationTopics("We're pitching a workplace refit for a financial services firm that wants to move to a hybrid way of working. Leadership worries staff will resist losing their own desks, and the board wants sustainability and cost savings.");
  check(['hybrid', 'desk', 'sustainability', 'cost'].every((w) => t.includes(w)), 'topics: the client\'s real topics (hybrid, desks, sustainability, cost) are all searched', t);
  check(!['pitching', 'wants', 'way', 'losing', 'their', 'board'].some((w) => t.includes(w)), 'topics: filler about the pitch is left out', t);
}

check(JSON.stringify(situationTopics('Hospital campuses need studies and process analysis')) === JSON.stringify(['hospital', 'campus', 'study', 'process', 'analysis']), 'topics: plurals made singular properly (campuses, studies), "process" and "analysis" kept', situationTopics('Hospital campuses need studies and process analysis'));

// ---- What the local model read on each slide (FD-26)
{
  const LIB2 = [
    { id: 'k-plain', title: 'Three sites, one culture', text: 'Merging teams across campuses.' },
    { id: 'k-divider', title: 'Case studies', text: '' },
    { id: 'k-case', title: 'Case study: clinic refit', text: 'Project completed with results.' },
  ];
  const readings = new Map([
    ['k-plain', { role: 'client-challenge', topics: ['merger'], about: 'Shows a hospital group merging three campuses and the risk to patient care.' }],
    ['k-divider', { role: 'divider', topics: [], about: 'A section divider.' }],
    ['k-case', { role: 'experience', topics: ['healthcare'], about: 'A completed clinic project.' }],
  ]);
  const rowOf = (s: (typeof LIB2)[number]) => ({ summary: slide(s.id, s.title), facts: { title: s.title, text: s.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts });
  const search2 = async (plan: SearchPlan) => LIB2.filter((s) => plan.keywords.some((k) => `${s.title} ${s.text}`.toLowerCase().includes(k))).map(rowOf);
  const knowledge = { of: (id: string) => readings.get(id), forPart: async (role: string) => LIB2.filter((s) => readings.get(s.id)?.role === role).map(rowOf) };
  const without = await buildStoryboard('A hospital group is merging three campuses.', { search: search2 });
  const withIt = await buildStoryboard('A hospital group is merging three campuses.', { search: search2, knowledge });
  const challenge = (r: typeof withIt) => r.sections.find((x) => x.role === 'client-challenge')!;
  check(challenge(without).gap && challenge(withIt).items[0]?.slide.id === 'k-plain', "knowledge: a slide read as the client's challenge fills that part even without the part's words", [challenge(without).items.length, challenge(withIt).items.map((i) => i.slide.id)]);
  check(/Read as: shows the client's challenge/.test(challenge(withIt).items[0]?.why ?? '') && /Matches your brief: .*hospital/.test(challenge(withIt).items[0]?.why ?? ''), 'knowledge: the reason says how it was read, and the brief matches what the slide is about', challenge(withIt).items[0]?.why);
  const proof = withIt.sections.find((x) => x.role === 'experience')!;
  check(!withIt.sections.some((x) => x.items.some((i) => i.slide.id === 'k-divider')) && proof.items[0]?.slide.id === 'k-case', 'knowledge: a divider titled "Case studies" is never used as proof', proof.items.map((i) => i.slide.id));
}

// ---- Reviewed slide metadata (FD-28): roles that hold, and slides that never go in a story
{
  const LIB3 = [
    { id: 'm-resume', title: 'Designer profile', text: 'Hospital merging campuses challenge: led three hospital campus projects.' },
    { id: 'm-worksheet', title: 'RFP worksheet', text: 'Hospital merging campuses challenge: internal submission checklist.' },
    { id: 'm-leftover', title: 'Case study: hospital campus', text: 'Hospital merging campuses project for another client, completed with results.' },
    { id: 'm-challenge', title: 'Three campuses, one hospital', text: 'Hospital merging campuses: what is at stake for staff.' },
    { id: 'm-case', title: 'Case study: clinic network', text: 'Hospital campus project completed with results.' },
  ];
  const readings = new Map<string, { role: string; topics: string[]; about: string; reviewed?: boolean; reuse?: string; flags?: string[] }>([
    ['m-resume', { role: 'admin', topics: [], about: '', reviewed: true, reuse: 'reusable - check currency' }],
    ['m-worksheet', { role: 'admin', topics: [], about: '', reviewed: true, reuse: 'internal - never show' }],
    ['m-leftover', { role: 'experience', topics: ['healthcare'], about: '', reviewed: true, reuse: 'reusable', flags: ['names another client / leftover placeholder'] }],
    ['m-challenge', { role: 'client-challenge', topics: [], about: '', reviewed: true, reuse: 'client-specific - reference only' }],
    ['m-case', { role: 'experience', topics: ['healthcare'], about: '', reviewed: true, reuse: 'reusable' }],
  ]);
  const rowOf = (s: (typeof LIB3)[number]) => ({ summary: slide(s.id, s.title), facts: { title: s.title, text: s.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts });
  const search3 = async (plan: SearchPlan) => LIB3.filter((s) => plan.keywords.some((k) => `${s.title} ${s.text}`.toLowerCase().includes(k))).map(rowOf);
  const knowledge = { of: (id: string) => readings.get(id), forPart: async (role: string) => LIB3.filter((s) => readings.get(s.id)?.role === role).map(rowOf) };
  const r = await buildStoryboard('A hospital group is merging three campuses.', { search: search3, knowledge });
  const placed = r.sections.flatMap((x) => x.items.map((i) => `${x.role}:${i.slide.id}`));
  const part = (role: string) => r.sections.find((x) => x.role === role)!.items.map((i) => i.slide.id);
  check(!placed.some((p) => p.endsWith(':m-resume')), "metadata: a team résumé that matches the brief's words is never placed in the story", placed);
  check(!placed.some((p) => p.endsWith(':m-worksheet')), 'metadata: an "internal - never show" slide never appears', placed);
  check(!placed.some((p) => p.endsWith(':m-leftover')), 'metadata: a slide that still names another client never appears', placed);
  check(JSON.stringify(part('client-challenge')) === '["m-challenge"]' && part('experience').includes('m-case'), 'metadata: reviewed slides fill only their own part', placed);
  const learned = async () => new Map([['client-challenge:m-case', { useful: 2, notRight: 0 }]]);
  const r2 = await buildStoryboard('A hospital group is merging three campuses.', { search: search3, knowledge, learned });
  const leftoverAfterVotes = await buildStoryboard('A hospital group is merging three campuses.', { search: search3, knowledge, learned: async () => new Map([['experience:m-leftover', { useful: 5, notRight: 0 }]]) });
  check(r2.sections.find((x) => x.role === 'client-challenge')!.items.some((i) => i.slide.id === 'm-case'), 'metadata: colleagues marking a slide useful for a part still overrides its reviewed role', r2.sections.map((x) => [x.role, x.items.map((i) => i.slide.id)]));
  check(!leftoverAfterVotes.sections.some((x) => x.items.some((i) => i.slide.id === 'm-leftover')), 'metadata: no number of votes brings back a slide that names another client');
}
{
  // Proof from the client's own sector leads, even when another case study matches more words.
  const LIB4 = [
    { id: 'p-bank', title: 'Case study: bank campus', text: 'Merging campuses project completed with results: three campuses, one story, on budget.' },
    { id: 'p-health', title: 'Case study: clinic network', text: 'Campus project completed with results.' },
  ];
  const sectors = new Map([['p-bank', 'financial services'], ['p-health', 'healthcare / life sciences']]);
  const rowOf = (s: (typeof LIB4)[number]) => ({ summary: slide(s.id, s.title), facts: { title: s.title, text: s.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts });
  const search4 = async (plan: SearchPlan) => LIB4.filter((s) => plan.keywords.some((k) => `${s.title} ${s.text}`.toLowerCase().includes(k))).map(rowOf);
  const knowledge = {
    of: (id: string) => (sectors.has(id) ? { role: 'experience', topics: [], about: '', reviewed: true, reuse: 'reusable', sectors: [sectors.get(id)!] } : undefined),
    forPart: async (role: string) => (role === 'experience' ? LIB4.map(rowOf) : []),
  };
  check(JSON.stringify(clientSectors('A hospital group is merging three campuses.')) === '["healthcare"]', 'sector: "hospital" reads as a healthcare client');
  const r = await buildStoryboard('A hospital group is merging three campuses on budget.', { search: search4, knowledge });
  const proof = r.sections.find((x) => x.role === 'experience')!;
  check(proof.items[0]?.slide.id === 'p-health', 'sector: a healthcare case study leads the proof for a hospital client', proof.items.map((i) => i.slide.id));
  check(Boolean(proof.items[0]?.why.includes('Same sector as your client')), 'sector: the slide says why it leads', proof.items[0]?.why);
}

// ---- Clarifying questions
check(missingContext(situation).length === 3, 'questions: a short situation gets asked about the audience, the worry and what a win looks like', missingContext(situation));
check(missingContext('The board and CFO worry about disruption; the goal is a low-cost, fast fit-out.').length === 0, 'questions: a situation that already says them gets no questions');
{
  const r = await buildStoryboard(situation, { search }, { answers: 'The board will be there; they worry about disruption to their staff.' });
  check(r.questions.length === 0, 'questions: once answered, they are not asked again');
}

// ---- With an AI reader
{
  const reader: StoryReader = { name: 'fake', plan: async () => cleanStoryPlan({ summary: 'A bank needs a quick fit-out without disrupting staff.', questions: ['Who is the audience?'], sections: [
    { role: 'client-challenge', title: 'Keeping the bank running', need: 'Show we understand they cannot stop work.', words: ['objectives'] },
    { role: 'experience', title: 'We have done this in live buildings', need: 'Show work in occupied buildings.', words: ['occupied', 'case study'] },
    { role: 'nonsense' as never, title: 'x', need: 'x', words: ['x'] },
  ] }) };
  const r = await buildStoryboard(situation, { search, reader }, { read: true });
  check(r.reader === 'model' && JSON.stringify(r.sections.map((s) => s.role)) === JSON.stringify(STORY_ROLES), 'ai: the whole story in order, an unknown role dropped and missing parts added', r.sections.map((s) => s.role));
  const proof = r.sections.find((s) => s.role === 'experience')!;
  check(proof.items.some((i) => i.slide.id === 's-case'), 'ai: the proof part finds the occupied-building case study', proof.items.map((i) => i.slide.id));
  check(proof.title === 'We have done this in live buildings' && proof.label === "Proof we've done this", 'ai: the model\'s heading is kept next to the standard label');
}
{
  const failing: StoryReader = { name: 'fake', plan: async () => { throw new Error('timeout'); } };
  const r = await buildStoryboard(situation, { search, reader: failing, log: () => {} }, { read: true });
  check(r.reader === 'rules' && Boolean(r.readerNote) && r.sections.length === 6, 'ai: if the model fails, the standard story is used and the screen is told');
  const notAsked = await buildStoryboard(situation, { search, reader: failing }, { read: false });
  check(notAsked.reader === 'rules' && notAsked.readerNote === null, 'ai: without read, the model is never called');
}

// ---- Cleaning whatever a model returns
{
  // What Qwen returned for Grant's hospital brief (21 Oct): two roles over and over, nothing else,
  // with words only about the client. Every part came back empty before this was cleaned.
  const p = cleanStoryPlan({ summary: 'A hospital group proposal.', questions: [], sections: [
    { role: 'client-challenge', title: 'Their situation', need: 'x', words: ['hospital group'] },
    { role: 'insight', title: 'What we learned', need: 'x', words: ['organisation research'] },
    { role: 'client-challenge', title: 'Their RFP', need: 'x', words: ['rfp'] },
    { role: 'insight', title: 'More research', need: 'x', words: ['history'] },
  ] });
  check(JSON.stringify(p.sections.map((x) => x.role)) === JSON.stringify(STORY_ROLES), 'clean: repeated parts merge into one each, and the missing parts are added', p.sections.map((x) => x.role));
  const challenge = p.sections[0];
  check(challenge.title === 'Their situation' && challenge.words.includes('rfp') && challenge.words.includes('challenge'), "clean: a merged part keeps the first heading, both parts' words, and the arc's words", challenge);
  const r = await buildStoryboard('A hospital group needs a proposal and a clear story.', { search, reader: { name: 'fake', plan: async () => p } }, { read: true });
  check(r.sections.filter((x) => !x.gap).length >= 4, 'clean: with the arc words kept, most parts find slides', r.sections.map((x) => `${x.role}:${x.items.length}`));
}
{
  const p = cleanStoryPlan({ summary: '  x  ', questions: ['ok?', 'Who will be in the room?', 'a', 'b?', 'c?', 'd?'], sections: [] });
  check(p.sections.length === 6, 'clean: no usable sections falls back to the standard story');
  check(p.questions.length <= 3 && p.questions.includes('Who will be in the room?'), 'clean: at most three real questions are kept', p.questions);
}
check(standInStory('Sustainability is the client\'s top priority.').sections.find((s) => s.role === 'strategy')!.words.includes('sustainability'), 'rules: a theme the situation names (sustainability) is searched for in the approach');

// ---- The OpenAI-compatible story reader, against a fake API
{
  let sent: Record<string, unknown> = {};
  const reader = openAiCompatibleStoryReader({ baseUrl: 'http://localhost:11434/v1', apiKey: null, model: 'qwen3:8b', timeoutMs: 5000 }, async (_url, init) => {
    sent = JSON.parse(String(init.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'A bank fit-out.', questions: [], sections: [{ role: 'strategy', title: 'How', need: 'Show the plan.', words: ['phasing'] }] }) } }] });
  });
  const plan = await reader.plan(situation);
  const rf = sent.response_format as { json_schema: { name: string; strict: boolean } };
  check(rf.json_schema.name === 'storyboard' && rf.json_schema.strict, 'reader: asks for the storyboard JSON schema, strict');
  const how = plan.sections.find((x) => x.role === 'strategy')!;
  check(plan.sections.length === 6 && how.title === 'How' && how.words[0] === 'phasing', 'reader: plan read back and cleaned', plan);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll storyboard checks passed');
process.exit(failures ? 1 : 0);

/**
 * Storyboard checks (docs/DECISIONS.md FD-22). No database and no real model: the library search
 * and the AI reader are fakes, so every rule can be checked exactly.
 *
 *   npm run test:storyboard
 */
import type { SlideSummary } from '../features/slide-vault/contracts/dto';
import type { SearchPlan, SlideFacts } from '../features/slide-vault/server/ai/search-plan';
import { cleanStoryPlan, missingContext, openAiCompatibleStoryReader, standInStory, STORY_ROLES, type StoryReader } from '../features/slide-vault/server/ai/storyboard';
import { buildStoryboard, situationTopics } from '../features/slide-vault/server/services/storyboard';

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
  check(r.sections.every((s) => s.items.every((i) => i.why.startsWith(s.need))), 'rules: every reason starts with what that part must prove');
  check(searches.some((p) => p.keywords.includes('phasing')), 'rules: a known situation (short contract, occupied building) adds phasing to the approach search', searches.map((p) => p.keywords));
}

// ---- The client's own topics
{
  const t = situationTopics("We're pitching a workplace refit for a financial services firm that wants to move to a hybrid way of working. Leadership worries staff will resist losing their own desks, and the board wants sustainability and cost savings.");
  check(['hybrid', 'desk', 'sustainability', 'cost'].every((w) => t.includes(w)), 'topics: the client\'s real topics (hybrid, desks, sustainability, cost) are all searched', t);
  check(!['pitching', 'wants', 'way', 'losing', 'their', 'board'].some((w) => t.includes(w)), 'topics: filler about the pitch is left out', t);
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

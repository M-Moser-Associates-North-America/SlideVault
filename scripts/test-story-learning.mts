/**
 * "Was this helpful?" and talking instead of typing (docs/DECISIONS.md FD-24). No database, no real
 * speech service: feedback rows and the transcription API are fakes, so every rule can be checked.
 *
 *   npm run test:story-learning
 */
import type { SlideSummary } from '../features/slide-vault/contracts/dto';
import type { SearchPlan, SlideFacts } from '../features/slide-vault/server/ai/search-plan';
import { openAiCompatibleTranscriber, readSpeechConfig } from '../features/slide-vault/server/ai/speech';
import { cleanFeedback, learnedFrom, mayLearnFrom } from '../features/slide-vault/server/story-feedback';
import { ROLE_TUNING, roleOf } from '../features/slide-vault/server/ai/roles';
import { buildStoryboard, PART_SLIDES } from '../features/slide-vault/server/services/storyboard';

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

// ---- Cleaning feedback from the browser
check(cleanFeedback({ role: 'experience', slideId: 's1', verdict: 'useful', topics: ['Hospital', 'merger', 'Acme Corp!', 'x'] })?.topics.join() === 'hospital,merger', 'feedback: topic words are lowercased and anything that is not a plain word is dropped');
check(cleanFeedback({ role: 'experience', slideId: null, verdict: 'nothing-fits', topics: [] }) !== null, 'feedback: "nothing fits" is about a part, with no slide');
check(cleanFeedback({ role: 'experience', slideId: 's1', verdict: 'nothing-fits' }) === null, 'feedback: "nothing fits" with a slide is refused');
check(cleanFeedback({ role: 'experience', slideId: null, verdict: 'useful' }) === null, 'feedback: "useful" without a slide is refused');
check(cleanFeedback({ role: 'made-up', slideId: 's1', verdict: 'useful' }) === null, 'feedback: an unknown story part is refused');
check(cleanFeedback({ role: 'experience', slideId: 's1', verdict: 'love it' }) === null, 'feedback: an unknown verdict is refused');

// ---- Learning only from similar briefs
const at = '2026-10-21T00:00:00Z';
const rows = [
  { role: 'experience' as const, slideId: 's-case2', verdict: 'useful' as const, topics: ['hospital'], at },
  { role: 'experience' as const, slideId: 's-case2', verdict: 'useful' as const, topics: ['hospital', 'merger'], at },
  { role: 'experience' as const, slideId: 's-case', verdict: 'not-right' as const, topics: ['hospital'], at },
  { role: 'experience' as const, slideId: 's-case', verdict: 'useful' as const, topics: ['bank'], at },
  { role: 'why-us' as const, slideId: 's-case2', verdict: 'useful' as const, topics: ['hospital'], at },
];
{
  const l = learnedFrom(rows, ['hospital']);
  check(l.get('experience:s-case2')?.useful === 2, 'learning: two useful marks on similar briefs are counted', [...l]);
  check(l.get('experience:s-case')?.notRight === 1 && l.get('experience:s-case')?.useful === 0, 'learning: a mark on an unrelated brief (bank) is ignored', l.get('experience:s-case'));
  check(l.get('why-us:s-case2')?.useful === 1, 'learning: marks are kept per part of the story', [...l]);
}

// ---- The storyboard uses what was learned
const LIB = [
  { id: 's-case', title: 'Case study: hospital project one', text: 'Project completed with results.' },
  { id: 's-case2', title: 'Case study: hospital project two', text: 'Project completed with results.' },
];
const slide = (id: string, title: string): SlideSummary => ({
  id, title, hiddenInSource: false, previewPath: `/slides/${id}/preview`,
  provenance: { sourceId: 'd', sourceVersionId: 'v', sourceTitle: 'Sample deck', sourceFileName: 'sample.pptx', slideNumber: 1, owner: null, approvalStatus: null, reviewedAt: null },
});
const search = async (plan: SearchPlan) =>
  LIB.filter((s) => plan.keywords.some((k) => `${s.title} ${s.text}`.toLowerCase().includes(k))).map((s) => ({
    summary: slide(s.id, s.title),
    facts: { title: s.title, text: s.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts,
  }));
{
  const situation = 'A hospital group needs a proposal for a new workplace.';
  const before = await buildStoryboard(situation, { search });
  const proofBefore = before.sections.find((s) => s.role === 'experience')!;
  check(proofBefore.items[0]?.slide.id === 's-case', 'learning: without feedback the library order decides', proofBefore.items.map((i) => i.slide.id));
  check(before.topics.includes('hospital'), 'learning: the topic words are returned for feedback, not the brief', before.topics);
  let askedWith: string[] = [];
  const after = await buildStoryboard(situation, { search, learned: async (t) => ((askedWith = t), learnedFrom(rows, t)) });
  const proof = after.sections.find((s) => s.role === 'experience')!;
  check(askedWith.includes('hospital'), 'learning: asked with this brief\'s topic words', askedWith);
  check(proof.items[0]?.slide.id === 's-case2' && proof.items[proof.items.length - 1]?.slide.id === 's-case', 'learning: the slide colleagues found useful leads, the one marked not right goes last', proof.items.map((i) => i.slide.id));
  check(/Colleagues marked it useful for this part on 2 similar briefs/.test(proof.items[0]?.why ?? ''), 'learning: the reason says colleagues found it useful', proof.items[0]?.why);
  check(proof.items[0]?.learned?.useful === 2, 'learning: the counts are returned for the screen', proof.items[0]?.learned);
  const broken = await buildStoryboard(situation, { search, learned: async () => { throw new Error('db down'); } });
  check(broken.sections.length === 6, 'learning: if the feedback store fails, the storyboard still works');
}

// ---- Tuned per role (FD-25): Grant's three groups, one engine
check(roleOf('director') === 'director' && roleOf('ceo') === null && roleOf(undefined) === null, 'roles: only the three known roles are accepted');
check(cleanFeedback({ role: 'outcome', slideId: 's1', verdict: 'useful', topics: [], by: 'director' })?.by === 'director' && cleanFeedback({ role: 'outcome', slideId: 's1', verdict: 'useful', topics: [], by: 'admin' })?.by === null, 'roles: feedback keeps who gave it by role only, and drops an unknown role');
{
  const mixed = [
    { role: 'outcome' as const, slideId: 'a', verdict: 'useful' as const, topics: [], by: 'director' as const, at },
    { role: 'outcome' as const, slideId: 'a', verdict: 'useful' as const, topics: [], by: 'bd-support' as const, at },
  ];
  check(learnedFrom(mixed, [], 'director').get('outcome:a')?.useful === 3, 'roles: a verdict from the same role counts double, others still count', learnedFrom(mixed, [], 'director').get('outcome:a'));
  check(learnedFrom(mixed, []).get('outcome:a')?.useful === 2, 'roles: without a role every verdict counts once');
}
{
  const MANY = Array.from({ length: 7 }, (_, i) => ({ id: `s-case-${i}`, title: `Case study ${i}: project`, text: 'Consolidating offices: project completed with results.' }));
  const MONEY = [{ id: 's-fees', title: 'Fees and value', text: 'Our fees, savings and value for money when consolidating offices.' }, { id: 's-outcome', title: 'Outcome', text: 'The outcome for the client after consolidating.' }];
  const lib = [...MANY, ...MONEY];
  const roleSearch = async (plan: SearchPlan) =>
    lib.filter((s) => plan.keywords.some((k) => `${s.title} ${s.text}`.toLowerCase().includes(k))).map((s) => ({
      summary: slide(s.id, s.title),
      facts: { title: s.title, text: s.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts,
    }));
  const brief = 'A bank is consolidating two offices into one.';
  const support = await buildStoryboard(brief, { search: roleSearch }, { role: 'bd-support' });
  const dev = await buildStoryboard(brief, { search: roleSearch }, { role: 'business-developer' });
  const counts = (r: typeof support) => r.sections.map((s) => s.items.length);
  check([support, dev].every((r) => r.sections.every((s) => s.items.length <= Math.max(PART_SLIDES[s.role], r === support ? ROLE_TUNING['bd-support'].slidesPerPart : 0))) && counts(dev)[3] > 3, 'roles: each part offers up to its own number (proof up to 8), and BD support never fewer than 5 where it has them', [counts(support), counts(dev)]);
  check(support.role === 'bd-support' && support.questions.length <= 1, 'roles: BD support is asked at most one question', support.questions);
  const director = await buildStoryboard(brief, { search: roleSearch }, { role: 'director' });
  check(director.sections.find((s) => s.role === 'outcome')!.items[0]?.slide.id === 's-fees', 'roles: a director\'s outcome part leads with fees and value', director.sections.find((s) => s.role === 'outcome')!.items.map((i) => i.slide.id));
  check(director.questions.some((q) => /budget|fee/i.test(q)), 'roles: a director is asked about budget and sign-off when the brief does not say', director.questions);
  check(!(await buildStoryboard(`${brief} The budget is fixed and the CFO signs off.`, { search: roleSearch }, { role: 'director' })).questions.some((q) => /budget|fee/i.test(q)), 'roles: not asked when the brief already says it');
  let askedBy: unknown = 'unset';
  await buildStoryboard(brief, { search: roleSearch, learned: async (_t, r) => ((askedBy = r), new Map()) }, { role: 'director' });
  check(askedBy === 'director', 'roles: learning is asked for this role', askedBy);
}

// ---- Talking instead of typing: one setting, any OpenAI-compatible speech service
check(readSpeechConfig({}).provider === 'none', 'speech: off unless set up');
{
  let threw = false;
  try { readSpeechConfig({ SV_SPEECH_PROVIDER: 'openai-compatible' }); } catch { threw = true; }
  check(threw, 'speech: a provider without an address is a setup error');
}
{
  const cfg = readSpeechConfig({ SV_SPEECH_PROVIDER: 'openai-compatible', SV_SPEECH_BASE_URL: 'http://127.0.0.1:8178/v1/' });
  check(cfg.provider === 'openai-compatible' && cfg.baseUrl === 'http://127.0.0.1:8178/v1' && cfg.model === 'whisper-1', 'speech: local Whisper settings read, trailing slash dropped', cfg);
  let url = '';
  let form: FormData | null = null;
  let headers: Record<string, string> = {};
  const t = openAiCompatibleTranscriber(cfg as Extract<typeof cfg, { provider: 'openai-compatible' }>, async (u, init) => {
    url = u; form = init.body as FormData; headers = (init.headers ?? {}) as Record<string, string>;
    return Response.json({ text: ' The client is a hospital group.\n' });
  });
  const text = await t.transcribe(new Blob([new Uint8Array(10)], { type: 'audio/wav' }), 'speech.wav');
  check(url === 'http://127.0.0.1:8178/v1/audio/transcriptions', 'speech: the standard /audio/transcriptions address', url);
  check((form as FormData | null)?.get('model') === 'whisper-1' && (form as FormData | null)?.get('file') instanceof Blob, 'speech: the recording and model are sent as a form', '');
  check(!('authorization' in headers), 'speech: no key is sent to a local service', headers);
  check(text === 'The client is a hospital group.', 'speech: the words come back tidied', text);
  const failing = openAiCompatibleTranscriber(cfg as Extract<typeof cfg, { provider: 'openai-compatible' }>, async () => new Response('', { status: 500 }));
  let failed = false;
  try { await failing.transcribe(new Blob([]), 'x.wav'); } catch { failed = true; }
  check(failed, 'speech: a failing service is reported, not silently empty');
  const c = cfg as Extract<typeof cfg, { provider: 'openai-compatible' }>;
  let asked = '';
  check(await openAiCompatibleTranscriber(c, async (u) => { asked = u; return new Response('', { status: 404 }); }).answers() && asked === 'http://127.0.0.1:8178/v1/models', 'speech: a service that replies at all (even 404) is answering', asked);
  check(!(await openAiCompatibleTranscriber(c, async () => { throw new TypeError('fetch failed'); }).answers()), 'speech: a stopped service (no reply) is reported as not answering');
}

// ---- Only from people who turned learning on (FD-37)
{
  const settings = new Map([['ana', true], ['ben', false]]);
  const optedIn = async (u: string) => settings.get(u) ?? false;
  check(await mayLearnFrom('ana', optedIn, true), 'opt-in: a verdict from someone who turned learning on is kept');
  check(!(await mayLearnFrom('ben', optedIn, true)), 'opt-in: from someone who turned it off, nothing is kept');
  check(!(await mayLearnFrom('cleo', optedIn, true)), 'opt-in: from someone who never turned it on, nothing is kept (opt-in, not opt-out)');
  check(!(await mayLearnFrom(null, optedIn, true)), 'opt-in: signed out, nothing is kept');
  check(!(await mayLearnFrom('ana', async () => { throw new Error('db down'); }, true)), "opt-in: if the setting can't be checked, nothing is kept");
  check(await mayLearnFrom(null, optedIn, false), 'opt-in: with no database (a laptop demo) verdicts are kept on this computer, as before');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll story learning checks passed');
process.exit(failures ? 1 : 0);

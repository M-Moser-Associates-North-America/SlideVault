/**
 * Storyboard checks (docs/DECISIONS.md FD-22). No database and no real model: the library search
 * and the AI reader are fakes, so every rule can be checked exactly.
 *
 *   npm run test:storyboard
 */
import type { SlideSummary } from '../features/slide-vault/contracts/dto';
import type { SearchPlan, SlideFacts } from '../features/slide-vault/server/ai/search-plan';
import { cleanComposition, cleanStoryPlan, cleanWeave, wholeSentences, missingContext, openAiCompatibleStoryReader, standInStory, STORY_ROLES, type StoryReader } from '../features/slide-vault/server/ai/storyboard';
import { briefNeeds, buildStoryboard, clientSectors, situationTopics } from '../features/slide-vault/server/services/storyboard';

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

// A tiny fake library: each slide is found when the search asks for any word in its title.
const LIB = [
  { id: 's-challenge', title: 'Understanding your objectives and challenge', text: 'Your goals for a refit while another tenant stays in the building.' },
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

{
  // The client's own sector is gathered first, so library order can't crowd it out.
  let asked: ((id: string) => boolean) | undefined;
  const knowledge = { of: (id: string) => ({ role: 'experience', topics: [], about: '', sectors: [id === 'h' ? 'healthcare' : 'media'] }), forPart: async (_r: string, _l: number, first?: (id: string) => boolean) => ((asked = first), []) };
  await buildStoryboard('A hospital group is merging three campuses.', { search: async () => [], knowledge });
  check(!!asked && asked('h') && !asked('m'), 'sector: proof candidates from the client\'s own sector are asked for first');
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
// ---- The storyboard learns from search (FD-59, FD-58): Useful / Not relevant and people's own tags
{
  const LIB7 = [
    { id: 'l-case', title: 'Case study: clinic network', text: 'Hospital campus project completed with results.' },
    { id: 'l-case2', title: 'Case study: teaching hospital', text: 'Hospital campus project completed with results.' },
    { id: 'l-challenge', title: 'Three campuses, one hospital', text: 'Hospital merging campuses: what is at stake for staff.' },
    { id: 'l-tagged', title: 'Wayfinding concept', text: 'Signage and arrival sequence.' },
  ];
  const readings = new Map<string, { role: string; topics: string[]; about: string; reviewed?: boolean }>([
    ['l-case', { role: 'experience', topics: ['healthcare'], about: '', reviewed: true }],
    ['l-case2', { role: 'experience', topics: ['healthcare'], about: '', reviewed: true }],
    ['l-challenge', { role: 'client-challenge', topics: [], about: '', reviewed: true }],
    ['l-tagged', { role: 'experience', topics: [], about: '', reviewed: true }],
  ]);
  const rowOf = (s: (typeof LIB7)[number]) => ({ summary: slide(s.id, s.title), facts: { title: s.title, text: s.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts });
  const search7 = async (plan: SearchPlan) => LIB7.filter((s) => plan.keywords.some((k) => `${s.title} ${s.text}`.toLowerCase().includes(k))).map(rowOf);
  const knowledge = { of: (id: string) => readings.get(id), forPart: async (role: string) => LIB7.filter((s) => s.id !== 'l-tagged' && readings.get(s.id)?.role === role).map(rowOf) };
  const brief = 'A hospital group is merging three campuses.';
  const part = (r: Awaited<ReturnType<typeof buildStoryboard>>, role: string) => r.sections.find((x) => x.role === role)!.items.map((i) => i.slide.id);
  const base = await buildStoryboard(brief, { search: search7, knowledge });
  check(part(base, 'experience')[0] === 'l-case', 'learns from search: without feedback, library order decides the proof', part(base, 'experience'));

  let asked: string[] = [];
  const useful = await buildStoryboard(brief, { search: search7, knowledge, searchLearned: async (topics) => ((asked = topics), new Map([['l-case2', { useful: 2, notRelevant: 0 }]])) });
  check(part(useful, 'experience')[0] === 'l-case2', 'learns from search: a slide marked Useful in search for these words leads its part', part(useful, 'experience'));
  check(asked.includes('hospital'), "learns from search: it's asked about the brief's own topics", asked);
  check(useful.sections.flatMap((x) => x.items).find((i) => i.slide.id === 'l-case2')!.why.includes('useful when searching'), 'learns from search: the reason says colleagues found it useful in search');
  check(!part(useful, 'client-challenge').includes('l-case2'), "learns from search: Useful in search never moves a slide into a part it doesn't do", part(useful, 'client-challenge'));

  const notRelevant = await buildStoryboard(brief, { search: search7, knowledge, searchLearned: async () => new Map([['l-case', { useful: 0, notRelevant: 1 }]]) });
  check(!part(notRelevant, 'experience').includes('l-case'), 'learns from search: a slide marked Not relevant for these words stays out of the story', part(notRelevant, 'experience'));
  const overruled = await buildStoryboard(brief, { search: search7, knowledge, searchLearned: async () => new Map([['l-case', { useful: 0, notRelevant: 1 }]]), learned: async () => new Map([['experience:l-case', { useful: 1, notRight: 0 }]]) });
  check(part(overruled, 'experience').includes('l-case'), "learns from search: the storyboard's own Useful for that part outweighs search's Not relevant", part(overruled, 'experience'));
  const broken = await buildStoryboard(brief, { search: search7, knowledge, searchLearned: async () => { throw new Error('down'); }, log: () => {} });
  check(JSON.stringify(part(broken, 'experience')) === JSON.stringify(part(base, 'experience')), 'learns from search: if search feedback is unavailable, the story is built as before');

  const tagBrief = "Priya's pitch: a hospital group is merging three campuses.";
  let typed = '';
  const tagged = await buildStoryboard(tagBrief, { search: search7, knowledge, tagged: async (text) => ((typed = text), { of: (id) => (id === 'l-tagged' ? 'Priya' : undefined), rows: [rowOf(LIB7[3])] }) });
  const tagItem = tagged.sections.flatMap((x) => x.items).find((i) => i.slide.id === 'l-tagged');
  check(typed.includes('Priya') && part(tagged, 'experience')[0] === 'l-tagged', 'learns from tags: a slide someone tagged with a word of the brief is found and leads its part, even when no search found it', part(tagged, 'experience'));
  check(!!tagItem?.why.includes('Tagged “Priya”'), 'learns from tags: the reason names the tag', tagItem?.why);
  const deckTag = await buildStoryboard(tagBrief, { search: search7, knowledge, tagged: async () => ({ of: (_id, deck) => (deck === 'd' ? 'Priya' : undefined), rows: [] }) });
  check(deckTag.sections.flatMap((x) => x.items).some((i) => i.why.includes('Tagged “Priya”')), "learns from tags: a tag on a slide's deck counts too");
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
  check(!clientSectors('A bank wants smart building technology.').includes('technology'), 'sector: a theme like smart building technology does not make the client a tech company');
  const r = await buildStoryboard('A hospital group is merging three campuses on budget.', { search: search4, knowledge });
  const proof = r.sections.find((x) => x.role === 'experience')!;
  check(proof.items[0]?.slide.id === 'p-health', 'sector: a healthcare case study leads the proof for a hospital client', proof.items.map((i) => i.slide.id));
  check(Boolean(proof.items[0]?.why.includes('Same sector as your client')), 'sector: the slide says why it leads', proof.items[0]?.why);
}

{
  // FD-29: every slide must speak to this brief; doing the part's job is not enough.
  const LIB5 = [
    { id: 'n-resume', title: 'Our architect', text: 'Twenty years designing workplaces for technology clients.' },
    { id: 'n-wellbeing', title: 'Designing for staff wellbeing', text: 'Spaces that reduce stress and help clinical staff recover.' },
    { id: 'n-wellbeing-copy', title: 'Designing for staff wellbeing', text: 'Spaces that reduce stress and help clinical staff recover.' },
    { id: 'n-budget', title: 'Cost certainty', text: 'How we keep a multi-site programme on budget.' },
  ];
  const rowOf = (s: (typeof LIB5)[number]) => ({ summary: slide(s.id, s.title), facts: { title: s.title, text: s.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts });
  const roles = new Map([['n-resume', 'why-us'], ['n-wellbeing', 'client-challenge'], ['n-wellbeing-copy', 'client-challenge'], ['n-budget', 'strategy']]);
  const knowledge = { of: (id: string) => ({ role: roles.get(id)!, topics: [], about: '', reviewed: true, reuse: 'reusable' }), forPart: async (role: string) => LIB5.filter((x) => roles.get(x.id) === role).map(rowOf) };
  const search5 = async (plan: SearchPlan) => LIB5.filter((x) => plan.keywords.some((k) => `${x.title} ${x.text}`.toLowerCase().includes(k))).map(rowOf);
  const brief = 'A hospital group is merging three campuses. Clinical staff are burnt out, and the board worries about cost overruns.';
  check(JSON.stringify(briefNeeds(brief)) === JSON.stringify(['healthcare', 'bringing sites together', 'staff wellbeing', 'the board', 'cost and budget']), 'needs: the brief reads as healthcare, bringing sites together, staff wellbeing, the board, and cost', briefNeeds(brief));
  const r = await buildStoryboard(brief, { search: search5, knowledge });
  const placed = r.sections.flatMap((x) => x.items.map((i) => i.slide.id));
  check(!placed.includes('n-resume'), 'needs: a "why us" slide about nothing in the brief is left out', placed);
  check(r.sections.find((x) => x.role === 'client-challenge')!.items[0]?.slide.id === 'n-wellbeing', 'needs: burnt-out staff finds the wellbeing slide for the challenge', placed);
  check(!placed.includes('n-wellbeing-copy'), 'needs: the same slide copied into another deck is shown once', placed);
  check(r.sections.find((x) => x.role === 'strategy')!.items[0]?.why.includes('Speaks to: bringing sites together, cost and budget'), 'needs: each slide says which of the brief\'s needs it speaks to', r.sections.find((x) => x.role === 'strategy')!.items[0]?.why);
}

// ---- The story told slide by slide (FD-30)
{
  const codes = new Map<string, (typeof STORY_ROLES)[number]>([['s1', 'experience'], ['s2', 'client-challenge'], ['s3', 'strategy'], ['s4', 'experience']]);
  const c = cleanComposition({ title: 'Three campuses, one hospital', beats: [
    { role: 'experience', title: 'Work like this', lead: 's1', more: ['s4', 's1', 'nope'], narration: 'x', why: 'y', matches: ['healthcare'] },
    { role: 'client-challenge', title: 'Your staff', lead: 's2', more: [], narration: 'x', why: 'y', matches: [] },
    { role: 'strategy', title: 'One plan', lead: 'made-up', more: [], narration: 'x', why: 'y', matches: [] },
    { role: 'strategy', title: 'One plan', lead: 's3', more: [], narration: 'x', why: 'y', matches: [] },
  ] }, codes);
  check(JSON.stringify(c.beats.map((b) => b.role)) === '["client-challenge","strategy","experience"]', 'compose: the beats are told client first, whatever order the model gave', c.beats.map((b) => b.role));
  check(JSON.stringify(c.beats.find((b) => b.lead === 's1')?.more) === '["s4"]', 'compose: only shortlisted slides, each used once; made-up codes are dropped', c.beats);
  let threw = false;
  try { cleanComposition({ beats: [{ lead: 's1' }] }, codes); } catch { threw = true; }
  check(threw, 'compose: too little to be a story is refused, so the rules take over');

  const reader: StoryReader = {
    name: 'fake',
    plan: async (t) => standInStory(t),
    compose: async (_brief, candidates) => cleanComposition({ title: 'A bank that keeps working', beats: candidates.slice(0, 3).map((x) => ({ role: x.role, title: `About ${x.code}`, lead: x.code, more: [], narration: 'We keep you working.', why: 'Proof.', matches: ['bank'] })) }, new Map(candidates.map((x) => [x.code, x.role]))),
  };
  const codeMatches: StoryReader = { ...reader, compose: async (_b, c) => cleanComposition({ title: 'x', beats: c.slice(0, 3).map((x) => ({ role: x.role, title: 't', lead: x.code, more: [], narration: 'n', why: 'w', matches: ['s1', 'bank'] })) }, new Map(c.map((x) => [x.code, x.role]))) };
  const fuller = `${situation} It needs phasing, an occupied building case study, and our leadership team.`;
  const r = await buildStoryboard(fuller, { search, reader }, { read: true });
  const withCodes = await buildStoryboard(fuller, { search, reader: codeMatches }, { read: true });
  const r0matches = () => withCodes.beats.every((x) => !x.matches.includes('s1')) && withCodes.beats.some((x) => x.matches.includes('bank'));
  check(cleanComposition({ title: "Client's Situation: Three campuses", beats: [1, 2, 3].map((n) => ({ role: 'strategy', title: 't', lead: `s${n}`, more: [], narration: 'x', why: 'y', matches: [] })) }, codes).title === 'Three campuses', 'compose: a label before the story\'s name is dropped');
  check(r0matches(), 'compose: matches are words from the brief, never slide codes');
  check(r.composer === 'model' && r.title === 'A bank that keeps working' && r.beats.length === 3 && r.beats[0].narration === 'We keep you working.', 'compose: with the AI on, it names, orders and narrates the story', { composer: r.composer, title: r.title, beats: r.beats.length });
  const rules = await buildStoryboard(situation, { search });
  check(rules.composer === 'rules' && rules.beats.length > 0 && rules.title.startsWith('We just won'), 'compose: without the AI the rules still tell the story in order', { composer: rules.composer, title: rules.title });
  const broken = await buildStoryboard(situation, { search, reader: { ...reader, compose: async () => { throw new Error('timeout'); } }, log: () => {} }, { read: true });
  check(broken.composer === 'rules' && broken.beats.length > 0, 'compose: if the AI fails while composing, the rules story is shown');
  check(rules.considered >= rules.beats.length, 'compose: the number of slides weighed is reported', rules.considered);
}

check(wholeSentences('We start with you. Then we plan every site together with your board and staff.', 40) === 'We start with you.', 'compose: long narration is cut at a whole sentence');

// ---- Retelling an existing deck (FD-31): every slide used, story pages client-first, the rest after
{
  const DECK = [
    { id: 'd1', title: 'Cover', text: 'Proposal.', role: 'intro', type: 'cover' },
    { id: 'd2', title: 'Why us', text: 'Our firm.', role: 'why-us', type: 'differentiator' },
    { id: 'd3', title: 'Case study one', text: 'Completed with results.', role: 'experience', type: 'case_study_detail' },
    { id: 'd4', title: 'Our approach', text: 'Phased delivery.', role: 'strategy', type: 'approach_process' },
    { id: 'd5', title: 'Résumé', text: 'Twenty years.', role: 'admin', type: 'team_resume' },
    { id: 'd6', title: 'Fees', text: 'Fees.', role: 'admin', type: 'fees_commercial' },
    { id: 'd7', title: 'Case study two', text: 'Completed with results.', role: 'experience', type: 'case_study_detail' },
    { id: 'd8', title: 'Thank you', text: 'Closing.', role: 'outcome', type: 'closing' },
  ];
  const OTHER = { id: 'o1', title: 'Understanding your goals', text: 'Your objectives and challenge.', role: 'client-challenge', type: 'client_understanding' };
  const rowOf = (x: { id: string; title: string; text: string }) => ({ summary: slide(x.id, x.title), facts: { title: x.title, text: x.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts });
  const all = [...DECK, OTHER];
  const knowledge = { of: (id: string) => { const x = all.find((d) => d.id === id); return x && { role: x.role, topics: [], about: '', reviewed: true, reuse: 'reusable', type: x.type }; }, forPart: async (role: string) => all.filter((x) => x.role === role).map(rowOf) };
  const search6 = async (plan: SearchPlan) => all.filter((x) => plan.keywords.some((k) => `${x.title} ${x.text}`.toLowerCase().includes(k))).map(rowOf);
  const r = await buildStoryboard('Tell me the story of this deck', { search: search6, knowledge, source: { deck: { id: 'src', title: 'Kestrel · RFP · 2025', slideCount: DECK.length }, rows: DECK.map(rowOf) } });
  const shown = r.beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id));
  const fromDeck = shown.filter((id) => id.startsWith('d'));
  check(r.mode === 'reimagine' && JSON.stringify(fromDeck) === JSON.stringify(DECK.map((d) => d.id)), "retell (FD-32): every slide is used, in the deck's own order", fromDeck);
  const kinds = r.beats.map((b) => `${b.kind ?? b.role}:${[b.lead, ...b.more].map((i) => i.slide.id).join('+')}`);
  check(JSON.stringify(kinds) === JSON.stringify(['required:d1', 'suggested:o1', 'why-us:d2', 'experience:d3', 'strategy:d4', 'required:d5+d6', 'experience:d7', 'outcome:d8']), 'retell: required pages stay where they were; a part the deck never had is suggested where it belongs', kinds);
  const suggested = r.beats.find((b) => b.kind === 'suggested');
  check(!!suggested && suggested.bridge.startsWith('Suggested addition: the original never') && suggested.lead.why.startsWith('Not in the original'), 'retell: a suggestion says what gap it fills and where it came from', suggested?.bridge);
  check(r.beats.every((b) => b.bridge.length > 10) && r.beats.find((b) => b.kind === 'required' && b.lead.slide.id === 'd5')!.bridge.includes('résumés, fees'), 'retell: every section opens with a line, and required pages say what they are', r.beats.map((b) => b.bridge));
  check(r.beats.find((b) => b.role === 'experience')!.bridge.includes('each project should say what it shows for them'), 'retell: the proof is asked to tie back to the client');
  {
    const themed = { ...knowledge, of: (id: string) => { const k = knowledge.of(id); return k && { ...k, themes: id === 'd3' || id === 'd7' ? ['health & wellbeing'] : id === 'd4' ? ['cost certainty & risk'] : [] }; } };
    const t = await buildStoryboard('Tell me the story of this deck', { search: search6, knowledge: themed, source: { deck: { id: 'src', title: 'Kestrel · RFP · 2025', slideCount: DECK.length }, rows: DECK.map(rowOf) } });
    check(t.thesis === 'Show Kestrel we understand what matters to them (health & wellbeing and cost certainty & risk), have a clear plan, and have done it before.', "retell: with no needs in the request, the thesis comes from the deck's own themes", t.thesis);
  }

  {
    // Page breakers the section reader found (FD-57) split a retold deck where the deck itself does.
    const split = await buildStoryboard('Tell me the story of this deck', { search: search6, knowledge, isDivider: (id) => id === 'd6', source: { deck: { id: 'src', title: 'Kestrel · RFP · 2025', slideCount: DECK.length }, rows: DECK.map(rowOf) } });
    const splitKinds = split.beats.map((b) => `${b.kind ?? b.role}:${[b.lead, ...b.more].map((i) => i.slide.id).join('+')}`);
    check(splitKinds.includes('required:d5') && !splitKinds.includes('required:d5+d6') && split.beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id)).filter((id) => id.startsWith('d')).join() === DECK.map((d) => d.id).join(), "retell: a divider found by the section reader opens a new section, and every slide stays in the deck's order", splitKinds);
  }

  {
    // Grouped by the deck's own sections (Gabby, 28 Oct: "if it follows the page breaker… it would pull those slides").
    const chapters: Record<string, { key: string; name: string; kind?: string }> = {
      d2: { key: 'c1', name: 'who we are', kind: 'other' }, d3: { key: 'c1', name: 'who we are', kind: 'other' }, d4: { key: 'c1', name: 'who we are', kind: 'other' },
      d5: { key: 'c2', name: 'Appendix: team', kind: 'appendix' }, d6: { key: 'c2', name: 'Appendix: team', kind: 'appendix' },
      d7: { key: 'c3', name: 'Where we have done this', kind: 'case-studies' },
    };
    const g = await buildStoryboard('Tell me the story of this deck', { search: search6, knowledge, sectionOf: (id) => chapters[id], source: { deck: { id: 'src', title: 'Kestrel · RFP · 2025', slideCount: DECK.length }, rows: DECK.map(rowOf) } });
    const gKinds = g.beats.map((b) => `${b.kind ?? b.role}:${b.title}:${[b.lead, ...b.more].map((i) => i.slide.id).join('+')}`);
    check(gKinds.some((k) => k.endsWith(':Who we are:d2+d3+d4')), "retell by sections: a chapter's slides stay together under the deck's own name, capitalised", gKinds);
    check(gKinds.some((k) => k.startsWith('required:Appendix: team:')), 'retell by sections: an appendix chapter is kept as required pages', gKinds);
    check(gKinds.some((k) => k.startsWith('experience:Where we have done this:d7')), 'retell by sections: a case-studies chapter is the proof, whatever the slides were read as', gKinds);
    check(g.beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id)).filter((id) => id.startsWith('d')).join() === DECK.map((d) => d.id).join(), "retell by sections: every slide stays in the deck's order");

    // A long deck with no page breakers is read in about a dozen parts, not one per turn.
    const LONG = Array.from({ length: 48 }, (_, i) => ({ id: `L${i}`, title: `Long slide ${i}`, text: 'Words.', role: i % 2 ? 'why-us' : 'admin', type: i % 2 ? 'differentiator' : 'fees_commercial' }));
    const longKnow = { of: (id: string) => { const x = [...LONG, OTHER].find((d) => d.id === id); return x && { role: x.role, topics: [], about: '', reviewed: true, reuse: 'reusable', type: x.type }; }, forPart: async (role: string) => [OTHER].filter((x) => x.role === role).map(rowOf) };
    const long = await buildStoryboard('Tell me the story of this deck', { search: async () => [], knowledge: longKnow, source: { deck: { id: 'long', title: 'Longco · RFP · 2025', slideCount: LONG.length }, rows: LONG.map(rowOf) } });
    const longShown = long.beats.filter((b) => b.kind !== 'suggested');
    check(longShown.length <= 12 && longShown.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id)).join() === LONG.map((d) => d.id).join(), 'retell: a long deck with no page breakers reads in at most 12 parts, every slide in order', longShown.length);

    // A deck of only required pages: suggestions come after the cover, in story order.
    const PAPER = [DECK[0], DECK[4], DECK[5]];
    const paper = await buildStoryboard('Tell me the story of this deck', { search: search6, knowledge, source: { deck: { id: 'paper', title: 'Paperco · RFP · 2025', slideCount: PAPER.length }, rows: PAPER.map(rowOf) } });
    const order = paper.beats.map((b) => b.kind ?? b.role);
    const sugg = paper.beats.filter((b) => b.kind === 'suggested').map((b) => b.role);
    check(order[0] === 'required' && [paper.beats[0].lead, ...paper.beats[0].more].some((i) => i.slide.id === 'd1') && sugg.join() === [...sugg].sort((a, b) => STORY_ROLES.indexOf(a) - STORY_ROLES.indexOf(b)).join(), 'retell: with no story pages, suggestions follow the cover in story order', order);
  }

  // The AI writes the lines; it can never drop or move a section.
  const weaver: StoryReader = {
    name: 'fake',
    plan: async (t) => standInStory(t),
    weave: async (_b, secs) => cleanWeave({ title: 'Kestrel, accountable everywhere', thesis: 'Show Kestrel one firm can be accountable for every site.', sections: [...secs].reverse().slice(0, secs.length - 1).map((x) => ({ code: x.code, title: `T ${x.code}`, bridge: `Ties ${x.code} back to accountability.`, narration: 'n', why: 'w' })).concat([{ code: 'made-up', title: 'x', bridge: 'x', narration: 'x', why: 'x' }]) }, new Set(secs.map((x) => x.code))),
  };
  const w = await buildStoryboard('Tell me the story of this deck', { search: search6, knowledge, reader: weaver, source: { deck: { id: 'src', title: 'Kestrel · RFP · 2025', slideCount: DECK.length }, rows: DECK.map(rowOf) } }, { read: true });
  const wShown = w.beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id)).filter((id) => id.startsWith('d'));
  check(w.composer === 'model' && w.thesis.startsWith('Show Kestrel one firm') && JSON.stringify(wShown) === JSON.stringify(DECK.map((d) => d.id)), "retell: the AI's thesis, in the deck's order whatever order it answered in", wShown);
  check(w.beats.slice(1).every((b) => b.bridge.startsWith('Ties w')) && !w.beats[0].bridge.startsWith('Ties'), "retell: the AI's lines where it wrote them, the rules' for the one it skipped", w.beats.map((b) => b.bridge));
  check(w.beats.find((b) => b.kind === 'required')!.narration === '', 'retell: required pages get no narration');
}

// ---- A new story about clients we already have decks for (FD-31): their decks lead the parts about them
{
  const THEIRS = [
    { id: 'c1', title: 'Understanding Kestrel', text: 'Two teams coming together under one roof.', role: 'client-challenge', type: 'client_understanding' },
    { id: 'c2', title: 'Our approach for Kestrel', text: 'A phased plan.', role: 'strategy', type: 'approach_process' },
  ];
  const ELSE = [
    { id: 'e1', title: 'Merging workplaces', text: 'Bringing teams together after a merger.', role: 'client-challenge', type: 'client_understanding' },
    { id: 'e2', title: 'Case study: merger', text: 'Merging two campuses, completed with results.', role: 'experience', type: 'case_study_detail' },
  ];
  const all = [...THEIRS, ...ELSE];
  const rowOf = (x: { id: string; title: string; text: string }) => ({ summary: slide(x.id, x.title), facts: { title: x.title, text: x.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts });
  const knowledge = { of: (id: string) => { const x = all.find((d) => d.id === id); return x && { role: x.role, topics: [], about: '', reviewed: true, reuse: 'reusable', type: x.type }; }, forPart: async (role: string) => ELSE.filter((x) => x.role === role).map(rowOf) };
  const search7 = async (plan: SearchPlan) => ELSE.filter((x) => plan.keywords.some((k) => `${x.title} ${x.text}`.toLowerCase().includes(k))).map(rowOf);
  const r = await buildStoryboard('Kestrel and Tailwind are merging. Tell the story of that.', { search: search7, knowledge, context: { decks: [{ id: 'k', title: 'Kestrel · RFP · 2025' }], rows: THEIRS.map(rowOf) } });
  const lead = (role: string) => r.sections.find((x) => x.role === role)?.items[0];
  check(lead('client-challenge')?.slide.id === 'c1' && lead('client-challenge')!.why.includes('deck we made for this client'), "context: the client's own deck leads its situation, and says so", lead('client-challenge')?.why);
  check(lead('strategy')?.slide.id === 'c2', "context: and the approach we proposed to them");
  check(lead('experience')?.slide.id === 'e2', 'context: proof still comes from the brief, not just their deck');
  check(r.mode === 'build' && r.context?.[0]?.title === 'Kestrel · RFP · 2025', 'context: the story names the decks it drew on');
}

// ---- One argument, not a list (FD-30, 24 Oct): a thesis, and a bridge from each beat to the next
{
  const hospital = 'A hospital group is merging three campuses. Clinical staff are burnt out, and the board worries about cost overruns.';
  const LIB8 = [
    { id: 'b1', title: 'Your staff, your campuses', text: 'Burnt out clinical staff across three hospital campuses.', role: 'client-challenge' },
    { id: 'b2', title: 'Our phased plan', text: 'A phased plan to keep cost certainty across campuses.', role: 'strategy' },
    { id: 'b3', title: 'Case study: hospital merger', text: 'Hospital campuses merged on budget, completed with results.', role: 'experience' },
    { id: 'b4', title: 'Your team', text: 'Healthcare leadership and the board.', role: 'why-us' },
  ];
  const rowOf = (x: { id: string; title: string; text: string }) => ({ summary: slide(x.id, x.title), facts: { title: x.title, text: x.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts });
  const knowledge = { of: (id: string) => { const x = LIB8.find((d) => d.id === id); return x && { role: x.role, topics: [], about: '', reviewed: true, reuse: 'reusable' }; }, forPart: async (role: string) => LIB8.filter((x) => x.role === role).map(rowOf) };
  const search8 = async (plan: SearchPlan) => LIB8.filter((x) => plan.keywords.some((k) => `${x.title} ${x.text}`.toLowerCase().includes(k))).map(rowOf);
  const r = await buildStoryboard(hospital, { search: search8, knowledge });
  check(r.beats.length >= 3 && r.beats.every((b) => b.bridge.length > 10), 'story: every beat says how it follows from the one before', r.beats.map((b) => b.bridge));
  check(r.beats[0].bridge.startsWith('Start with them'), 'story: the first beat says why the story starts there', r.beats[0].bridge);
  check(r.thesis.startsWith('Show them we understand how a hospital works, what it takes to bring their sites together and what their people are going through'), 'story: the thesis says what this brief needs, in plain words, in the brief\'s order', r.thesis);
  const proof = r.beats.find((b) => b.role === 'experience');
  check(!!proof && proof.bridge.includes('done it before'), 'story: proof is introduced as backing the plan', proof?.bridge);
  check(!!proof && /^(Direct|Transferable): /.test(proof.why) && proof.why.includes('it shows we know'), 'story: a case study says whether it is direct or transferable, and what it shows for this client', proof?.why);
  check(r.close === 'In the end, they get one organisation across every site, a place their people want to work and a plan their board can sign off.', 'story: it closes on what the client gets', r.close);
  check((await buildStoryboard('We need a proposal outline.', { search: search8, knowledge })).close === '', 'story: no close is made up when the brief names nothing they want');

  // The AI wrote proof first; the app tells it client first, so bridges written after the wrong beat are rewritten.
  const reader: StoryReader = {
    name: 'fake',
    plan: async (t) => standInStory(t),
    compose: async (_b, c) => cleanComposition({ title: 'One hospital', thesis: 'Show them we can merge three campuses without burning out their staff.', beats: [
      { role: 'experience', title: 'Done before', bridge: 'We open with proof.', lead: c.find((x) => x.role === 'experience')!.code, more: [], narration: 'n', why: 'w', matches: [] },
      { role: 'client-challenge', title: 'Your staff', bridge: 'After the proof, their situation.', lead: c.find((x) => x.role === 'client-challenge')!.code, more: [], narration: 'n', why: 'w', matches: [] },
      { role: 'strategy', title: 'The plan', bridge: 'From their situation to the plan.', lead: c.find((x) => x.role === 'strategy')!.code, more: [], narration: 'n', why: 'w', matches: [] },
    ] }, new Map(c.map((x) => [x.code, x.role]))),
  };
  const m = await buildStoryboard(`${hospital} Our phased plan, a hospital case study, and our team.`, { search: search8, knowledge, reader }, { read: true });
  check(m.composer === 'model' && m.thesis.startsWith('Show them we can merge'), "story: the AI's thesis is kept", m.thesis);
  check(m.close.startsWith('In the end, they get'), "story: when the AI writes no close, the rules' close is used", m.close);
  check(m.beats[0].role === 'client-challenge' && m.beats[0].bridge.startsWith('Start with them'), 'story: a bridge written after a beat that moved is rewritten', m.beats.map((b) => [b.role, b.bridge]));
  check(m.beats.find((b) => b.role === 'strategy')?.bridge === 'From their situation to the plan.', "story: a bridge whose neighbour didn't move is the AI's own", m.beats.map((b) => [b.role, b.bridge]));
}

{
  // Seen on the Barlow's story (24 Oct): the summary stopped at "and", "why this slide" at "st".
  const long = 'This beat sets the stage by framing the client as a forward-thinking global leader, aligning with the firm\'s ability to deliver high-impact, strategic workplaces. It also shows we know their market and their people in detail.';
  const c = cleanComposition({ title: 'A very long title that goes on and on well past the point where any heading should have stopped talking', thesis: long, beats: [1, 2, 3].map((n) => ({ role: 'strategy', title: 't', bridge: long, lead: `s${n}`, more: [], narration: long, why: long, matches: [] })) }, new Map([['s1', 'strategy'], ['s2', 'strategy'], ['s3', 'strategy']]));
  const ends = (t: string) => /[.!?…]$/.test(t) || t === long;
  check(c.beats.every((b) => ends(b.why) && ends(b.narration) && ends(b.bridge)) && ends(c.thesis), 'text: every AI line ends on a whole sentence or a whole word, never mid-word', c.beats[0].why);
  const longTitle = cleanComposition({ title: 'A very long title '.repeat(12), thesis: 't', beats: [1, 2, 3].map((n) => ({ role: 'strategy', title: 't', bridge: 'b', lead: `s${n}`, more: [], narration: 'n', why: 'w', matches: [] })) }, new Map([['s1', 'strategy'], ['s2', 'strategy'], ['s3', 'strategy']])).title;
  check(c.beats[0].why === long && longTitle.endsWith('…') && !longTitle.endsWith(' …'), 'text: room for a longer why, and a title that runs on stops at a whole word', [c.beats[0].why.length, longTitle]);
  check(cleanStoryPlan({ summary: long + ' ' + long, questions: [], sections: [] }).summary.endsWith('.'), 'text: the summary under the title ends on a whole sentence');
}

// ---- Families: slides that belong together (FD-42)
{
  const { familiesOf } = await import('../features/slide-vault/server/services/families');
  const { dominantFamily } = await import('../features/slide-vault/server/services/storyboard');
  const src = (id: string, fileName: string, template: string | null, slides: [string, number, boolean?][], versionId = id) => ({ id, title: id, fileName, versionId, sha256: versionId, template, slides: slides.map(([sid, number, hidden]) => ({ id: sid, number, title: sid, text: '', hidden: !!hidden })), deck: { clientName: fileName.includes('Team') ? 'Our Team' : fileName.includes('Acme') ? 'Acme' : 'Birch', deckYear: 2026 } });
  const index = { generatedAt: '', sources: [
    src('t3', 'Team/Our Team - 03.pptx', 'T/T/Office/111', [['t3s', 1]]),
    src('t1', 'Team/Our Team - 01.pptx', 'T/T/Office/111', [['t1s', 1]]),
    src('t2', 'Team/Our Team - 02.pptx', 'T/T/Office/111', [['t2s', 1]]),
    src('a', 'M Moser_Acme_2026.pptx', 'House/House/Custom 1/FF893E', [['a1', 1], ['a2', 2]]),
    src('a-copy', 'M Moser_Acme_2026 (1).pptx', 'House/House/Custom 1/FF893E', [['a1c', 1], ['a2c', 2]], 'a'),
    src('b', 'M Moser_Birch_2026.pptx', 'House/House/Custom 1/FF893E', [['b1', 1]]),
    src('p', 'M Moser_Acme_2026.pdf', null, [['p1', 1]]),
  ] };
  const fam = familiesOf(index as never);
  check(JSON.stringify(fam.get('t2s')?.slideIds) === '["t1s","t2s","t3s"]', 'family: slides stored one per file are one family, in the order of their file numbers', fam.get('t2s'));
  check(fam.get('a1')?.id !== fam.get('b1')?.id, "family: the firm's house template alone never makes a family: the client must match too");
  check(!fam.has('a1c'), 'family: a copy of the same file counts once');
  check(fam.get('p1')?.id !== fam.get('a1')?.id, 'family: a PDF is its own family');

  const rows = (ids: string[]) => ids.map((id) => ({ summary: slide(id, id) }));
  const of = (id: string) => fam.get(id);
  check(dominantFamily(rows(['t1s', 't2s', 't3s', 't1s', 't2s', 'b1']), of)?.id === fam.get('t1s')?.id, 'family: one that holds most of the best matches is the story');
  check(dominantFamily(rows(['t1s', 'a1', 'b1', 'p1', 'a2', 't2s']), of) === null, 'family: scattered matches are not a family story');

  // Told whole, in its own order, with nothing from outside and no hidden slides
  const LIB9 = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((id, i) => ({ id, title: `Our builders ${id}`, text: 'The builders who made the app.', role: i === 0 ? 'client-challenge' : i < 4 ? 'why-us' : 'strategy', hidden: id === 'f6' }));
  const OUTSIDE = { id: 'x1', title: 'Builders of offices', text: 'The builders of a client office.', role: 'why-us', hidden: false };
  const all9 = [...LIB9, OUTSIDE];
  const rowOf = (x: (typeof all9)[number]) => ({ summary: { ...slide(x.id, x.title), hiddenInSource: x.hidden }, facts: { title: x.title, text: x.text, client: null, year: null, category: null, bestOfTheBest: false } as SlideFacts });
  const knowledge = { of: (id: string) => { const x = all9.find((d) => d.id === id); return x && { role: x.role, topics: [], about: '', reviewed: true, reuse: 'reusable' }; }, forPart: async (role: string) => all9.filter((x) => x.role === role).map(rowOf) };
  const search9 = async (plan: SearchPlan) => all9.filter((x) => plan.keywords.some((k) => `${x.title} ${x.text}`.toLowerCase().includes(k))).map(rowOf);
  const family = { id: 'builders', title: 'Our Team · 2026', slideIds: LIB9.map((x) => x.id) };
  const families = { of: (id: string) => (family.slideIds.includes(id) ? family : undefined), rows: async () => LIB9.map(rowOf) };
  const r = await buildStoryboard('Tell the story of the builders who made the app.', { search: search9, knowledge, families });
  const told = r.beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id)).sort((a, b) => family.slideIds.indexOf(a) - family.slideIds.indexOf(b));
  check(r.family?.title === 'Our Team · 2026' && JSON.stringify(told) === '["f1","f2","f3","f4","f5"]', 'family story: every slide of the family, nothing from outside, no hidden slides', { family: r.family, told });
  const order = r.beats.flatMap((b) => [b.lead, ...b.more]).filter((i) => i.slide.id.startsWith('f')).map((i) => i.slide.id);
  check(order[0] === 'f1', 'family story: told in the order it was made', order);
}

// ---- Talking to the story: it continues, never starts over (FD-43)
{
  const { readTurn, refineStory } = await import('../features/slide-vault/server/services/story-refine');
  const t = readTurn('These two slides were helpful and these two were helpful. Please go and try to look for accessibility, trust and the roadmap.');
  check(JSON.stringify(t.find) === '["accessibility","trust","roadmap"]' && !t.remove.length, 'talk: "look for this, that and the third" is three things to find', t);
  check(JSON.stringify(readTurn('Drop the fees slides and take out résumés').remove) === '["fees","résumés"]', 'talk: "drop X and take out Y" removes both', readTurn('Drop the fees slides and take out résumés'));
  check(readTurn('I want it shorter').shorter && !readTurn('I want it shorter').find.length, 'talk: "I want it shorter" is a command, not something to search for');
  check(readTurn('more like these please').like && readTurn('only keep the useful ones').keepOnly, 'talk: "more like these" and "only keep the useful ones"');
  check(!readTurn('The client is a bank in Toronto with 400 staff.').find.length && !readTurn('The client is a bank in Toronto with 400 staff.').like, 'talk: plain context about the client is not a change request');

  const sl = (id: string, title = id) => ({ slide: slide(id, title), why: '', matched: [], reasons: { brief: [], part: [], from: [] } });
  const roles: Record<string, string> = { c1: 'client-challenge', s1: 'strategy', s2: 'strategy', p1: 'experience', w1: 'why-us', a1: 'why-us', a2: 'why-us', r1: 'outcome', f1: 'why-us' };
  const beat = (role: string, ids: string[], title = role) => ({ role: role as never, title, bridge: 'b', narration: '', why: '', matches: [], lead: sl(ids[0], `Slide ${ids[0]}`), more: ids.slice(1).map((i) => sl(i, i === 'f1' ? 'Our fees' : `Slide ${i}`)) });
  const story = [beat('client-challenge', ['c1']), beat('strategy', ['s1', 's2']), beat('why-us', ['w1', 'f1'])];
  const deps = {
    find: async (phrase: string) => (phrase === 'accessibility' ? [sl('a1', 'Built for everyone'), sl('a2', 'Accessibility checks'), sl('s1')] : phrase === 'roadmap' ? [sl('r1', 'Where it goes next')] : []),
    known: (id: string) => ({ role: roles[id] }),
    familyMates: async () => [sl('p1', 'Results')],
    tellable: () => true,
  };
  const r = await refineStory(story, 'These were useful. Look for accessibility, pricing and the roadmap. Drop the fees.', new Set(['s2']), deps);
  const ids = r.beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id));
  check(ids.includes('s2') && ids.includes('c1') && ids.includes('s1'), 'talk: the story on screen continues; nothing is started over', ids);
  check(ids.includes('a1') && ids.includes('a2') && ids.includes('r1') && !ids.includes('f1'), 'talk: found slides are added and asked-away slides removed in one message', ids);
  check(r.beats.find((b) => b.role === 'why-us')!.more.some((i) => i.slide.id === 'a1') && r.beats[r.beats.length - 1].role === 'outcome', 'talk: each found slide goes to its own part of the story, in order', r.beats.map((b) => b.role));
  check(/Kept your 1 useful slide/.test(r.reply) && /Added 2 on accessibility and 1 on roadmap/.test(r.reply) && /Couldn't find anything new on pricing/.test(r.reply) && /Took out 1 slide about fees/.test(r.reply), 'talk: the reply says what it kept, added, couldn\'t find and took out', r.reply);
  const pinnedStays = await refineStory(story, 'drop slide s2', new Set(['s2']), deps);
  check(pinnedStays.beats.some((b) => [b.lead, ...b.more].some((i) => i.slide.id === 's2')), 'talk: a slide marked useful is never removed');
  const only = await refineStory(story, 'only keep the useful ones', new Set(['s2']), deps);
  check(JSON.stringify(only.beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id))) === '["s2"]', 'talk: "only keep the useful ones" trims to them');
  const like = await refineStory(story, 'more like these', new Set(['s2']), deps);
  check(like.beats.some((b) => b.lead.slide.id === 'p1' || b.more.some((i) => i.slide.id === 'p1')), 'talk: "more like these" brings slides that belong with the ones you liked');
  check(!(await refineStory(story, 'The client is a bank in Toronto.', new Set(), deps)).understood, 'talk: context about the client is handed back to rebuild, keeping the useful slides');
  // Accents never split a word: "résumés" once became "sum" and took out every summary slide
  const team = [beat('why-us', ['w1', 'cv1', 'sum1'])].map((b) => ({ ...b, more: [sl('cv1', 'Résumé: design lead'), sl('sum1', 'Executive summary')] }));
  const cut = await refineStory(team, 'Take out the résumés', new Set(), deps);
  const left = cut.beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id));
  check(!left.includes('cv1') && left.includes('sum1') && left.includes('w1'), 'talk: "take out the résumés" removes the résumé only, not the summary', left);
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
  const r = await buildStoryboard(situation, { search, reader: { name: 'fake', plan: async () => p } }, { read: true });
  check(r.sections.filter((x) => !x.gap).length >= 2, 'clean: with the arc words kept, the parts with slides about this brief find them', r.sections.map((x) => `${x.role}:${x.items.length}`));
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

// ---- Archived decks are never told (FD-50): the same library, with the case study's deck archived
{
  const archivedSearch = async (plan: SearchPlan) =>
    (await search(plan)).map((row) => (row.summary.id === 's-case' ? { ...row, summary: { ...row.summary, provenance: { ...row.summary.provenance, archived: true } } } : row));
  const r = await buildStoryboard(situation, { search: archivedSearch });
  const ids = r.sections.flatMap((s) => s.items.map((i) => i.slide.id));
  const plain = (await buildStoryboard(situation, { search })).sections.flatMap((s) => s.items.map((i) => i.slide.id));
  check(plain.includes('s-case') && !ids.includes('s-case') && ids.includes('s-challenge'), 'archived: a slide from an archived deck never goes in a story; the rest still do', { plain, ids });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll storyboard checks passed');
process.exit(failures ? 1 : 0);

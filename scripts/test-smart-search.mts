/**
 * Quick AI search checks (docs/DECISIONS.md FD-16, FD-17). No database and no real model calls:
 * the reader, the search and the provider's API are all stand-ins here.
 *
 *   npm run test:smart-search
 */
import type { SlideSummary } from '../features/slide-vault/contracts/dto';
import { openAiCompatibleReader, parsePlan } from '../features/slide-vault/server/ai/openai-compatible';
import { cachedReader, readAiConfig, readerFromConfig, type PlanReader } from '../features/slide-vault/server/ai/reader';
import { hit, rateLimit, resetRateLimits } from '../features/slide-vault/server/rate-limit';
import { anyOfQuery, chipsFor, cleanPlan, groundFilters, isBasicQuery, typedCodes, relevantClients, standInPlan, whyItFits, type PlanContext, type SearchPlan, type SlideFacts } from '../features/slide-vault/server/ai/search-plan';
import { fixtureFilterValues, fixtureRowsWhere, smartSearchFixtures } from '../features/slide-vault/server/services/fixture-smart-search';
import { mentionsWord, smartSearch } from '../features/slide-vault/server/services/smart-search';
import { answersIntent, intentScore, intentWhy, searchIntent } from '../features/slide-vault/server/services/slide-intent';

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

const ctx: PlanContext = { clients: ['Kestrel Law', 'Northgate Bank', 'Halcyon Health'], categories: ['IDD', 'SME', 'Business Proposal'], thisYear: 2026 };

// ---- The stand-in reader
{
  const p = standInPlan('team intro for a bank pitch', ctx);
  check(p.topics.length > 0 && p.keywords.includes('bank'), 'stand-in: "team intro for a bank pitch" finds a topic and keeps "bank"', p);
  check(p.client === null, 'stand-in: "bank" alone is not read as the client Northgate Bank', p.client);
  check(standInPlan('northgate bank workplace', ctx).client === 'Northgate Bank', 'stand-in: "northgate bank" is');
}
{
  const p = standInPlan('Kestrel Law office slides from 2024', ctx);
  check(p.client === 'Kestrel Law', 'stand-in: picks a named client', p);
  check(p.yearFrom === 2024 && p.yearTo === 2024, 'stand-in: reads a year', p);
  check(!p.keywords.includes('kestrel'), 'stand-in: the client name is a filter, not a keyword', p.keywords);
}
{
  const p = standInPlan('recent IDD decks', ctx);
  check(p.category === 'IDD', 'stand-in: picks a category', p);
  check(p.yearFrom === 2024 && p.yearTo === null, 'stand-in: "recent" means the last two years', p);
}
check(standInPlan('best of the best hybrid work', ctx).bestOfTheBest === true, 'stand-in: "best of the best" sets the collection filter');

// ---- Cleaning whatever a reader returns
{
  const p = cleanPlan(
    { summary: 'x', keywords: ['Team', 'team', '"quoted"', 'a', 42 as unknown as string], topics: ['Team'], client: 'Acme Corp', yearFrom: 2025, yearTo: 2021, category: 'idd', bestOfTheBest: false },
    ctx,
  );
  check(p.client === null, 'clean: a client that is not in the library is dropped', p.client);
  check(p.category === 'IDD', 'clean: category matched to the real spelling', p.category);
  check(p.yearFrom === 2021 && p.yearTo === 2025, 'clean: years put in order', p);
  check(JSON.stringify(p.keywords) === JSON.stringify(['team', 'quoted']), 'clean: keywords lowercased, de-duplicated, junk removed', p.keywords);
  check(p.bestOfTheBest === null, 'clean: bestOfTheBest only when true');
}
check(anyOfQuery(['team', 'meet the team', 'a"b']) === 'team or "meet the team" or "a b"', 'any-of query: phrases quoted, stray quotes removed', anyOfQuery(['team', 'meet the team', 'a"b']));
check(JSON.stringify(chipsFor(cleanPlan({ topics: ['Team'], yearFrom: 2024, category: 'SME' }, ctx))) === JSON.stringify([{ kind: 'Topic', label: 'Team' }, { kind: 'Year', label: '2024 or later' }, { kind: 'Category', label: 'SME' }]), 'chips: topic, year range, category');

// ---- Why it fits
const facts = (o: Partial<SlideFacts> = {}): SlideFacts => ({ title: 'Your team for Kestrel Law', text: 'Meet the people who will lead the workplace strategy.', client: 'Kestrel Law', year: 2024, category: 'SME', bestOfTheBest: true, ...o });
{
  const plan = cleanPlan({ keywords: ['team', 'workplace strategy', 'cafeteria'], client: 'Kestrel Law', yearFrom: 2024, yearTo: 2024 }, ctx);
  const w = whyItFits(plan, facts());
  check(w.why === 'Has “team” in its title and mentions “workplace strategy”, from the Kestrel Law deck, from 2024, in Best of the Best.', 'why: title words, text words, then deck details', w.why);
  check(!w.matched.includes('cafeteria'), 'why: never claims a word the slide does not have', w.matched);
  check(whyItFits(cleanPlan({ keywords: ['team'] }, ctx), facts({ title: 'Teamwork' })).matched.length === 1, 'why: matches word starts (team -> teamwork, like the search does)');
}

// ---- The whole flow, with fakes
const slide = (id: string): SlideSummary => ({
  id, title: id, hiddenInSource: false, previewPath: `/slides/${id}/preview`,
  provenance: { sourceId: 'd', sourceVersionId: 'v', sourceTitle: 'Kestrel Law - SME', sourceFileName: 'k.pptx', slideNumber: 1, owner: null, approvalStatus: null, reviewedAt: null },
});
const context = async () => ({ clients: ctx.clients, categories: ctx.categories });
{
  const calls: SearchPlan[] = [];
  const r = await smartSearch('team slides for Kestrel Law', 10, {
    context, thisYear: 2026,
    search: async (p) => { calls.push(p); return p.client ? [] : [{ summary: slide('s1'), facts: facts() }]; },
  });
  check(r.reader === 'stand-in' && r.readerNote === null, 'flow: no reader configured means the stand-in, with no warning');
  check(calls.length === 2 && r.relaxed && r.items.length === 1, 'flow: when filters leave nothing, it searches again without them and says so', { calls: calls.length, relaxed: r.relaxed });
  check(!r.items[0].why.includes('from the Kestrel Law deck'), 'flow: a relaxed result does not claim to match the dropped filter', r.items[0].why);
}
{
  const failing: PlanReader = { name: 'fake', read: async () => { throw new Error('timeout'); } };
  const r = await smartSearch('which team slides should I use?', 10, { context, thisYear: 2026, reader: failing, search: async () => [], log: () => {} }, { read: true });
  check(r.reader === 'stand-in' && Boolean(r.readerNote), 'flow: if the model fails, the stand-in answers and the screen is told');
}
{
  const seen: string[][] = [];
  const model: PlanReader = { name: 'fake', read: async (_q, c) => { seen.push(c.clients); return cleanPlan({ summary: 'Team slides', keywords: ['team'], topics: ['Team'] }, ctx); } };
  const r = await smartSearch('I need people slides for kestrel', 10, { context, thisYear: 2026, reader: model, search: async (p) => [{ summary: slide('s1'), facts: facts({ title: p.keywords[0] }) }] }, { read: true });
  check(r.reader === 'model' && r.items[0].matched[0] === 'team', 'flow: the model\'s plan is what gets searched');
  check(JSON.stringify(seen[0]) === JSON.stringify(['Kestrel Law']), 'flow: the model sees only the client named in the request, not the whole list', seen[0]);
}

// ---- Basic searches skip the model
for (const q of ['team', 'Kestrel Law 2024', 'recent IDD decks', 'best of the best'])
  check(isBasicQuery(q), `basic: "${q}" stays on the rules`);
for (const q of ['which slides for a law firm?', 'how do I pitch a fit-out', 'we just won a 30-day contract in a shared building', 'slides about wellbeing for a bank headquarters move'])
  check(!isBasicQuery(q), `basic: "${q}" goes to the model`);
{
  let calls = 0;
  const counting: PlanReader = { name: 'fake', read: async () => { calls++; return cleanPlan({ keywords: ['team'] }, ctx); } };
  const r = await smartSearch('team', 10, { context, thisYear: 2026, reader: counting, search: async () => [] }, { read: true });
  check(calls === 0 && r.reader === 'stand-in' && r.readerNote === null, 'flow: a basic search never calls the model, and shows no warning');
}

// ---- Words that describe every slide are never search words
{
  const p = cleanPlan({ keywords: ['hospitality', 'proposal', 'deck', 'slides'] }, ctx);
  check(JSON.stringify(p.keywords) === JSON.stringify(['hospitality']), 'clean: "deck", "proposal", "slides" are dropped, they match every slide', p.keywords);
  check(!standInPlan('our most recent hospitality deck', ctx).keywords.includes('deck'), 'stand-in: "deck" is not a search word');
  const k = standInPlan('whats our most recent bank deck', ctx).keywords;
  check(JSON.stringify(k) === JSON.stringify(['bank']), 'stand-in: "whats our most recent bank deck" searches for "bank" only', k);
}

// ---- Short codes, and never "everything"
{
  const seen: SearchPlan[] = [];
  await smartSearch('QA/QC', 10, { context, thisYear: 2026, search: async (p) => { seen.push(p); return []; } });
  check(JSON.stringify(seen[0]?.keywords) === JSON.stringify(['qa/qc', 'qa', 'qc']), 'short codes: "QA/QC" searches for qa/qc, qa and qc', seen[0]?.keywords);
  const spelled: PlanReader = { name: 'fake', read: async () => cleanPlan({ keywords: ['quality assurance', 'quality control'] }, ctx) };
  const seenAi: SearchPlan[] = [];
  await smartSearch('Do we have a QA/QC slide?', 10, { context, thisYear: 2026, reader: spelled, search: async (p) => { seenAi.push(p); return []; } }, { read: true });
  check(['qa/qc', 'qa', 'qc', 'quality assurance'].every((k) => seenAi[0]?.keywords.includes(k)), 'short codes: the AI path searches "QA/QC" as typed too', seenAi[0]?.keywords);
  check(JSON.stringify(typedCodes('Can we add the org chart for the MSA?')) === JSON.stringify(['msa']) && typedCodes('which slides for a law firm').length === 0, 'short codes: only words typed as codes count');
  let called = false;
  const none = await smartSearch('the deck', 10, { context, thisYear: 2026, search: async () => { called = true; return [{ summary: slide('s1'), facts: facts() }]; } });
  check(!called && none.items.length === 0, 'a search with no usable words returns nothing, never the whole library');
}

// ---- The AI never finds less than typing
{
  const phrasey: PlanReader = { name: 'fake', read: async () => cleanPlan({ keywords: ['occupied building', 'working in occupied building'] }, ctx) };
  const r = await smartSearch('which slides show working in an occupied building?', 10, {
    context, thisYear: 2026, reader: phrasey,
    search: async (p) => (p.keywords.includes('building') ? [{ summary: slide('s1'), facts: facts({ title: 'Building programme' }) }] : []),
  }, { read: true });
  check(r.items.length === 1 && r.plan.keywords.includes('building'), 'fallback: when the AI\'s words find nothing, the person\'s own words are searched', r.plan.keywords);
}

// ---- Filters need evidence in the request
{
  const invented = cleanPlan({ keywords: ['tenant'], category: 'Business Proposal', bestOfTheBest: true, yearFrom: 2024, yearTo: 2026 }, ctx);
  const g = groundFilters(invented, 'we just won a 30-day contract in a building with another tenant');
  check(g.category === null && g.bestOfTheBest === null && g.yearFrom === null && g.yearTo === null, 'ground: filters nobody asked for are dropped', g);
  const asked = groundFilters(cleanPlan({ category: 'SME', bestOfTheBest: true, yearFrom: 2024, yearTo: 2026 }, ctx), 'recent best of the best SME slides');
  check(asked.category === 'SME' && asked.bestOfTheBest === true && asked.yearFrom === 2024, 'ground: filters the person typed are kept', asked);
}
{
  const eager: PlanReader = { name: 'fake', read: async () => cleanPlan({ keywords: ['tenant'], bestOfTheBest: true, category: 'IDD' }, ctx) };
  const r = await smartSearch('which slides for a shared building fit-out?', 10, { context, thisYear: 2026, reader: eager, search: async () => [] }, { read: true });
  check(r.plan.bestOfTheBest === null && r.plan.category === null, 'flow: a model\'s invented filters never reach the search', r.plan);
}

// ---- The model reads only what was submitted, once
{
  let calls = 0;
  const counting: PlanReader = { name: 'fake', read: async () => { calls++; return cleanPlan({ keywords: ['tenant'] }, ctx); } };
  const typing = await smartSearch('which slides for a shared building?', 10, { context, thisYear: 2026, reader: counting, search: async () => [] });
  check(calls === 0 && typing.reader === 'stand-in', 'flow: while typing (not submitted), even a question uses the rules');
  const cached = cachedReader(counting);
  await smartSearch('Which slides for a shared building?', 10, { context, thisYear: 2026, reader: cached, search: async () => [] }, { read: true });
  await smartSearch('which slides for a  shared building?', 10, { context, thisYear: 2026, reader: cached, search: async () => [] }, { read: true });
  check(calls === 1, 'cache: the same question twice calls the model once', calls);
  await cached.read('which slides for a shared building?', { ...ctx, clients: ['Kestrel Law'] });
  check(calls === 2, 'cache: a request that may see different clients is read again', calls);
  let t = 0;
  const expiring = cachedReader(counting, { ttlMs: 1000, now: () => t });
  await expiring.read('q', ctx); t = 2000; await expiring.read('q', ctx);
  check(calls === 4, 'cache: readings expire', calls);
}

// ---- Sample decks searched with the same rules as Postgres
{
  const index = {
    generatedAt: '',
    sources: [
      { id: 'src_a', title: 'Kestrel Law - SME', fileName: 'Kestrel Law - SME.pptx', versionId: 'ver_a', sha256: 'a', slides: [
        { id: 'sld_1', number: 1, title: 'Our team', text: 'Meet the people', hidden: false },
        { id: 'sld_2', number: 2, title: 'Budget', text: 'Cost plan for the team', hidden: false },
        { id: 'sld_3', number: 3, title: 'Lighting', text: 'Daylight study', hidden: false },
      ] },
    ],
  };
  const hits = smartSearchFixtures(index, cleanPlan({ keywords: ['team'] }, ctx), 10);
  check(hits.map((h) => h.summary.id).join() === 'sld_1,sld_2', 'fixtures: any keyword matches, title hits first', hits.map((h) => h.summary.id));
  check(smartSearchFixtures(index, cleanPlan({ keywords: ['team'], client: 'Northgate Bank' }, ctx), 10).length === 0, 'fixtures: filters apply');
  check(smartSearchFixtures(null, cleanPlan({ keywords: ['team'] }, ctx), 10).length === 0, 'fixtures: no index, no results, no error');
  const fv = fixtureFilterValues(index);
  check(fv.clients.includes('Kestrel Law') && fv.categories.includes('SME'), 'fixtures: client and category come from the file name', fv);
}

// ---- Which client names a model may see
check(JSON.stringify(relevantClients('team intro for a bank pitch', ctx.clients)) === '[]', 'clients: "bank" alone sends no client names');
check(JSON.stringify(relevantClients('Northgate Bank workplace', ctx.clients)) === JSON.stringify(['Northgate Bank']), 'clients: a named client is the only one sent');

// ---- Provider settings
check(readAiConfig({}).provider === 'none' && readerFromConfig(readAiConfig({})) === null, 'config: no provider means rules only');
{
  const c = readAiConfig({ SV_AI_PROVIDER: 'openai-compatible', SV_AI_BASE_URL: 'http://localhost:11434/v1/', SV_AI_MODEL: 'qwen3:8b' });
  check(c.provider === 'openai-compatible' && c.baseUrl === 'http://localhost:11434/v1' && c.apiKey === null && c.timeoutMs === 15000, 'config: local Qwen3 needs no key, trailing slash trimmed', c);
}
for (const [env, label] of [
  [{ SV_AI_PROVIDER: 'openai-compatible', SV_AI_MODEL: 'x' }, 'a provider without a base URL'],
  [{ SV_AI_PROVIDER: 'claude' }, 'an unknown provider'],
  [{ SV_AI_PROVIDER: 'openai-compatible', SV_AI_BASE_URL: 'http://x', SV_AI_MODEL: 'x', SV_AI_TIMEOUT_MS: '5' }, 'a silly timeout'],
] as [Record<string, string>, string][]) {
  let threw = false;
  try { readAiConfig(env); } catch { threw = true; }
  check(threw, `config: ${label} is an error, not a silent fallback`);
}

// ---- The OpenAI-compatible reader, against a fake API
{
  type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
  const box: { sent?: Sent } = {};
  const reply = (content: string) => async (url: string, init: RequestInit) => {
    box.sent = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    return Response.json({ choices: [{ message: { content, refusal: null } }] });
  };
  const plan = { summary: 'Team slides for a bank', keywords: ['team', 'our people'], topics: ['Team'], client: 'Northgate Bank', yearFrom: null, yearTo: null, category: null, bestOfTheBest: null };
  const local = openAiCompatibleReader({ baseUrl: 'http://localhost:11434/v1', apiKey: null, model: 'qwen3:8b', timeoutMs: 5000 }, reply(JSON.stringify(plan)));
  const p = await local.read('team for northgate', { ...ctx, clients: ['Northgate Bank'] });
  const s = box.sent as Sent;
  check(s.url === 'http://localhost:11434/v1/chat/completions' && !('authorization' in s.headers), 'reader: calls /chat/completions, no auth header without a key');
  const rf = s.body.response_format as { type: string; json_schema: { strict: boolean; name: string } };
  check(s.body.model === 'qwen3:8b' && rf.type === 'json_schema' && rf.json_schema.strict === true, 'reader: asks for the search_plan JSON schema, strict', rf);
  const system = String((s.body.messages as { content: string }[])[0].content);
  check(system.includes('Northgate Bank') && !system.includes('Kestrel Law'), 'reader: sends only the client names it was given');
  check(p.client === 'Northgate Bank' && p.keywords.includes('our people'), 'reader: plan read back and cleaned', p);

  await openAiCompatibleReader({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-x', timeoutMs: 5000 }, reply(JSON.stringify(plan))).read('x', ctx);
  check((box.sent as Sent).headers.authorization === 'Bearer sk-test', 'reader: hosted provider gets a bearer key');

  check(parsePlan('<think>the user wants team slides</think>\n{"summary":"x","keywords":["team"]}').keywords?.[0] === 'team', 'reader: a <think> block before the JSON is ignored');

  let threw = '';
  try {
    await openAiCompatibleReader({ baseUrl: 'https://api.openai.com/v1', apiKey: 'secret-123', model: 'gpt-x', timeoutMs: 5000 }, async () => Response.json({ error: { type: 'invalid_request_error' } }, { status: 401 })).read('x', ctx);
  } catch (e) { threw = (e as Error).message; }
  check(threw.includes('401') && !threw.includes('secret-123'), 'reader: an API error throws without the key in the message', threw);

  threw = '';
  try {
    await openAiCompatibleReader({ baseUrl: 'http://x/v1', apiKey: null, model: 'm', timeoutMs: 5000 }, async () => Response.json({ choices: [{ message: { content: null, refusal: 'no' } }] })).read('x', ctx);
  } catch (e) { threw = (e as Error).message; }
  check(threw.includes('declined'), 'reader: a refusal is an error, so the stand-in answers');
}

// ---- Rate limits
{
  resetRateLimits();
  const policy = { name: 'test', limit: 2, windowMs: 60_000 };
  const t = 1_000_000;
  const a = [hit(policy, 'a', t), hit(policy, 'a', t), hit(policy, 'a', t + 1000)];
  check(a[0].ok && a[1].ok && !a[2].ok && a[2].retryAfter === 59, 'rate: the third request in a minute waits out the window', a);
  check(hit(policy, 'b', t).ok, 'rate: callers are counted separately');
  check(hit(policy, 'a', t + 60_000).ok, 'rate: a new window starts fresh');
  resetRateLimits();
  const req = new Request('http://x/api', { headers: { 'x-forwarded-for': '10.0.0.9, 10.0.0.1' } });
  const tight = { name: 'tight', limit: 1, windowMs: 60_000 };
  const first = rateLimit(req, tight);
  const second = rateLimit(req, tight);
  const body = second ? ((await second.json()) as { error: { code: string; retryable: boolean } }) : null;
  check(first === null && second?.status === 429 && Boolean(second.headers.get('retry-after')) && body?.error.code === 'RATE_LIMITED' && body.error.retryable, 'rate: over the limit returns 429 RATE_LIMITED with Retry-After');
  resetRateLimits();
}

// ---- What a search asks for beyond its words (FD-33)
{
  const team = searchIntent('team slide for a healthcare client');
  check(team.types[0] === 'team_structure' && team.sectors.includes('healthcare'), 'intent: "team slide for a healthcare client" asks for a team slide and a healthcare client', team);
  check(searchIntent('design lead résumé from Acme').types[0] === 'team_resume', 'intent: "résumé" with accents is read as a résumé');
  check(JSON.stringify(searchIntent('sustainability slides for a bank')) === JSON.stringify({ types: [], sectors: ['financial services'], themes: ['sustainability / net zero'] }), 'intent: a theme and a sector, no kind');
  const structure = { type: 'team_structure', clientSector: 'healthcare / medtech' };
  const resume = { type: 'team_resume', clientSector: 'healthcare / medtech' };
  const bankTeam = { type: 'team_structure', clientSector: 'financial services' };
  check(intentScore(team, structure) > intentScore(team, resume) && intentScore(team, resume) > intentScore(team, bankTeam) - 3, 'intent: a team search puts the team structure ahead of résumés');
  check(intentScore(team, structure) > intentScore(team, bankTeam), "intent: a slide from a healthcare client's deck counts as healthcare");
  check(intentScore(team, { ...structure, reuse: 'internal - never show' }) < intentScore(team, bankTeam), 'intent: never-show pages stay findable, but last');
  check(answersIntent(team, structure) && !answersIntent(team, bankTeam) && !answersIntent(team, undefined), 'intent: only slides of the kind and sector asked for are let in without matching words');
  check(intentWhy(team, structure) === 'A team slide for the same kind of client.', 'intent: the slide says what it is in the search\'s terms', intentWhy(team, structure));

  const index = { generatedAt: '', sources: [{ id: 'src', title: 'Deck', fileName: 'Proposals/M Moser_Acme_2025.pptx', versionId: 'v', sha256: 'h', slides: [
    { id: 'words', number: 1, title: 'Our team', text: 'Team and people.', hidden: false },
    { id: 'reading', number: 2, title: 'Phased move', text: 'Floors handed over in stages.', hidden: false },
  ] }] };
  const plan = cleanPlan({ keywords: ['occupied'] }, ctx);
  const without = smartSearchFixtures(index, plan, 10).map((r) => r.summary.id);
  const withKnown = smartSearchFixtures(index, plan, 10, { about: (id) => (id === 'reading' ? 'A building that stayed occupied during the work.' : ''), boost: () => 0, answers: () => false }).map((r) => r.summary.id);
  check(without.length === 0 && JSON.stringify(withKnown) === '["reading"]', "search: a slide is found by what was read on it when its own words don't match", { without, withKnown });
  const boosted = smartSearchFixtures(index, cleanPlan({ keywords: ['team'] }, ctx), 10, { about: () => '', boost: (id) => (id === 'reading' ? 6 : 0), answers: (id) => id === 'reading' }).map((r) => r.summary.id);
  check(boosted[0] === 'reading', 'search: the kind asked for ranks ahead of word matches', boosted);
}

{
  // Identical copies of one file share slide ids; reading a list must not let the copies use up the limit.
  const copy = (id: string) => ({ id, title: id, fileName: `${id}.pptx`, versionId: 'same', sha256: 'same', slides: [{ id: 's1', number: 1, title: 'a', text: '', hidden: false }, { id: 's2', number: 2, title: 'b', text: '', hidden: false }] });
  const index = { generatedAt: '', sources: [copy('one'), copy('two'), { id: 'other', title: 'o', fileName: 'o.pptx', versionId: 'o', sha256: 'o', slides: [{ id: 's3', number: 1, title: 'c', text: '', hidden: false }] }] };
  const ids = fixtureRowsWhere(index, (id) => ['s1', 's2', 's3'].includes(id), 3).map((r) => r.summary.id);
  check(JSON.stringify(ids) === '["s1","s2","s3"]', 'rows: each slide is read once, so copies never crowd out the last ones asked for', ids);
}

// ---- What the person named is required when it's rare (FD-56: "HSBC case study" means HSBC)
{
  check(JSON.stringify(standInPlan('HSBC case study', ctx).named) === '["HSBC"]', 'named: "HSBC case study" names HSBC, the case study is a topic', standInPlan('HSBC case study', ctx).named);
  check(!(standInPlan('Kestrel Law team', ctx).named ?? []).length, 'named: a client is a filter, not a named word');
  check(mentionsWord('Our hospitals', 'hospital') && !mentionsWord('Hospitality suites', 'hospital'), 'named: whole words, plural allowed ("hospital" is not "hospitality")');
  check(mentionsWord('Résumés of the team', 'resume'), 'named: accents don\'t matter ("resume" finds "Résumés")');

  const row = (id: string, text: string, title = id) => ({ summary: slide(id), facts: facts({ title, text }) });
  const rows = [row('plain', 'Our approach to case studies.'), row('hsbc', 'HSBC regional headquarters case study.'), row('deckonly', 'A trading floor.')];
  const named = (q: string, d: Partial<Parameters<typeof smartSearch>[2]> = {}) =>
    smartSearch(q, 10, { context, thisYear: 2026, search: async () => rows, howCommon: () => 0.03, alsoSays: (s) => (s.id === 'deckonly' ? 'HSBC deck' : ''), ...d });
  const r = await named('HSBC case study');
  check(JSON.stringify(r.items.map((i) => i.slide.id)) === '["hsbc","deckonly"]', 'named: only slides that mention it, the slide\'s own words first, then its deck', r.items.map((i) => i.slide.id));
  check(r.chips.some((c) => c.kind === 'Mentions' && c.label === 'HSBC'), 'named: shown as a "Mentions" chip, as typed', r.chips);
  const common = await named('HSBC case study', { howCommon: () => 0.3 });
  check(common.items.length === 3 && !common.chips.some((c) => c.kind === 'Mentions'), 'named: a word on many slides only ranks, it isn\'t required');
  const sentence = await named('slides that demonstrate our value proposition', { howCommon: () => 0.01 });
  check(sentence.items.length === 3, 'named: in a sentence, an ordinary rare word ("proposition") isn\'t a name');
  const known = await smartSearch('which case studies are in toronto?', 10, { context, thisYear: 2026, search: async () => [row('a', 'Toronto office'), row('b', 'Vancouver office')], howCommon: () => 0.03, isKnownName: (w) => w === 'toronto' });
  check(JSON.stringify(known.items.map((i) => i.slide.id)) === '["a"]', 'named: in a sentence, a place the library knows is a name even in lower case', known.items.map((i) => i.slide.id));
  const sector = await smartSearch('hospital case study', 10, { context, thisYear: 2026, search: async () => [row('a', 'A clinic fit-out'), row('b', 'A bank')], howCommon: () => 0.01, alsoSays: (s) => (s.id === 'a' ? 'healthcare' : 'financial services'), alsoMeans: (w) => (w === 'hospital' ? ['healthcare'] : []) });
  check(JSON.stringify(sector.items.map((i) => i.slide.id)) === '["a"]', 'named: "hospital" is also met by a healthcare slide', sector.items.map((i) => i.slide.id));
  const bios = await smartSearch('HSBC', 10, { context, thisYear: 2026, search: async () => [row('bio', 'Led the HSBC fit-out'), row('case', 'HSBC case study')], howCommon: () => 0.03, rankLast: (s) => s.id === 'bio' });
  check(JSON.stringify(bios.items.map((i) => i.slide.id)) === '["case","bio"]', 'named: a passing mention in a bio comes last', bios.items.map((i) => i.slide.id));
  const missing = await named('Zephyr case study', { alsoSays: () => '' });
  check(missing.relaxed && missing.items.length === 3 && !missing.chips.some((c) => c.kind === 'Mentions'), 'named: when nothing mentions it, the rest is shown and marked relaxed');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smart search checks passed');
process.exit(failures ? 1 : 0);

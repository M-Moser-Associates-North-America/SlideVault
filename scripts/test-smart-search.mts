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
import { asksForCover, deckSections, isSectionSearch, sectionKind, sectionKinds, sectionMembers } from '../features/slide-vault/server/services/sections';
import { taggedFirst, typedTags, type TagHit } from '../features/slide-vault/server/services/tagged-first';
import { cleanSearchFeedback, learnedForSearch, learnedScore, searchWords, sinks } from '../features/slide-vault/server/search-feedback';
import { answersIntent, intentScore, intentWhy, searchIntent } from '../features/slide-vault/server/services/slide-intent';
import { cleanLabels, hasLabels, labelMenu, labelName, mergeLabels } from '../features/slide-vault/server/ai/label-menu';
import { byLearning, readerForSearch } from '../features/slide-vault/server/services/library-smart-search';

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
  const upd = standInPlan('2026 most updated slides', ctx);
  check(upd.yearFrom === 2026 && upd.yearTo === 2026 && upd.keywords.length === 0, 'stand-in: "2026, most updated slides" (Alina, 28 Oct) is the year, not the word "updated"', upd);
  const cur = standInPlan('most current slides', ctx);
  check(cur.yearFrom === 2024 && cur.keywords.length === 0, 'stand-in: "current" means recent work too', cur);
  // "Financial Services clients in Toronto" (31 Oct): an industry, then a place, not two slide types.
  const fin = standInPlan('Financial Services clients in Toronto', ctx);
  check(!fin.topics.includes('Services') && !fin.topics.includes('Cost and fees'), 'stand-in: "financial services" is the client\'s sector, not the Services or Cost and fees slide types', fin.topics);
  check(!(fin.named ?? []).some((w) => /financial|services/i.test(w)) && (fin.named ?? []).includes('Toronto'), 'stand-in: Toronto is the named thing; the sector words are not', fin.named);
  check(standInPlan('fees and the financial model', ctx).topics.includes('Cost and fees'), 'stand-in: "financial" on its own still asks for cost and fees slides');
  check(standInPlan('our professional services', ctx).topics.length === 0, 'stand-in: "professional services" is a sector too');
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

// ---- "Deeper AI search" (FD-79): a short search with the AI on says so, so the screen can invite more detail
{
  const reader: PlanReader = { name: 'fake', read: async () => cleanPlan({ keywords: ['team'] }, ctx) };
  const short = await smartSearch('team slides', 10, { context, thisYear: 2026, reader, search: async () => [] }, { read: true });
  check(short.aiSkipped === 'short' && short.reader === 'stand-in', 'ai: a short search asked for with the AI on is flagged "short" and read by the rules');
  const typing = await smartSearch('team slides', 10, { context, thisYear: 2026, reader, search: async () => [] });
  check(typing.aiSkipped === undefined, 'ai: typing (not submitted) is never flagged');
  const off = await smartSearch('team slides', 10, { context, thisYear: 2026, reader: null, search: async () => [] }, { read: true });
  check(off.aiSkipped === undefined, 'ai: with the AI off (or none set up) a short search is not flagged');
  const forced = await smartSearch('team slides', 10, { context, thisYear: 2026, reader, search: async () => [] }, { read: true, force: true });
  check(forced.reader === 'model' && forced.aiSkipped === undefined, 'ai: a short search the person chose the AI for anyway is read by the model');
  const forcedTyping = await smartSearch('team slides', 10, { context, thisYear: 2026, reader, search: async () => [] }, { force: true });
  check(forcedTyping.reader === 'stand-in', 'ai: forcing never reads while typing (only a submitted search)');
  const long = await smartSearch('which team slides should I use for a bank?', 10, { context, thisYear: 2026, reader, search: async () => [] }, { read: true });
  check(long.aiSkipped === undefined && long.reader === 'model', 'ai: a sentence is read by the model and not flagged');
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

// ---- The team's labels as a menu for the AI (FD-83)
{
  const menu = labelMenu(['healthcare', 'financial services', 'retail']);
  const withMenu: PlanContext = { ...ctx, labels: menu };
  const picked = cleanLabels({ slideTypes: ['Case_Study_Detail', 'not_a_type', 'team_resume', 'cover'], themes: ['HYBRID / flexible work', 'made up', 'AI', 'brand experience', 'health & wellbeing'], sectors: ['Healthcare', 'space travel', 'retail', 'financial services'] }, menu);
  check(picked.types.join() === 'case_study_detail,team_resume', 'labels: only menu values survive, spelled as the menu spells them, at most 2 types', picked.types);
  check(picked.themes.join() === 'hybrid / flexible work,AI,brand experience', 'labels: at most 3 themes, invented ones dropped', picked.themes);
  check(picked.sectors.join() === 'healthcare,retail', 'labels: at most 2 sectors, invented ones dropped', picked.sectors);
  check(!hasLabels(cleanLabels({ slideTypes: 'cover', themes: [1, null], sectors: {} }, menu)), 'labels: wrongly shaped answers become no labels');
  const merged = mergeLabels({ types: ['team_resume'], sectors: ['financial services'], themes: [] }, { types: ['team_resume', 'case_study_detail'], themes: ['AI'], sectors: ['Healthcare'] });
  check(merged.types.join() === 'team_resume,case_study_detail' && merged.themes.join() === 'AI' && merged.sectors.join() === 'financial services,healthcare', 'labels: the AI adds to what the rules read, never twice, sectors lowercase', merged);
  const rules = { types: ['cover'], sectors: [], themes: [] };
  check(mergeLabels(rules, undefined) === rules && mergeLabels(rules, { types: [], themes: [], sectors: [] }) === rules, 'labels: with nothing from the AI the rules\' reading is exactly as it was');
  check(labelName('case_study_detail') === 'Case study detail' && labelName('health & wellbeing') === 'Health & wellbeing' && labelName('AI') === 'AI', 'labels: shown the way a person reads them');

  // Through the whole flow: the AI's labels reach the search and show as chips, though they are not words in the request.
  const seen: (SearchPlan['labels'])[] = [];
  const reader: PlanReader = { name: 'fake', read: async () => cleanPlan({ summary: 'Staff wellbeing', keywords: ['wellbeing'], topics: ['Wellbeing'], themes: ['health & wellbeing'], slideTypes: ['case_study_detail', 'bogus'] }, withMenu) };
  const r = await smartSearch('slides that show we care about how our people feel at work?', 10, { context: async () => ({ ...ctx, labels: menu }), thisYear: 2026, reader, search: async (p) => { seen.push(p.labels); return []; } }, { read: true });
  check(seen[0]?.themes.join() === 'health & wellbeing' && seen[0]?.types.join() === 'case_study_detail', 'labels: the search is given the AI\'s labels', seen);
  check(r.chips.some((c) => c.kind === 'Label' && c.label === 'Health & wellbeing') && r.chips.some((c) => c.kind === 'Label' && c.label === 'Case study detail'), 'labels: the screen is told what the AI read, as Label chips', r.chips);
  const rules2 = await smartSearch('team slides', 10, { context: async () => ({ ...ctx, labels: menu }), thisYear: 2026, reader: null, search: async (p) => { seen.push(p.labels); return []; } }, { read: true });
  check(rules2.chips.every((c) => c.kind !== 'Label') && !hasLabels(seen[seen.length - 1]), 'labels: without the AI there are no AI labels', { seen, chips: rules2.chips });
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
  const withMenu: PlanContext = { ...ctx, clients: ['Northgate Bank'], labels: labelMenu(['healthcare']) };
  const labelled = { ...plan, slideTypes: ['team_resume', 'nope'], themes: ['inclusion & DEI'], sectors: ['healthcare'] };
  const lp = await openAiCompatibleReader({ baseUrl: 'http://localhost:11434/v1', apiKey: null, model: 'qwen3:8b', timeoutMs: 5000 }, reply(JSON.stringify(labelled))).read('people from different backgrounds', withMenu);
  const sys2 = String(((box.sent as Sent).body.messages as { content: string }[])[0].content);
  const schema = ((box.sent as Sent).body.response_format as { json_schema: { schema: { properties: Record<string, unknown>; required: string[] } } }).json_schema.schema;
  check(sys2.includes('hybrid / flexible work') && sys2.includes('team_resume: a team member') && sys2.includes('Sectors: healthcare'), 'reader: the label menu is in the instructions, names only');
  check(['slideTypes', 'themes', 'sectors'].every((k) => k in schema.properties && schema.required.includes(k)), 'reader: the reply format asks for slideTypes, themes and sectors');
  check(lp.labels?.types.join() === 'team_resume' && lp.labels?.themes.join() === 'inclusion & DEI' && lp.labels?.sectors.join() === 'healthcare', 'reader: labels read back and checked against the menu', lp.labels);
  check(!system.includes('Slide types (value'), 'reader: no menu offered, none in the instructions');

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
  // 3 Nov: the 9 slide types and 8 curated themes the rules didn't know, without catching sector words.
  check(searchIntent('cover letter for a bank').types[0] === 'cover_letter' && searchIntent('our awards').types.includes('awards') && searchIntent('scope and assumptions').types.includes('scope_assumptions') && searchIntent('design concept mood boards').types.includes('design_concept') && searchIntent('our understanding of the client').types.includes('client_understanding'), 'intent: the new slide types are read');
  check(searchIntent('DEI and belonging').themes.includes('inclusion & DEI') && searchIntent('feature stair').themes.includes('interconnecting stair / vertical connection') && searchIntent('BIM and VDC').themes.includes('VDC / 3D process') && searchIntent('masterplan for the portfolio').themes.includes('masterplanning & portfolio strategy') && searchIntent('AI in the workplace').themes.includes('AI'), 'intent: the new themes are read');
  const fin = searchIntent('financial services case study');
  const legal = searchIntent('legal client team slide');
  check(!fin.types.includes('capability_service') && fin.sectors.includes('financial services') && !legal.types.includes('legal_admin') && !searchIntent('private equity firm overview').themes.includes('inclusion & DEI') && !searchIntent('maintain the space').themes.includes('AI'), 'intent: sector words and words inside other words never trigger the new kinds or themes', { fin, legal });
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
  const everyone = smartSearchFixtures(index, cleanPlan({ keywords: [], client: null }, ctx), 2, { about: () => '', boost: () => 0, answers: () => true }).map((r) => r.summary.id);
  const skipped = smartSearchFixtures(index, cleanPlan({ keywords: [], client: null }, ctx), 1, { about: () => '', boost: () => 0, answers: () => true, skip: (s) => s.id === everyone[0] }).map((r) => r.summary.id);
  check(everyone.length === 2 && JSON.stringify(skipped) === JSON.stringify([everyone[1]]), 'fixtures: skipped (hidden) slides are left out before the limit, so the next slides fill it', { everyone, skipped });
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

// ---- What the person named is required when it's rare (FD-56: "QNBC case study" means QNBC)
{
  check(JSON.stringify(standInPlan('QNBC case study', ctx).named) === '["QNBC"]', 'named: "QNBC case study" names QNBC, the case study is a topic', standInPlan('QNBC case study', ctx).named);
  check(!(standInPlan('Kestrel Law team', ctx).named ?? []).length, 'named: a client is a filter, not a named word');
  check(mentionsWord('Our hospitals', 'hospital') && !mentionsWord('Hospitality suites', 'hospital'), 'named: whole words, plural allowed ("hospital" is not "hospitality")');
  check(mentionsWord('Résumés of the team', 'resume'), 'named: accents don\'t matter ("resume" finds "Résumés")');

  const row = (id: string, text: string, title = id) => ({ summary: slide(id), facts: facts({ title, text }) });
  const rows = [row('plain', 'Our approach to case studies.'), row('qnbc', 'QNBC regional headquarters case study.'), row('deckonly', 'A trading floor.')];
  const named = (q: string, d: Partial<Parameters<typeof smartSearch>[2]> = {}) =>
    smartSearch(q, 10, { context, thisYear: 2026, search: async () => rows, howCommon: () => 0.03, alsoSays: (s) => (s.id === 'deckonly' ? 'QNBC deck' : ''), ...d });
  const r = await named('QNBC case study');
  check(JSON.stringify(r.items.map((i) => i.slide.id)) === '["qnbc","deckonly"]', 'named: only slides that mention it, the slide\'s own words first, then its deck', r.items.map((i) => i.slide.id));
  check(r.chips.some((c) => c.kind === 'Mentions' && c.label === 'QNBC'), 'named: shown as a "Mentions" chip, as typed', r.chips);
  const common = await named('QNBC case study', { howCommon: () => 0.3 });
  check(common.items.length === 3 && !common.chips.some((c) => c.kind === 'Mentions'), 'named: a word on many slides only ranks, it isn\'t required');
  const sentence = await named('slides that demonstrate our value proposition', { howCommon: () => 0.01 });
  check(sentence.items.length === 3, 'named: in a sentence, an ordinary rare word ("proposition") isn\'t a name');
  const known = await smartSearch('which case studies are in toronto?', 10, { context, thisYear: 2026, search: async () => [row('a', 'Toronto office'), row('b', 'Vancouver office')], howCommon: () => 0.03, isKnownName: (w) => w === 'toronto' });
  check(JSON.stringify(known.items.map((i) => i.slide.id)) === '["a"]', 'named: in a sentence, a place the library knows is a name even in lower case', known.items.map((i) => i.slide.id));
  const sector = await smartSearch('hospital case study', 10, { context, thisYear: 2026, search: async () => [row('a', 'A clinic fit-out'), row('b', 'A bank')], howCommon: () => 0.01, alsoSays: (s) => (s.id === 'a' ? 'healthcare' : 'financial services'), alsoMeans: (w) => (w === 'hospital' ? ['healthcare'] : []) });
  check(JSON.stringify(sector.items.map((i) => i.slide.id)) === '["a"]', 'named: "hospital" is also met by a healthcare slide', sector.items.map((i) => i.slide.id));
  const bios = await smartSearch('QNBC', 10, { context, thisYear: 2026, search: async () => [row('bio', 'Led the QNBC fit-out'), row('case', 'QNBC case study')], howCommon: () => 0.03, rankLast: (s) => s.id === 'bio' });
  check(JSON.stringify(bios.items.map((i) => i.slide.id)) === '["case","bio"]', 'named: a passing mention in a bio comes last', bios.items.map((i) => i.slide.id));
  // Places (FD-56, 2 Nov): where the deck was made adds to the word, it doesn't replace it.
  // Search order: a generic slide from the Toronto deck, a case study elsewhere that prints Toronto,
  // then a case study from the Toronto deck that prints it (Schiffon's "recent IDD deck ... in Toronto").
  const place = (d: Partial<Parameters<typeof smartSearch>[2]> = {}) =>
    smartSearch('workplace in Toronto', 10, { context, thisYear: 2026, search: async () => [row('refs', 'Client references'), row('elsewhere', 'Case study: a bank in Toronto'), row('fidcase', 'Case study: our Toronto office')], howCommon: () => 0.03, alsoSays: (s) => (s.id === 'elsewhere' ? '' : 'Toronto'), ...d });
  const madeIn = (s: { id: string }) => (s.id === 'elsewhere' ? 'Vancouver' : 'Toronto');
  const before = (await place()).items.map((i) => i.slide.id);
  const after = (await place({ madeIn })).items.map((i) => i.slide.id);
  check(JSON.stringify(before) === '["elsewhere","fidcase","refs"]' && JSON.stringify(after) === '["fidcase","elsewhere","refs"]', 'named: printing the place and being from a deck made there comes first; a slide that says the place never drops below one that does not', { before, after });
  const bio = (await place({ madeIn, rankLast: (s) => s.id === 'elsewhere' })).items.map((i) => i.slide.id);
  check(JSON.stringify(bio) === '["fidcase","refs","elsewhere"]', 'named: a passing mention in a bio still goes last, after the rest of the Toronto deck', bio);
  const missing = await named('Zephyr case study', { alsoSays: () => '' });
  check(missing.relaxed && missing.items.length === 3 && !missing.chips.some((c) => c.kind === 'Mentions'), 'named: when nothing mentions it, the rest is shown and marked relaxed');
}

// ---- Deck sections, the "page breakers" (FD-57)
{
  const deck = (...pages: [string, string?][]) => ({ slides: pages.map(([title, text], i) => ({ id: `p${i + 1}`, number: i + 1, title, text: text ?? title, hidden: false })) });
  const names = (d: ReturnType<typeof deck>) => [...deckSections(d)].filter(([, s]) => s.divider).map(([id, s]) => `${id}:${s.kind}:${s.name}`);

  const numbered = deck(['Kestrel Law workplace'], ['01 Firm profile', '01\nFirm profile\nABOUT US'], ['Our founder', 'Founded 1981 by our founder'], ['02 Approach', '02\nApproach'], ['How we deliver', 'Weekly reviews'], ['03 Relevant experience', '03\nRelevant experience\nWHERE WE’VE DONE IT'], ['Halcyon Health HQ']);
  check(JSON.stringify(names(numbered)) === '["p2:firm:Firm profile","p4:approach:Approach","p6:case-studies:Relevant experience"]', 'sections: numbered dividers name their sections', names(numbered));
  const sec = deckSections(numbered);
  check(sec.get('p3')?.kind === 'firm' && sec.get('p3')?.position === 1 && sec.get('p3')?.dividerId === 'p2', 'sections: a slide belongs to the section it sits in, and knows its place', sec.get('p3'));
  check(!sec.has('p1'), 'sections: slides before the first divider have none');
  const members = sectionMembers(sec, 'p2');
  check(members.length >= 2 && members[0][0] === 'p2' && members[0][1].divider && members.every(([, m], i) => m.position === i && m.dividerId === 'p2'), 'sections: a whole section is listed from its divider in deck order', members.map(([id]) => id));
  check(sectionMembers(sec, 'nope').length === 0, 'sections: an unknown divider lists nothing');

  const lettered = deck(['A FIRM BACKGROUND WHO WE ARE KESTREL X M MOSER', 'A FIRM BACKGROUND WHO WE ARE KESTREL X M MOSER\n4\nFirm\nBackground'], ['A FIRM BACKGROUND WHO WE ARE KESTREL X M MOSER', 'Offices in 30 cities'], ['F PROPOSED TEAM AND RESUMES KESTREL X M MOSER', 'F PROPOSED TEAM AND RESUMES KESTREL X M MOSER\n44\nProposed\nTeam and Resumes'], ['F PROPOSED TEAM AND RESUMES KESTREL X M MOSER', 'Jane Doe, design lead']);
  check(JSON.stringify(names(lettered)) === '["p1:firm:Firm Background","p3:team:Proposed Team and Resumes"]', 'sections: a PDF\'s lettered heading opens a section once, not on every page', names(lettered));

  const titled = deck(['Design Services RFP', 'Design Services RFP\nM Moser x Kestrel 2025\nSection 00\nOur\nunderstanding\nof Kestrel'], ['Your goals'], ['Design Services RFP', 'Design Services RFP\nM Moser x Kestrel 2025\nSection 01\nCompany\nbackground'], ['Who we are'], ['Design Services RFP', 'Design Services RFP\nM Moser x Kestrel 2025\nSection 02\nMEET THE MEET THE TEAM\nTEAM']);
  check(JSON.stringify(names(titled)) === '["p1:understanding:Our understanding of Kestrel","p3:firm:Company background","p5:team:Meet the team"]', 'sections: a document title on every divider is skipped, the name comes after "Section 00", doubled words undone', names(titled));

  const contents = deck(['What’s inside', 'TABLE OF CONTENTS\n01\nThe right team\n02\nThe portfolio'], ['Intro'], ['THE RIGHT TEAM', 'THE RIGHT TEAM'], ['Jane Doe'], ['THE PORTFOLIO', 'THE PORTFOLIO'], ['Halcyon Health HQ']);
  check(JSON.stringify(names(contents)) === '["p3:team:The right team","p5:case-studies:The portfolio"]', 'sections: an unnumbered divider listed on the contents page is found', names(contents));

  // Styles from the Oct 29 Drive decks (made-up words, same shapes).
  const colon = deck(['WHAT TO EXPECT', 'Section:      00\nWHAT TO EXPECT'], ['Your goals', 'Grow the team to 400'], ['COMPANY BACKGROUND', 'Section:      01\nCOMPANY BACKGROUND'], ['appendix', 'Section:      AA\nappendix']);
  check(JSON.stringify(names(colon)) === '["p1:other:What to expect","p3:firm:Company background","p4:appendix:appendix"]', 'sections: "Section: 01" with a colon, and "Section: AA", name the section after the marker', names(colon));

  const nameOnly = deck(['STRATEGY & APPROACH', 'STRATEGY\n& APPROACH\nPAGE 14\nM MOSER ASSOCIATES\nMMOSER.COM\nSTRATEGY & APPROACH'], ['Our plan', 'Three phases over nine months for the move'], ['Design process', 'Design process\nPAGE 16'], ['RELEVANT EXPERIENCE', 'RELEVANT\nEXPERIENCE\nPAGE 20\nM MOSER ASSOCIATES\nMMOSER.COM']);
  check(JSON.stringify(names(nameOnly)) === '["p1:approach:Strategy & approach","p4:case-studies:Relevant experience"]', 'sections: an unnumbered slide that is only a section name (beside the page footer) opens one; a sub-heading of the same kind does not', names(nameOnly));

  const running = deck(['Relevant Experience', 'Relevant Experience\nSECTION 03\nCASE STUDIES'], ['North America', 'North America\nNEW YORK, BOSTON\nSECTION 03'], ['KESTREL X M MOSER SECTION 03', 'SECTION 03'], ['Fee Structure', 'Fee Structure\nSECTION 04\nPRICING']);
  check(JSON.stringify(names(running)) === '["p1:case-studies:Relevant Experience","p4:fees:Fee Structure"]', 'sections: "SECTION 03" printed on every page of a section doesn\'t start it again', names(running));

  const midNumber = deck(['Visio 01 The N', 'Visio\nOUR UNDERSTANDING\n01\nThe\nN'], ['Your goals', 'Grow the team to 400 people'], ['How we 04 do it', 'How we\n04\ndo it\nPROPOSED APPROACH & PROCESS']);
  check(JSON.stringify(names(midNumber)) === '["p1:understanding:Our understanding","p3:approach:How we do it"]', 'sections: a number set inside the title opens a section; scrambled words fall back to the subtitle', names(midNumber));

  check(JSON.stringify(sectionKinds('Firm background / relevant experience')) === '["case-studies","firm"]' && sectionKind('Appendix B Team resumes') === 'team' && sectionKind('Appendix') === 'appendix' && sectionKind('How we will run the portfolio') === 'approach', 'sections: a name can be two sections; an appendix of résumés is the team; "How we…" is the approach');
  check(sectionKind('How we think') === 'firm' && sectionKind('Project phases') === 'approach' && sectionKind("We've done this before") === 'case-studies', 'sections: Alina\'s creative divider names (28 Oct): "How we think" is the firm, "phases" the approach');
  check(isSectionSearch('resumes') && isSectionSearch('banner slides in case studies') && isSectionSearch('firm overview') && !isSectionSearch('QNBC case study') && !isSectionSearch('Workplace strategy process') && !isSectionSearch('2026'), 'sections: a search that is only a section, with nothing else named');
  check(asksForCover('banner slides in case studies') && asksForCover('the page breakers') && !asksForCover('case studies'), 'sections: asking for a cover');
}

// ---- People's own tags lead (FD-58: Gabby tags the page "Priya", then types Priya)
{
  const sl = (id: string, deck = 'd') => ({ ...slide(id), provenance: { ...slide(id).provenance, sourceId: deck } });
  const items = [{ slide: sl('a'), why: 'Matched.', matched: [] }, { slide: sl('b', 'deck2'), why: 'Matched.', matched: [] }, { slide: sl('c'), why: 'Matched.', matched: [] }];
  const hits: TagHit[] = [{ tag: 'Priya', on: 'slide', id: 'm' }, { tag: 'Priya', on: 'deck', id: 'deck2' }, { tag: 'Moi', on: 'slide', id: 'c' }];
  let asked: string[] = [];
  const out = await taggedFirst('Priya resume', items, hits, async (ids) => { asked = ids; return ids.map((id) => sl(id)); });
  check(JSON.stringify(out.map((i) => i.slide.id)) === '["m","b","a","c"]', 'tags: the tagged slide first (fetched if search missed it), then its tagged deck, then the rest', out.map((i) => i.slide.id));
  check(JSON.stringify(asked) === '["m"]', 'tags: only slides the search missed are fetched', asked);
  check(out[0].why.startsWith('Tagged “Priya” by someone') && out[1].why.startsWith('Tagged “Priya” (its deck)'), 'tags: the reason says which tag', out.slice(0, 2).map((i) => i.why));
  check(JSON.stringify(typedTags('Priya resume', hits).map((h) => h.tag)) === '["Priya","Priya"]', 'tags: whole words only ("Moi" is not typed in "Priya")');
  const none = await taggedFirst('case studies', items, hits, async () => []);
  check(none === items, 'tags: a search that types no tag is left as it was');
}

// ---- Useful / Not relevant on a search result (FD-59: "how do I train the search?")
{
  check(JSON.stringify(searchWords('Show me hospitality firms slides')) === '["hospitality","firm"]', 'feedback: a search is kept as its words, never as typed', searchWords('Show me hospitality firms slides'));
  check(cleanSearchFeedback({ query: 'hospitality', slideId: 's1', verdict: 'not-relevant' })?.words.join() === 'hospitality', 'feedback: a valid not-relevant');
  check(cleanSearchFeedback({ query: 'hospitality', slideId: 's1', verdict: 'nope' }) === null && cleanSearchFeedback({ query: '', slideId: 's1', verdict: 'useful' }) === null && cleanSearchFeedback({ query: 'the', slideId: 's1', verdict: 'useful' }) === null, 'feedback: bad verdict, empty search or no words is refused');
  const at = '2026-10-29T00:00:00Z';
  const rows = [
    { slideId: 'bio', verdict: 'not-relevant' as const, words: ['hospitality'], at },
    { slideId: 'bio', verdict: 'not-relevant' as const, words: ['hospitality', 'deck'], at, by: 'director' as const },
    { slideId: 'case', verdict: 'useful' as const, words: ['hospitality'], at },
    { slideId: 'other', verdict: 'not-relevant' as const, words: ['fees'], at },
  ];
  const l = learnedForSearch(rows, ['hospitality']);
  check(l.get('bio')?.notRelevant === 2 && l.get('case')?.useful === 1 && !l.has('other'), 'feedback: counts only searches that share a word', Object.fromEntries(l));
  check(learnedForSearch(rows, ['hospitality'], 'director').get('bio')?.notRelevant === 3, 'feedback: someone in the same role counts double');
  check(learnedScore(l.get('case')) > 0 && learnedScore(l.get('bio')) < 0 && learnedScore(undefined) === 0, 'feedback: useful moves a slide up, not relevant moves it down');
  // Khushali, 2 Nov: Not relevant on "hospitality decks" must not follow the slide into "hospitality case studies"
  // (FD-81: it now leans a little, in proportion to the words shared, and can never send the slide last).
  const other = learnedForSearch(rows, searchWords('hospitality case studies'));
  check(!sinks(other.get('bio')) && (other.get('bio')?.notRelevant ?? 0) < 1 && (other.get('case')?.useful ?? 0) < 1, 'feedback: a click from a partly-similar search counts only in part, and never sends a slide last', Object.fromEntries(other));
  check(learnedForSearch(rows, searchWords('hospitality case studies'), null, 'any').has('bio'), 'feedback: the storyboard still learns from any shared word (its briefs are long)');
  const oneClick = learnedForSearch([rows[0]], ['hospitality'], 'director');
  check(sinks(l.get('bio')) && !sinks(learnedForSearch([rows[0]], ['hospitality']).get('bio')) && !sinks(learnedForSearch([{ ...rows[0], by: 'director' as const }], ['hospitality'], 'director').get('bio')) && !!oneClick, 'feedback: going last takes two Not relevant clicks; one click (even same role) only nudges');
}

{
  // The database's results learn too (FD-78): useful first, not relevant last, its own order otherwise.
  const rows = ['a', 'b', 'c', 'd'].map((id) => ({ summary: { id } }));
  const learned = new Map([['c', { useful: 2, notRelevant: 0 }], ['a', { useful: 0, notRelevant: 1, notRelevantVotes: 1 }], ['b', { useful: 0, notRelevant: 2, notRelevantVotes: 2 }]]);
  const order = byLearning(rows, learned).map((r) => r.summary.id).join('');
  check(order === 'cadb', 'feedback on the database: marked useful leads, two Not relevant clicks go last, one click keeps its place', order);
  check(byLearning(rows, new Map()).map((r) => r.summary.id).join('') === 'abcd', 'feedback on the database: with nothing marked, the order is unchanged');
}

{
  // "Deeper AI search" checkbox (FD-79): unticked skips the AI reader for that search only.
  const fake: PlanReader = { name: 'fake', read: async () => standInPlan('x', ctx) };
  check(readerForSearch(fake, 'off') === null, 'deeper AI off: ai=off skips the AI reader');
  check(readerForSearch(fake, null) === fake && readerForSearch(fake, 'on') === fake, 'deeper AI on: without ai=off the configured reader is used');
  check(readerForSearch(null, 'on') === null, 'deeper AI: ai=on never turns on a reader the server does not have');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smart search checks passed');
process.exit(failures ? 1 : 0);

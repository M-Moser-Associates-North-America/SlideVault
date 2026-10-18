/**
 * Quick AI search checks (docs/DECISIONS.md FD-15). No database and no real Claude calls:
 * the reader, the search and Claude's API are all stand-ins here.
 *
 *   npm run test:smart-search
 */
import type { SlideSummary } from '../features/slide-vault/contracts/dto';
import { claudePlan, DEFAULT_MODEL } from '../features/slide-vault/server/ai/claude';
import { anyOfQuery, chipsFor, cleanPlan, standInPlan, whyItFits, type PlanContext, type SearchPlan, type SlideFacts } from '../features/slide-vault/server/ai/search-plan';
import { smartSearch } from '../features/slide-vault/server/services/smart-search';

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
  check(r.reader === 'stand-in' && r.readerNote === null, 'flow: no key means the stand-in, with no warning');
  check(calls.length === 2 && r.relaxed && r.items.length === 1, 'flow: when filters leave nothing, it searches again without them and says so', { calls: calls.length, relaxed: r.relaxed });
  check(!r.items[0].why.includes('from the Kestrel Law deck'), 'flow: a relaxed result does not claim to match the dropped filter', r.items[0].why);
}
{
  const r = await smartSearch('team', 10, { context, thisYear: 2026, claude: async () => { throw new Error('timeout'); }, search: async () => [], log: () => {} });
  check(r.reader === 'stand-in' && Boolean(r.readerNote), 'flow: if Claude fails, the stand-in answers and the screen is told');
}
{
  const r = await smartSearch('people', 10, { context, thisYear: 2026, claude: async () => cleanPlan({ summary: 'Team slides', keywords: ['team'], topics: ['Team'] }, ctx), search: async (p) => [{ summary: slide('s1'), facts: facts({ title: p.keywords[0] }) }] });
  check(r.reader === 'claude' && r.items[0].matched[0] === 'team', 'flow: Claude\'s plan is what gets searched');
}

// ---- The Claude adapter, against a fake API
{
  type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
  const box: { sent?: Sent } = {};
  const fetchFn = async (url: string, init: RequestInit) => {
    box.sent = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    return Response.json({ content: [{ type: 'tool_use', name: 'search_plan', input: { summary: 'Team slides for a bank', keywords: ['team', 'our people'], topics: ['Team'], client: 'Northgate Bank', yearFrom: null, yearTo: null, category: null, bestOfTheBest: null } }] });
  };
  const p = await claudePlan('team for a bank', ctx, { env: { ANTHROPIC_API_KEY: 'test-key' }, fetchFn });
  const s = box.sent as Sent;
  check(s.url === 'https://api.anthropic.com/v1/messages' && s.headers['x-api-key'] === 'test-key' && s.headers['anthropic-version'] === '2023-06-01', 'claude: calls the Messages API with the key header');
  check(s.body.model === DEFAULT_MODEL && (s.body.tool_choice as { name: string }).name === 'search_plan', 'claude: default model and forced search_plan tool');
  check(JSON.stringify(s.body.messages).includes('team for a bank') && String(s.body.system).includes('Kestrel Law'), 'claude: sends the request and the client list, nothing else', s.body);
  check(p.client === 'Northgate Bank' && p.keywords.includes('our people'), 'claude: plan read back and cleaned', p);

  let threw = '';
  try {
    await claudePlan('x', ctx, { env: { ANTHROPIC_API_KEY: 'secret-123' }, fetchFn: async () => Response.json({ error: { type: 'authentication_error' } }, { status: 401 }) });
  } catch (e) { threw = (e as Error).message; }
  check(threw.includes('401') && !threw.includes('secret-123'), 'claude: an API error throws without the key in the message', threw);

  threw = '';
  try { await claudePlan('x', ctx, { env: {} }); } catch (e) { threw = (e as Error).message; }
  check(threw.includes('ANTHROPIC_API_KEY'), 'claude: no key, no call');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smart search checks passed');
process.exit(failures ? 1 : 0);

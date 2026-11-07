/**
 * The AI usage log (FD-91) and the cap on AI calls at once (FD-92), with a pretend AI provider. No database,
 * no real model; the log goes to a temporary folder.
 *
 *   npm run test:ai-usage
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'sv-ai-usage-'));
process.env.SLIDEVAULT_DATA_DIR = dir;
for (const k of ['SV_DB_HOST', 'SV_DB_PASSWORD']) delete process.env[k];

const { chatJson } = await import('../features/slide-vault/server/ai/openai-compatible');
const { aiCallsRunning, aiUsageTotals, asPerson, maxConcurrentAi, totalsOf, withAiSlot } = await import('../features/slide-vault/server/ai/usage');

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${JSON.stringify(detail)}` : ''}`);
}

const config = { baseUrl: 'http://ai.test/v1', apiKey: null, model: 'test-model', timeoutMs: 5000 };
const job = { system: 's', user: 'u', name: 'search_plan', schema: {} };
/** A pretend provider that answers after `ms`, reporting tokens like OpenAI does. */
const provider = (ms = 0) => async () => {
  await new Promise((r) => setTimeout(r, ms));
  return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"ok"}' } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }), { status: 200 });
};
const settle = () => new Promise((r) => setTimeout(r, 50));
const logged = () => readFileSync(path.join(dir, 'ai-usage.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// Every call is logged with who, which feature, the model and the provider's token counts; never the text.
await asPerson('Priya', () => chatJson(config, provider(), job));
await asPerson('Sam', () => chatJson(config, provider(), { ...job, name: 'storyboard' }));
await settle();
const rows = logged();
check(rows.length === 2 && rows[0].user === 'Priya' && rows[0].feature === 'search_plan' && rows[0].model === 'test-model' && rows[0].promptTokens === 120 && rows[0].completionTokens === 30 && rows[0].ok, 'log: who, feature, model and tokens are recorded per call', rows[0]);
check(!JSON.stringify(rows).includes('"u"') && !JSON.stringify(rows).includes('summary'), 'log: the request text and the answer are never kept');

// A failed call is logged as failed, with no tokens.
const broken = async () => new Response('{}', { status: 500 });
await asPerson('Priya', () => chatJson(config, broken, job)).catch(() => {});
await settle();
check(logged()[2]?.ok === false && logged()[2]?.promptTokens === 0, 'log: a failed call is counted as failed', logged()[2]);

// Per-person totals, most tokens first.
const totals = await aiUsageTotals({ days: 1 });
const priya = totals.find((t) => t.user === 'Priya');
check(priya?.calls === 2 && priya.failed === 1 && priya.totalTokens === 150 && priya.byFeature.search_plan === 2, 'totals: calls, failures and tokens per person', priya);
check((await aiUsageTotals({ days: 1, user: 'Sam' })).length === 1, 'totals: one person can be asked for alone');
check(totalsOf([{ user: null, feature: 'x', model: 'm', promptTokens: 1, completionTokens: 1, ms: 1, ok: true }])[0].user === '(not signed in)', 'totals: calls without a signed-in person are grouped together');

// At most N calls at once: the next one is refused straight away, not queued (FD-92).
const max = 2;
const slow = Array.from({ length: max }, () => withAiSlot(() => new Promise((r) => setTimeout(r, 200)), max));
const t0 = Date.now();
const extra = await withAiSlot(async () => 'ran', max).catch((e: Error) => e.name);
check(extra === 'AiBusyError' && Date.now() - t0 < 50, 'cap: past the limit an AI call is refused at once', extra);
await Promise.all(slow);
check(aiCallsRunning() === 0 && (await withAiSlot(async () => 'ran', max)) === 'ran', 'cap: room again once calls finish');
check(maxConcurrentAi({}) === 4 && maxConcurrentAi({ SV_AI_MAX_CONCURRENT: '10' }) === 10 && maxConcurrentAi({ SV_AI_MAX_CONCURRENT: 'lots' }) === 4, 'cap: SV_AI_MAX_CONCURRENT, default 4');

// Fifty people at once with a cap of 4: 4 reach the AI, the rest are told it's busy (and search answers with its rules).
process.env.SV_AI_MAX_CONCURRENT = '4';
const fifty = await Promise.all(Array.from({ length: 50 }, (_, i) => asPerson(`p${i}`, () => chatJson(config, provider(100), job)).then(() => 'ai', (e: Error) => e.name)));
check(fifty.filter((r) => r === 'ai').length === 4 && fifty.filter((r) => r === 'AiBusyError').length === 46, 'cap: 50 at once, 4 go to the AI and 46 get quick results', { ai: fifty.filter((r) => r === 'ai').length });

// The search says why when the AI is busy.
const { smartSearch } = await import('../features/slide-vault/server/services/smart-search');
const busyReader = { name: 'busy', read: async () => { const e = new Error('busy'); e.name = 'AiBusyError'; throw e; } };
const res = await smartSearch('which slides show our approach to a phased move for a bank?', 5, { context: async () => ({ clients: [], categories: [] }), reader: busyReader, search: async () => [] }, { read: true });
check(res.readerNote === 'AI is busy right now, so quick results are shown.' && res.reader === 'stand-in', 'search: when the AI is busy, rules answer and the note says so', res.readerNote);

if (failures) {
  console.error(`\n${failures} AI usage check(s) failed`);
  process.exit(1);
}
console.log('\nAll AI usage checks passed');
process.exit(0);

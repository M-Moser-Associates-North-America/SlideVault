// The words behind a crossed-out chip stay in the search; only their reading is switched off (search-ignore.ts).
import assert from 'node:assert/strict';
import { ignoredWords, parseIgnore, withoutIgnored } from '../features/slide-vault/server/services/search-ignore';
import { searchIntent } from '../features/slide-vault/server/services/slide-intent';
import { standInPlan } from '../features/slide-vault/server/ai/search-plan';
import { smartSearch } from '../features/slide-vault/server/services/smart-search';
import { wordsBehindChip } from '../features/slide-vault/components/search-reading';
import { parseQuery } from '../features/slide-vault/components/search-rules';

assert.deepEqual(parseIgnore(null), []);
assert.deepEqual(parseIgnore('case studies| 2024 |case studies||'), ['case studies', '2024']);
assert.equal(parseIgnore('a|b|c|d|e|f|g|h').length, 6, 'at most 6 phrases');
assert.deepEqual(parseIgnore('x'.repeat(80)), [], 'long phrases are dropped');

assert.equal(withoutIgnored('bank case studies section', ['case studies']), 'bank section');
assert.equal(withoutIgnored('Bank CASE   Studies section', ['case studies']), 'Bank section', 'any case, any spacing');
assert.equal(withoutIgnored('showcase studies', ['case studies']), 'showcase studies', 'whole words only');
assert.equal(withoutIgnored('bank 2024 and 2024', ['2024']), 'bank and');
assert.equal(withoutIgnored('anything', []), 'anything');
assert.deepEqual(ignoredWords(['case studies', '2024']), ['case', 'studies', '2024']);

// The reading really is off: "case studies" asks for a kind of slide; without it, nothing is asked for.
assert.ok(searchIntent('bank case studies section').types.length > 0, 'the rules read case studies as a kind of slide');
assert.equal(searchIntent(withoutIgnored('bank case studies section', ['case studies'])).types.length, 0, 'ignored: no kind of slide is asked for');
const ctx = { clients: [], categories: [], labels: { types: [], themes: [], sectors: [] }, thisYear: 2026 };
assert.ok(standInPlan('bank case studies section', ctx as never).topics.length > 0, 'the rules read a topic');
assert.equal(standInPlan(withoutIgnored('bank case studies section', ['case studies']), ctx as never).topics.length, 0, 'ignored: no topic');

// Which typed words made a chip: asked of the rules themselves, so it works when the chip's name shares nothing with the words.
const chipFor = (q: string, kind: string) => { const c = parseQuery(q, []).chips.find((x) => x.kind === kind)!; return { kind, label: c.label } as never; };
assert.deepEqual(wordsBehindChip('bank past projects', chipFor('bank past projects', 'Topic'), 'Portfolio'), ['projects'], '"past projects" is read as the Portfolio topic by the word projects');
assert.deepEqual(wordsBehindChip('bank portfolio', chipFor('bank portfolio', 'Topic'), 'Portfolio'), ['portfolio']);
assert.deepEqual(wordsBehindChip('bank case studies section', chipFor('bank case studies section', 'Topic'), 'Case study'), ['case studies'], 'plural and the chip name differ from the typed words');
assert.deepEqual(wordsBehindChip('team intro 2025', chipFor('team intro 2025', 'Year')), ['2025']);
assert.deepEqual(wordsBehindChip('bank', { kind: 'Topic', label: 'Something else' } as never), [], 'nothing in the words can be tied to this chip');

// The AI path: the route hands the reader the request without the ignored words, and the words are still searched.
{
  const seen: string[] = [];
  const reader = { name: 'stand-in-model', read: async (q: string, c: never) => { seen.push(q); return { ...standInPlan(q, c), summary: 'what the model understood' }; } };
  const deps = { context: async () => ({ clients: [], categories: [] }), search: async () => [], reader, thisYear: 2026 } as never;
  const q = 'show me the case studies we have done for bank clients';
  const whole = await smartSearch(q, 10, deps, { read: true, force: true });
  assert.equal(whole.reader, 'model'); assert.equal(seen[0], q, 'without ignore the reader gets the whole request');
  assert.ok(whole.chips.some((c) => c.kind === 'Topic'), 'the model reading shows the topic chip');
  const ignore = ['case studies']; const masked = withoutIgnored(q, ignore);
  const off = await smartSearch(masked, 10, deps, { read: true, force: true, alsoWords: ignoredWords(ignore) });
  assert.equal(off.reader, 'model'); assert.ok(!/case studies/.test(seen[1]), 'the reader never sees the ignored words: ' + seen[1]);
  assert.ok(!off.chips.some((c) => c.kind === 'Topic'), 'no topic chip once its words are ignored');
  assert.ok(off.plan.keywords.includes('case') && off.plan.keywords.includes('studies'), 'the ignored words are still searched as plain words');
}
console.log('search-ignore: all checks passed');

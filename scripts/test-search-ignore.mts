// The words behind a crossed-out chip stay in the search; only their reading is switched off (search-ignore.ts).
import assert from 'node:assert/strict';
import { ignoredWords, parseIgnore, withoutIgnored } from '../features/slide-vault/server/services/search-ignore';
import { searchIntent } from '../features/slide-vault/server/services/slide-intent';
import { standInPlan } from '../features/slide-vault/server/ai/search-plan';

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
console.log('search-ignore: all checks passed');

/**
 * How Useful / Not relevant teach search (docs/DECISIONS.md FD-59, FD-78, FD-81). No database: clicks
 * are kept in a temporary folder on this computer, like on a laptop without database settings.
 *
 *   npm run test:search-learning
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'sv-learning-'));
process.env.SLIDEVAULT_DATA_DIR = dir;
for (const k of ['SV_MMOSER_DATABASE_URL', 'DATABASE_URL', 'SUPABASE_URL']) delete process.env[k];

const { cleanSearchFeedback, learnedForSearch, learnedScore, recordSearchFeedback, retractSearchFeedback, searchLearning, searchSimilarity, searchWords, sinks, MAX_LEARNED } = await import('../features/slide-vault/server/search-feedback');
const { byLearning } = await import('../features/slide-vault/server/services/library-smart-search');

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === '' ? '' : ` ${JSON.stringify(detail)}`}`);
}
const at = '2026-11-03T00:00:00Z';
const row = (slideId: string, verdict: 'useful' | 'not-relevant', words: string[], by?: 'director') => ({ slideId, verdict, words, at, ...(by ? { by } : {}) });
const many = (n: number, slideId: string, verdict: 'useful' | 'not-relevant', words: string[]) => Array.from({ length: n }, () => row(slideId, verdict, words));
const score = (rows: ReturnType<typeof row>[], id: string, words = ['hospitality']) => learnedScore(learnedForSearch(rows, words).get(id));

// 1. Equal both ways
{
  const up = score([row('x', 'useful', ['hospitality'])], 'x');
  const down = score([row('x', 'not-relevant', ['hospitality'])], 'x');
  check(up > 0 && up === -down, 'one Useful and one Not relevant move a slide the same amount, in opposite ways', { up, down });
  check(score([row('x', 'useful', ['hospitality']), row('x', 'not-relevant', ['hospitality'])], 'x') === 0, 'one of each cancels out');
  check(learnedScore(undefined) === 0, 'no clicks, no move');
}

// 3. Ratio, not a count
{
  const ten = [...many(10, 'x', 'useful', ['hospitality']), ...many(3, 'x', 'not-relevant', ['hospitality'])];
  check(score(ten, 'x') > 0, 'ten Useful against three Not relevant is still clearly up (it used to be pushed down)', score(ten, 'x'));
  const one = score(many(1, 'x', 'useful', ['hospitality']), 'x');
  const three = score(many(3, 'x', 'useful', ['hospitality']), 'x');
  const thirty = score(many(30, 'x', 'useful', ['hospitality']), 'x');
  check(one < three && three < thirty && thirty < MAX_LEARNED, 'more agreeing clicks move a slide further, but never past the cap', { one, three, thirty });
  const noisy = score([...many(5, 'x', 'useful', ['hospitality']), ...many(5, 'x', 'not-relevant', ['hospitality'])], 'x');
  check(noisy === 0, 'an even split does not move it');
}

// Going last needs a clear verdict
{
  const get = (rows: ReturnType<typeof row>[]) => learnedForSearch(rows, ['hospitality']).get('x');
  check(!sinks(get(many(1, 'x', 'not-relevant', ['hospitality']))), 'one Not relevant never sends a slide last');
  check(sinks(get(many(2, 'x', 'not-relevant', ['hospitality']))), 'two Not relevant, nobody saying useful, does');
  check(!sinks(get([...many(3, 'x', 'useful', ['hospitality']), ...many(3, 'x', 'not-relevant', ['hospitality'])])), 'a split verdict (3 useful, 3 not relevant) keeps its place');
  check(sinks(get([...many(1, 'x', 'useful', ['hospitality']), ...many(3, 'x', 'not-relevant', ['hospitality'])])), 'a clear majority against (1 useful, 3 not relevant) goes last');
}

// 2. Similar searches count in proportion
{
  const rows = [row('x', 'not-relevant', ['hospitality']), row('x', 'not-relevant', ['hospitality'])];
  const closer = learnedForSearch(rows, searchWords('hospitality firms')).get('x');
  check(closer?.notRelevant === 2 && sinks(closer), 'hospitality and hospitality firms are the same search: full weight');
  const partly = learnedForSearch(rows, searchWords('hospitality case studies')).get('x');
  check(!!partly && Math.abs(partly.notRelevant - 2 / 3) < 1e-9 && !sinks(partly), 'hospitality vs hospitality case studies: a third of the weight, never last', partly);
  check(!learnedForSearch(rows, searchWords('fees and pricing')).has('x'), 'a search sharing no word learns nothing');
  check(searchSimilarity(['a', 'b'], new Set(['a', 'b'])) === 1 && searchSimilarity([], new Set(['a'])) === 0, 'similarity: same words 1, nothing shared 0');

  // The case that started it: downvoted for "hospitality decks", perfect for "hospitality case studies".
  const both = [row('x', 'not-relevant', ['hospitality']), row('x', 'useful', ['hospitality', 'case', 'studi'])];
  const l = learnedForSearch(both, searchWords('hospitality case studies'));
  check(learnedScore(l.get('x')) > 0, 'a Useful in the closer search beats an earlier Not relevant in the looser one', Object.fromEntries(l));
  const order = byLearning([{ summary: { id: 'x' } }, { summary: { id: 'y' } }], l).map((r) => r.summary.id).join('');
  check(order === 'xy', 'and it stays at the top of the results');
}

// The storyboard still takes any shared word, in full
{
  const l = learnedForSearch([row('x', 'not-relevant', ['hospitality'])], searchWords('hospitality case studies for a hotel group'), null, 'any');
  check(l.get('x')?.notRelevant === 1, 'storyboard briefs: one shared word counts in full');
}

// Role weighting is kept (FD-25)
{
  const l = learnedForSearch([row('x', 'useful', ['hospitality'], 'director')], ['hospitality'], 'director').get('x');
  check(l?.useful === 2, 'same role counts double');
}

// Order of database results: more useful leads, and a stray click keeps its place
{
  const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ summary: { id } }));
  const learned = new Map([
    ['c', { useful: 3, notRelevant: 0 }],
    ['d', { useful: 1, notRelevant: 0 }],
    ['a', { useful: 0, notRelevant: 1, notRelevantVotes: 1 }],
    ['b', { useful: 0, notRelevant: 2, notRelevantVotes: 2 }],
  ]);
  const order = byLearning(rows, learned).map((r) => r.summary.id).join('');
  check(order === 'cdaeb', 'database results: most useful first, then one that is just nudged, then the sunk one last', order);
  // One Useful in a search that only shares some words must not jump a slide ahead of everything (3 Nov review).
  const loose = learnedForSearch([row('p', 'useful', ['hospitality', 'case', 'studi'])], searchWords('hospitality'));
  const looseOrder = byLearning(['a', 'p', 'b'].map((id) => ({ summary: { id } })), loose).map((r) => r.summary.id).join('');
  check(learnedScore(loose.get('p')) > 0 && looseOrder === 'apb', 'database results: one partly-similar Useful nudges the score but keeps the database order', { looseOrder, score: learnedScore(loose.get('p')) });
  const strong = learnedForSearch([row('p', 'useful', ['hospitality'])], searchWords('hospitality'));
  check(byLearning(['a', 'p', 'b'].map((id) => ({ summary: { id } })), strong).map((r) => r.summary.id).join('') === 'pab', 'database results: one Useful in the same search still lifts it to the top');
}

// Changing your mind takes the old click back (kept in a file here)
{
  const f = cleanSearchFeedback({ query: 'hospitality case studies', slideId: 's1', verdict: 'not-relevant' });
  const g = cleanSearchFeedback({ query: 'hospitality case studies', slideId: 's1', verdict: 'not-relevant', undo: true });
  check(!!f && !f.undo && g?.undo === true, 'a take-back request is recognised; a normal click is not one');
  await recordSearchFeedback(f!);
  await recordSearchFeedback(f!);
  let l = await searchLearning('hospitality case studies');
  check(l.get('s1')?.notRelevant === 2, 'two clicks are saved');
  await retractSearchFeedback(g!);
  l = await searchLearning('hospitality case studies');
  check(l.get('s1')?.notRelevant === 1, 'taking one back leaves exactly one');
  await retractSearchFeedback({ ...g!, verdict: 'useful' });
  await retractSearchFeedback({ ...g!, slideId: 'other' });
  l = await searchLearning('hospitality case studies');
  check(l.get('s1')?.notRelevant === 1, 'taking back something never saved changes nothing');
  await retractSearchFeedback(g!);
  l = await searchLearning('hospitality case studies');
  check(!l.has('s1'), 'taking the last one back clears it');
  check(readFileSync(path.join(dir, 'search-feedback.jsonl'), 'utf8') === '', 'the file is left empty, not damaged');
}

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nAll search learning checks passed');
process.exit(failures ? 1 : 0);

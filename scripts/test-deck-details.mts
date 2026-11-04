/**
 * Same-file-in-two-folders checks (docs/DECISIONS.md FD-11), using the synthetic library's real folders.
 *
 *   npm run test:deck-details
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describeChanges, detailsToAdd, type DeckDetails } from '../features/slide-vault/server/deck-details';
import { folderInfo } from '../features/slide-vault/server/folder-path';

const LIBRARY = path.resolve(import.meta.dirname, '../tests/fixtures/sharepoint-library');
let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : n.endsWith('.pptx') ? [f] : [];
  });

// What upload would store for a deck from this folder
const asStored = (rel: string): DeckDetails => {
  const i = folderInfo(rel);
  return { client: i.clientName ?? 'Unknown client', year: i.deckYear, category: i.category, bestOfTheBest: i.bestOfTheBest };
};
const apply = (d: DeckDetails, rel: string): DeckDetails => ({ ...d, ...detailsToAdd(d, asStored(rel)) });

// Group files by content: the same bytes in two folders
const byHash = new Map<string, string[]>();
for (const f of walk(LIBRARY)) {
  const h = createHash('sha256').update(readFileSync(f)).digest('hex');
  byHash.set(h, [...(byHash.get(h) ?? []), path.relative(LIBRARY, f).split(path.sep).join('/')]);
}
const pairs = [...byHash.values()].filter((v) => v.length === 2);
check(pairs.length === 6, `found the 6 Best of the Best decks that are copies of a submittal (${pairs.length})`);

for (const pair of pairs) {
  const sub = pair.find((p) => p.startsWith('Submittals/'))!;
  const best = pair.find((p) => p.startsWith('Best of the Best/'))!;
  const want = { ...asStored(sub), bestOfTheBest: true, category: asStored(best).category };
  const a = apply(asStored(best), sub); // Best of the Best first (what happened on Oct 12)
  const b = apply(asStored(sub), best); // Submittal first
  const same = (x: DeckDetails) => x.year === want.year && x.client === want.client && x.category === want.category && x.bestOfTheBest;
  check(same(a) && same(b), `${path.basename(sub)}: one deck gets year, client, category and Best of the Best, in either order`,
    JSON.stringify({ a, b, want }));
}

const full: DeckDetails = { client: 'Kestrel Law', year: 2024, category: 'SME', bestOfTheBest: true };
check(Object.keys(detailsToAdd(full, full)).length === 0, 'a copy that adds nothing changes nothing (still reported as a duplicate)');
check(Object.keys(detailsToAdd(full, { client: 'Other', year: 2019, category: 'IDD', bestOfTheBest: false })).length === 0,
  'never overwrites a year, client or category, and never turns Best of the Best off');
check(detailsToAdd({ client: 'Unknown client', year: null, category: null, bestOfTheBest: false }, { client: 'Kestrel Law', year: null, category: null, bestOfTheBest: false }).client === 'Kestrel Law',
  '"Unknown client" counts as missing and gets filled in');
check(JSON.stringify(describeChanges({ bestOfTheBest: true, year: 2024 })) === JSON.stringify(['Best of the Best', 'year 2024']),
  'says in plain words what was added');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll deck-details checks passed');
process.exit(failures ? 1 : 0);

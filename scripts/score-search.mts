/**
 * Score search against the SharePoint-style library's test queries.
 *
 *   npm run score:search
 *
 * A report, not a pass/fail check: it shows how many test queries find a correct slide in the top 10
 * (PRD v2.1 success metric "Search finds the right slide": proposed target 8 of 10). Run it after every
 * search change and compare. Replace or extend tests/fixtures/sharepoint-library/search_queries.csv with
 * the business development team's real queries when they arrive.
 *
 * A result counts as correct when its slide matches every filled-in expect_* column, using the planted
 * answers in answer_key.csv. Best of the Best copies count too, since they are the same slide.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { LibraryIndex } from '../features/slide-vault/server/library-repository';
import { searchSlides } from '../features/slide-vault/server/services/search';
import { extractSlides } from '../workers/slide-vault/processors/extract-text';

const LIBRARY = path.resolve(import.meta.dirname, '../tests/fixtures/sharepoint-library');
const TOP = 10;

const csv = (file: string) => {
  const [head, ...lines] = readFileSync(path.join(LIBRARY, file), 'utf8').trim().split('\n');
  const keys = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [keys[i], v])) as Record<string, string>);
};
const key = new Map(csv('answer_key.csv').map((r) => [`${r.file}#${r.slide_number}`, r]));
const queries = csv('search_queries.csv');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : n.endsWith('.pptx') ? [full] : [];
  });

const index: LibraryIndex = { generatedAt: new Date().toISOString(), sources: [] };
for (const file of walk(LIBRARY).sort()) {
  const rel = path.relative(LIBRARY, file).split(path.sep).join('/');
  const slides = await extractSlides(new Uint8Array(readFileSync(file)));
  index.sources.push({
    id: rel,
    title: path.basename(rel, '.pptx'),
    fileName: rel,
    versionId: `ver_${rel}`,
    sha256: '',
    slides: slides.map((s) => ({ id: `${rel}#${s.number}`, ...s })),
  });
}
const titleOf = new Map(index.sources.flatMap((s) => s.slides.map((sl) => [sl.id, sl.title] as const)));

const correct = (q: Record<string, string>, slideId: string) => {
  const a = key.get(slideId);
  if (!a) return false;
  return (
    (!q.expect_client || a.client === q.expect_client) &&
    (!q.expect_year || a.year === q.expect_year) &&
    (!q.expect_category || a.category === q.expect_category) &&
    (!q.expect_type || a.slide_type === q.expect_type) &&
    (!q.expect_title_contains || (titleOf.get(slideId) ?? '').includes(q.expect_title_contains))
  );
};

const byStyle = new Map<string, [number, number]>();
let found = 0;
for (const q of queries) {
  const { items, total } = searchSlides(index, { query: q.query, cursor: null, limit: TOP });
  const rank = items.findIndex((s) => correct(q, s.id));
  const hit = rank >= 0;
  if (hit) found++;
  const [h, n] = byStyle.get(q.style) ?? [0, 0];
  byStyle.set(q.style, [h + (hit ? 1 : 0), n + 1]);
  console.log(`${hit ? 'FOUND' : 'MISS '}  ${q.id} ${q.style.padEnd(7)} "${q.query}"  (${total} results${hit ? `, correct at #${rank + 1}` : ''})`);
}
console.log(`\nFound a correct slide in the top ${TOP} for ${found} of ${queries.length} queries`);
for (const [style, [h, n]] of byStyle) console.log(`  ${style.padEnd(7)} ${h} of ${n}`);

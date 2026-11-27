/**
 * Duplicate-grouping checks, run against the SharePoint-style synthetic library.
 *
 *   npx tsx --conditions=react-server scripts/test-duplicates.mts
 *
 * Uses the real text extraction (workers/slide-vault/processors/extract-text.ts) and the planted
 * slide types in tests/fixtures/sharepoint-library/answer_key.csv as known answers:
 *  - every Best of the Best copy groups with its Submittals original
 *  - the identical "Our values" slide groups across all decks that have it
 *  - "About us" slides that differ by one number group as a near match
 *  - no group mixes slide types, and covers for different clients never group
 *  - the same template with a different subject (two "Expert insight" topics) stays separate
 *  - group IDs are stable across runs; nothing is removed from the input
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { SlideSummary } from '../features/slide-vault/contracts/dto';
import { groupDuplicates, type SlideText } from '../features/slide-vault/server/duplicates';
import { withDuplicateBadges } from '../features/slide-vault/server/services/duplicate-badges';
import { extractSlides } from '../workers/slide-vault/processors/extract-text';

const LIBRARY = path.resolve(import.meta.dirname, '../tests/fixtures/sharepoint-library');
let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : name.endsWith('.pptx') ? [full] : [];
  });

// Answer key: "file,slide_number" -> slide type (the CSV has no quoted commas)
const typeOf = new Map<string, string>();
for (const line of readFileSync(path.join(LIBRARY, 'answer_key.csv'), 'utf8').trim().split('\n').slice(1)) {
  const cols = line.split(',');
  typeOf.set(`${cols[0]}#${cols[5]}`, cols[6]);
}

const slides: SlideText[] = [];
for (const file of walk(LIBRARY).sort()) {
  const rel = path.relative(LIBRARY, file).split(path.sep).join('/');
  for (const s of await extractSlides(new Uint8Array(readFileSync(file)))) {
    slides.push({ id: `${rel}#${s.number}`, sourceId: rel, title: s.title, text: s.text });
  }
}

const groups = groupDuplicates(slides);
const groupOf = new Map(groups.flatMap((g) => g.slideIds.map((id) => [id, g] as const)));

check(slides.length === typeOf.size, `read every slide in the answer key (${slides.length})`);

const copies = slides.filter((s) => s.sourceId.startsWith('Best of the Best/'));
const originalOf = (id: string) => {
  const [file, n] = id.split('#');
  const name = file.split('/').pop()!;
  return slides.find((s) => s.sourceId.startsWith('Submittals/') && s.sourceId.endsWith(`/${name}`) && s.id.endsWith(`#${n}`))!;
};
check(
  copies.every((c) => groupOf.get(c.id) && groupOf.get(c.id) === groupOf.get(originalOf(c.id).id)),
  'every Best of the Best slide groups with its Submittals original',
);

const values = slides.filter((s) => typeOf.get(s.id) === 'Values');
const valueGroup = groupOf.get(values[0].id);
check(values.length > 1 && values.every((s) => groupOf.get(s.id) === valueGroup) && valueGroup?.match === 'identical',
  `the identical "Our values" slide forms one group (${values.length} slides, ${valueGroup?.deckCount} decks)`);

const about = slides.filter((s) => typeOf.get(s.id) === 'About us');
const aboutGroup = groupOf.get(about[0].id);
check(about.every((s) => groupOf.get(s.id) === aboutGroup) && aboutGroup?.match === 'near',
  `"About us" slides that differ by one number group as a near match (${aboutGroup?.deckCount} decks)`);

const mixed = groups.filter((g) => new Set(g.slideIds.map((id) => typeOf.get(id))).size > 1);
check(mixed.length === 0, 'no group mixes slide types', mixed.map((g) => g.slideIds.join(' + ')).join(' | '));

const coverClients = new Set(
  groups.filter((g) => typeOf.get(g.slideIds[0]) === 'Cover').map((g) => new Set(g.slideIds.map((id) => id.split('/').pop()!.split(' - ')[0])).size),
);
check([...coverClients].every((n) => n === 1), 'covers only group with copies of the same client deck');

const insights = slides.filter((s) => s.title.startsWith('Expert insight:'));
const crossTopic = insights.filter((a) => insights.some((b) => a.title !== b.title && groupOf.get(a.id) && groupOf.get(a.id) === groupOf.get(b.id)));
check(insights.length > 1 && crossTopic.length === 0, `"Expert insight" slides on different topics stay separate (${insights.length} slides)`,
  crossTopic.map((s) => s.title).join(' | '));

check(JSON.stringify(groupDuplicates(slides).map((g) => g.id)) === JSON.stringify(groups.map((g) => g.id)), 'group IDs are stable across runs');
check(new Set(groups.flatMap((g) => g.slideIds)).size === groups.reduce((n, g) => n + g.slideIds.length, 0), 'each slide is in at most one group');
check(slides.length === typeOf.size, 'grouping removes nothing from the library');

// --- "Also in N decks" on search results ---
const summary = (s: SlideText): SlideSummary => ({
  id: s.id, title: s.title, hiddenInSource: false, previewPath: '',
  provenance: { sourceId: s.sourceId, sourceVersionId: 'v', sourceTitle: s.sourceId, sourceFileName: s.sourceId, slideNumber: Number(s.id.split('#')[1]),
    owner: null, approvalStatus: null, reviewedAt: null },
});
const slideDeck = new Map(slides.map((s) => [s.id, s.sourceId]));
const allCards = withDuplicateBadges(slides.map(summary), groups, slideDeck);
check(allCards.length === slides.length - grouped0() + groups.length, `a search over everything shows one card per group (${allCards.length} cards for ${slides.length} slides)`);
const valuesCard = allCards.find((c) => typeOf.get(c.id) === 'Values');
check(valuesCard?.alsoIn?.otherDeckCount === (valueGroup?.deckCount ?? 0) - 1 && valuesCard?.alsoIn?.match === 'identical',
  `the "Our values" card says it's also in ${(valueGroup?.deckCount ?? 0) - 1} other decks`, JSON.stringify(valuesCard?.alsoIn));
const loner = slides.find((s) => !groupOf.get(s.id))!;
check(allCards.find((c) => c.id === loner.id)?.alsoIn === null, 'a slide with no copies has no badge');
// One result from a group: the badge still counts the whole library, not just the results
const oneCopy = withDuplicateBadges([summary(values[2])], groups, slideDeck);
check(oneCopy.length === 1 && oneCopy[0].alsoIn?.otherDeckCount === (valueGroup?.deckCount ?? 0) - 1,
  'a single search hit still shows how many other decks have it');
// The first result from a group is the one kept
const order = withDuplicateBadges([summary(values[3]), summary(values[0])], groups, slideDeck);
check(order.length === 1 && order[0].id === values[3].id, 'when several copies match, the first result is the card shown');

function grouped0() { return groups.reduce((n, g) => n + g.slideIds.length, 0); }
const grouped = groups.reduce((n, g) => n + g.slideIds.length, 0);
console.log(`\n${groups.length} groups covering ${grouped} of ${slides.length} slides; search would show ${slides.length - grouped + groups.length} cards`);
console.log(failures ? `${failures} check(s) failed` : 'All duplicate checks passed');
process.exit(failures ? 1 : 0);

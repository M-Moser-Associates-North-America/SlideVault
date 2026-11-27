/**
 * Loads what each slide looks like into M Moser's Supabase (docs/DECISIONS.md FD-99), so search by look
 * ("maps", "the org chart", "the slide that looks like a waterfall") needs no files beside the app.
 *
 *   npm run looks:import -- --data ~/Desktop/MMoser-RealData          # dry run: shows what would change
 *   npm run looks:import -- --data ~/Desktop/MMoser-RealData --yes    # writes it
 *
 * Reads, from the data folder (never the repo: they describe real decks), the team's look files (FD-86):
 *   look-sort.json        the picture sorter's look for every slide preview
 *   file-clues.json       looks the deck file itself gives away (real tables, diagram layouts)
 *   visual-scan.json      the local describing model's look, where it has run
 *   waterfall-check.json  which diagram slides are waterfalls
 *
 * Slides are matched exactly, not by name: the files' slide id is made from the deck file's SHA-256 and
 * the slide number, and Supabase keeps the same SHA-256 for every uploaded deck. PDF pages and decks
 * that aren't in Supabase are skipped and counted.
 *
 * Safe to run again: it sets the look of the slides the files cover and never clears a slide the files
 * don't mention, so looks loaded from a newer scan of other decks stay.
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { FILE_CLUES_FILE, LOOK_SORT_FILE, VISUAL_SCAN_FILE, WATERFALL_FILE, fileSlideId, looksFromFiles } from '../features/slide-vault/server/look-files';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1].replace(/^~(?=$|\/)/, os.homedir()) : undefined;
};
const dataDir = opt('--data');
const yes = args.includes('--yes');
if (!dataDir) {
  console.error('Give the folder with the look files, e.g. npm run looks:import -- --data ~/Desktop/MMoser-RealData');
  process.exit(1);
}

// ---- reading the files ----------------------------------------------------------------------
type Rows = Record<string, { look?: unknown; waterfall?: unknown }>;
const readJson = (file: string): Rows | undefined => {
  const p = path.join(dataDir, file);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Rows) : undefined;
};
const files = { sorted: readJson(LOOK_SORT_FILE), clues: readJson(FILE_CLUES_FILE), visual: readJson(VISUAL_SCAN_FILE), waterfall: readJson(WATERFALL_FILE) };
const fileLooks = looksFromFiles(files);
if (!fileLooks.size) {
  console.error(`No looks found in ${dataDir}: expected ${LOOK_SORT_FILE}, ${FILE_CLUES_FILE}, ${VISUAL_SCAN_FILE} or ${WATERFALL_FILE}.`);
  process.exit(1);
}

// ---- connecting -----------------------------------------------------------------------------
const env: Record<string, string> = {};
const envFile = path.resolve(import.meta.dirname, '..', '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^(SV_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
}
for (const [k, v] of Object.entries(process.env)) if (k.startsWith('SV_DB_') && v) env[k] = v;
const ssl = env.SV_DB_SSL === 'disable' ? false : env.SV_DB_CA_FILE ? { ca: readFileSync(env.SV_DB_CA_FILE, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: false };
const client = new pg.Client({ host: env.SV_DB_HOST, port: Number(env.SV_DB_PORT), database: env.SV_DB_NAME || 'postgres', user: env.SV_DB_USER, password: env.SV_DB_PASSWORD, ssl });
await client.connect();
await client.query(`set role slidevault_developer; set search_path to ${pg.escapeIdentifier(env.SV_DB_SCHEMA)}, public`);

const hasColumn = await client.query(`select 1 from information_schema.columns where table_schema = $1 and table_name = 'slides' and column_name = 'looks'`, [env.SV_DB_SCHEMA]);
if (!hasColumn.rowCount) {
  console.error('The looks column is not in the database yet. Run npm run db:setup first, then this again.');
  await client.end();
  process.exit(1);
}

// ---- matching -------------------------------------------------------------------------------
type Deck = { id: string; title: string; file_hash: string; archived_at: Date | null };
type Slide = { id: string; deck_id: string; slide_number: number; looks: string[] };
const decks = (await client.query<Deck>('select id, title, file_hash, archived_at from decks order by title')).rows;
const slides = (await client.query<Slide>('select id, deck_id, slide_number, looks from slides order by deck_id, slide_number')).rows;
const slidesByDeck = new Map<string, Slide[]>();
for (const s of slides) slidesByDeck.set(s.deck_id, [...(slidesByDeck.get(s.deck_id) ?? []), s]);

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const updates: { id: string; looks: string[] }[] = [];
const used = new Set<string>();
const counts = new Map<string, number>();
const report: { deck: Deck; slides: number; covered: number; changed: number }[] = [];
for (const d of decks) {
  const own = slidesByDeck.get(d.id) ?? [];
  let covered = 0, changed = 0;
  for (const s of own) {
    const key = fileSlideId(d.file_hash, s.slide_number);
    const looks = fileLooks.get(key);
    if (!looks) continue;
    used.add(key);
    covered++;
    for (const l of looks) counts.set(l, (counts.get(l) ?? 0) + 1);
    if (!same(looks, s.looks ?? [])) {
      updates.push({ id: s.id, looks });
      changed++;
    }
  }
  report.push({ deck: d, slides: own.length, covered, changed });
}

// ---- the report -----------------------------------------------------------------------------
console.log(`${yes ? 'IMPORT' : 'DRY RUN: nothing is changed.'}\n`);
console.log(`Files: a look for ${fileLooks.size} slide(s) in ${dataDir}.\n`);
console.log('Decks in Supabase:');
for (const r of report) {
  const what = r.covered ? `${r.covered} of ${r.slides} slides have a look${r.changed ? `, ${r.changed} to set` : ', already loaded'}` : `no looks in the files (${r.slides} slides)`;
  console.log(`  ${r.deck.title}${r.deck.archived_at ? ' [archived]' : ''}: ${what}`);
}
const withLooks = report.filter((r) => r.covered).length;
const coveredSlides = report.reduce((n, r) => n + r.covered, 0);
console.log(`\n${withLooks} of ${decks.length} deck(s) covered, ${coveredSlides} of ${slides.length} slide(s).`);
if (counts.size) console.log(`Looks: ${[...counts].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(', ')}.`);
const unused = [...fileLooks.keys()].filter((k) => !used.has(k));
if (unused.length) console.log(`Not in Supabase (deck not uploaded, another version of the file, or a PDF): ${unused.length} slide(s) from the files, of which ${unused.filter((k) => k.startsWith('pdf_')).length} PDF page(s).`);
console.log(`\n${updates.length} slide(s) get a look.`);

// ---- writing --------------------------------------------------------------------------------
if (!yes) {
  console.log('\nNothing was changed. Run again with --yes to write it.');
} else if (updates.length) {
  await client.query('begin');
  try {
    for (let i = 0; i < updates.length; i += 500) {
      const batch = updates.slice(i, i + 500);
      await client.query(
        `update slides s set looks = u.looks from (select (x->>'id')::uuid as id, array(select jsonb_array_elements_text(x->'looks')) as looks from jsonb_array_elements($1::jsonb) x) u where s.id = u.id`,
        [JSON.stringify(batch)],
      );
    }
    await client.query('commit');
    console.log(`\nDone: ${updates.length} slide(s) updated.`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
} else {
  console.log('\nNothing to write: the database already has these looks.');
}
await client.end();

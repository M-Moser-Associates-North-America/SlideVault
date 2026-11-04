/**
 * Puts back the spaces lost at line breaks in slide titles and text for decks already uploaded
 * ("Harbor StudioLisbon" -> "Harbor Studio Lisbon"). Older uploads read a line break inside a text box
 * as nothing; extract-text.ts now reads it as a space, so new uploads are fine. This is for the rest.
 *
 *   npm run slides:spacing -- ~/Desktop/MMoser-RealDecks          # dry run: shows what it would change
 *   npm run slides:spacing -- ~/Desktop/MMoser-RealDecks --yes    # changes it
 *
 * Reads every .pptx under the folder, matches it to an uploaded deck by its SHA-256, and re-reads
 * each slide. It only changes a title or text when the only difference is spacing, so anything a
 * person edited is left alone. Afterwards, run `npm run embed:slides -- --yes` so meaning search
 * reads the corrected words (only the changed slides are redone). Uses your SV_DB_* login.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { extractSlides } from '../workers/slide-vault/processors/extract-text';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const folder = args.find((a) => !a.startsWith('--'))?.replace(/^~(?=$|\/)/, os.homedir());
if (!folder || !existsSync(folder)) {
  console.error('Give the folder with the deck files, e.g. npm run slides:spacing -- ~/Desktop/MMoser-RealDecks');
  process.exit(1);
}
const files: string[] = [];
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.toLowerCase().endsWith('.pptx')) files.push(full);
  }
};
walk(folder);

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

type Deck = { id: string; title: string; file_hash: string };
type Slide = { id: string; slide_number: number; title: string | null; text: string | null };
const decks = (await client.query<Deck>('select id, title, file_hash from decks order by title')).rows;
const byHash = new Map(decks.map((d) => [d.file_hash.toLowerCase(), d]));
/** Same words once spacing is ignored: the only kind of change this script makes. */
const sameIgnoringSpaces = (a: string | null, b: string) => (a ?? '').replace(/\s+/g, '') === b.replace(/\s+/g, '');

console.log(`${yes ? 'FIXING SPACING' : 'DRY RUN: nothing is changed.'} Reading ${files.length} .pptx file(s) under ${folder}...\n`);
const seen = new Set<string>();
const changes: { id: string; title: string | null; text: string | null }[] = [];
const examples: string[] = [];
for (const file of files) {
  const bytes = readFileSync(file);
  const deck = byHash.get(createHash('sha256').update(bytes).digest('hex'));
  if (!deck || seen.has(deck.id)) continue;
  seen.add(deck.id);
  const stored = new Map((await client.query<Slide>('select id, slide_number, title, text from slides where deck_id = $1', [deck.id])).rows.map((s) => [s.slide_number, s]));
  let n = 0;
  for (const fresh of await extractSlides(new Uint8Array(bytes))) {
    const s = stored.get(fresh.number);
    if (!s) continue;
    const title = s.title !== fresh.title && sameIgnoringSpaces(s.title, fresh.title) ? fresh.title : null;
    const text = (s.text ?? '') !== fresh.text && sameIgnoringSpaces(s.text, fresh.text) ? fresh.text : null;
    if (!title && !text) continue;
    changes.push({ id: s.id, title, text });
    n++;
    if (title && examples.length < 8) examples.push(`"${s.title}" -> "${title}"`);
  }
  console.log(`  ${deck.title}: ${n ? `${n} slide(s) get their spaces back` : 'nothing to fix'}`);
}
const missing = decks.filter((d) => !seen.has(d.id));
if (missing.length) console.log(`\nNo file found here for: ${missing.map((d) => d.title).join(', ')}`);
if (examples.length) console.log(`\nFor example:\n  ${examples.join('\n  ')}`);

if (!yes) {
  console.log(`\n${changes.length} slide(s) would change. Nothing changed yet: add --yes to do it.`);
} else {
  await client.query('begin');
  for (const c of changes) await client.query('update slides set title = coalesce($2, title), text = coalesce($3, text) where id = $1', [c.id, c.title, c.text]);
  await client.query('commit');
  console.log(`\nDone: ${changes.length} slide(s) fixed. Next: npm run embed:slides -- --yes (redoes only these).`);
}
await client.end();

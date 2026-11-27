/**
 * Fills in deck details for decks already uploaded (docs/DECISIONS.md FD-52): who created each deck
 * and when, as PowerPoint recorded it inside the file, who uploaded it, and where the deck was made
 * when its file name says ("M Moser_Client_TO_2026" is Toronto). New uploads record these
 * themselves; this is for the ones that went in before.
 *
 *   npm run deck:details -- ~/Desktop/MMoser-RealDecks                               # dry run: shows what it would set
 *   npm run deck:details -- ~/Desktop/MMoser-RealDecks --uploaded-by "Your Name"     # also who uploaded them
 *   npm run deck:details -- ~/Desktop/MMoser-RealDecks --uploaded-by "Your Name" --yes
 *
 * Reads every .pptx under the folder, matches it to an uploaded deck by its SHA-256 (the same
 * fingerprint the upload stored), and only fills details that are empty. Real values only: a file
 * with no author recorded stays unknown. Uses your SV_DB_* login from .env.local.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { readFileFacts } from '../features/slide-vault/server/file-facts';
import { folderInfo } from '../features/slide-vault/server/folder-path';

const args = process.argv.slice(2);
const at = args.indexOf('--uploaded-by');
const uploadedBy = at >= 0 ? (args[at + 1] ?? '').trim() : '';
if (at >= 0 && !uploadedBy) {
  console.error('--uploaded-by needs a name, e.g. --uploaded-by "Vincent Mizhquiri"');
  process.exit(1);
}
const yes = args.includes('--yes');
// The folder is the first plain argument that isn't the name after --uploaded-by (when that is given).
const folder = args.find((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1))?.replace(/^~(?=$|\/)/, os.homedir());
if (!folder || !existsSync(folder)) {
  console.error('Give the folder with the deck files, e.g. npm run deck:details -- ~/Desktop/MMoser-RealDecks');
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

const hashFile = (file: string) => new Promise<string>((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

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

type Deck = { id: string; title: string; file_hash: string; created_by: string | null; file_created_at: Date | null; uploaded_by: string | null; project_location: string | null; source_filename: string | null };
const decks = (await client.query<Deck>('select id, title, file_hash, created_by, file_created_at, uploaded_by, project_location, source_filename from decks order by title')).rows;
const byHash = new Map(decks.map((d) => [d.file_hash, d]));

console.log(`${yes ? 'SETTING DETAILS' : 'DRY RUN: nothing is changed.'} Reading ${files.length} .pptx file(s) under ${folder}...\n`);
const seen = new Set<string>();
const plan: { deck: Deck; createdBy: string | null; createdAt: string | null; uploadedBy: string | null; location: string | null }[] = [];
for (const file of files) {
  const hash = await hashFile(file);
  const deck = byHash.get(hash);
  if (!deck || seen.has(deck.id)) continue;
  seen.add(deck.id);
  const facts = await readFileFacts(readFileSync(file));
  const change = {
    deck,
    createdBy: deck.created_by ? null : facts.createdBy,
    createdAt: deck.file_created_at ? null : facts.createdAt,
    uploadedBy: deck.uploaded_by || !uploadedBy ? null : uploadedBy,
    // Where the deck was made, from its file name ("_TO_" is Toronto), when nobody recorded one (31 Oct)
    location: deck.project_location ? null : folderInfo(deck.source_filename ?? path.basename(file)).location,
  };
  const parts = [change.createdBy && `created by ${change.createdBy}`, change.createdAt && `created ${change.createdAt.slice(0, 10)}`, change.uploadedBy && `uploaded by ${change.uploadedBy}`, change.location && `location ${change.location}`].filter(Boolean);
  console.log(`  ${deck.title}: ${parts.length ? parts.join(', ') : 'nothing new (already set, or not recorded in the file)'}`);
  if (parts.length) plan.push(change);
}
const missing = decks.filter((d) => !seen.has(d.id));
if (missing.length) console.log(`\nNo file found here for: ${missing.map((d) => d.title).join(', ')}`);

if (!yes) {
  console.log(`\n${plan.length} deck(s) would get details. Nothing changed yet: add --yes to do it.`);
} else {
  for (const c of plan) {
    await client.query(
      `update decks set created_by = coalesce(created_by, $2), file_created_at = coalesce(file_created_at, $3), uploaded_by = coalesce(uploaded_by, $4),
         project_location = coalesce(project_location, $5) where id = $1`,
      [c.deck.id, c.createdBy, c.createdAt, c.uploadedBy, c.location],
    );
  }
  console.log(`\nDone: details set on ${plan.length} deck(s).`);
}
await client.end();

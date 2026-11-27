/**
 * Archive or restore a deck: hide it from the app, search and AI without deleting anything
 * (docs/DECISIONS.md FD-50). M Moser's bucket can't delete files, so this is how a test or
 * wrong deck is taken out of view. Reversible with --undo.
 *
 *   npm run deck:archive -- "Kestrel Law"            # shows which decks match; changes nothing
 *   npm run deck:archive -- "Kestrel Law" --yes      # archives them
 *   npm run deck:archive -- "Kestrel Law" --undo --yes   # brings them back
 *
 * Matches on part of the deck title (not case-sensitive). Uses your SV_DB_* login from .env.local.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const text = args.find((a) => !a.startsWith('--'));
const undo = args.includes('--undo');
const yes = args.includes('--yes');
if (!text || text.trim().length < 3) {
  console.error('Give part of the deck title (at least 3 characters), e.g. npm run deck:archive -- "Kestrel Law"');
  process.exit(1);
}

const env: Record<string, string> = {};
for (const line of readFileSync(path.resolve(import.meta.dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = /^(SV_[A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}
const ssl = env.SV_DB_SSL === 'disable' ? false : env.SV_DB_CA_FILE ? { ca: readFileSync(env.SV_DB_CA_FILE, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: false };
const client = new pg.Client({ host: env.SV_DB_HOST, port: Number(env.SV_DB_PORT), database: env.SV_DB_NAME || 'postgres', user: env.SV_DB_USER, password: env.SV_DB_PASSWORD, ssl });
await client.connect();
await client.query(`set role slidevault_developer; set search_path to ${pg.escapeIdentifier(env.SV_DB_SCHEMA)}, public`);

const like = `%${text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const found = await client.query<{ id: string; title: string; archived_at: Date | null; slide_count: number }>(
  `select id, title, archived_at, slide_count from decks where title ilike $1 order by title`,
  [like],
);
if (!found.rows.length) {
  console.log(`No deck title contains "${text}". Nothing changed.`);
  await client.end();
  process.exit(0);
}
const targets = found.rows.filter((d) => (undo ? d.archived_at : !d.archived_at));
for (const d of found.rows) console.log(`  ${d.title} (${d.slide_count} slides) — ${d.archived_at ? 'archived' : 'in the app'}`);
if (!targets.length) {
  console.log(`\nAll of them are already ${undo ? 'in the app' : 'archived'}. Nothing changed.`);
} else if (!yes) {
  console.log(`\n${targets.length} deck(s) would be ${undo ? 'restored' : 'archived'}. Nothing changed yet: add --yes to do it.`);
} else {
  await client.query(`update decks set archived_at = ${undo ? 'null' : 'now()'} where id = any($1::uuid[])`, [targets.map((d) => d.id)]);
  console.log(`\n${undo ? 'Restored' : 'Archived'} ${targets.length} deck(s). ${undo ? 'They show in the app again.' : 'They no longer show in the app, search or AI. Nothing was deleted.'}`);
}
await client.end();

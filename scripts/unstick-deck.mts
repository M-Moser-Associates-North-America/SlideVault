/**
 * Frees a deck stuck at "queued" or "processing" (the upload was interrupted, e.g. the app was
 * stopped mid-upload) by marking it failed, so the next upload:library run finishes it under the
 * same deck. The original is already in the bucket and can't be overwritten, so nothing is
 * uploaded twice. Only touches decks that are stuck; ready decks are left alone.
 *
 *   npm run deck:unstick -- "Fieldmark"          # shows which stuck decks match; changes nothing
 *   npm run deck:unstick -- "Fieldmark" --yes    # marks them failed, then run upload:library again
 *
 * Don't run it while that deck is still uploading. Uses your SV_DB_* login from .env.local.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const text = args.find((a) => !a.startsWith('--'));
const yes = args.includes('--yes');
if (!text || text.trim().length < 3) {
  console.error('Give part of the deck title (at least 3 characters), e.g. npm run deck:unstick -- "Fieldmark"');
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
const found = await client.query<{ id: string; title: string; status: string; uploaded_at: Date }>(
  `select id, title, status, uploaded_at from decks where title ilike $1 order by title`,
  [like],
);
const stuck = found.rows.filter((d) => d.status === 'queued' || d.status === 'processing');
for (const d of found.rows) console.log(`  ${d.title}: ${d.status}${stuck.includes(d) ? ` (started ${d.uploaded_at.toLocaleString()})` : ''}`);
if (!found.rows.length) console.log(`No deck title contains "${text}". Nothing changed.`);
else if (!stuck.length) console.log('\nNone of them are stuck. Nothing changed.');
else if (!yes) console.log(`\n${stuck.length} stuck deck(s) would be marked failed so the upload tool can finish them. Nothing changed yet: add --yes to do it.`);
else {
  await client.query(`update decks set status = 'failed', error = 'Upload was interrupted; run upload:library again to finish it' where id = any($1::uuid[]) and status in ('queued', 'processing')`, [stuck.map((d) => d.id)]);
  console.log(`\nMarked ${stuck.length} deck(s) failed. Now run the same upload:library command again to finish them.`);
}
await client.end();

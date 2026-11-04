/**
 * Checks your personal access to M Moser's Supabase project (database login + Storage account).
 * Prints only yes/no and counts, never passwords or keys.
 *
 *   npx tsx scripts/check-mmoser-access.mts
 *
 * Reads the SV_* settings from .env.local (gitignored). See env.example.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const env: Record<string, string> = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^(SV_[A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}
const need = ['SV_DB_HOST', 'SV_DB_PORT', 'SV_DB_NAME', 'SV_DB_USER', 'SV_DB_PASSWORD', 'SV_DB_SCHEMA',
  'SV_SUPABASE_URL', 'SV_SUPABASE_PUBLISHABLE_KEY', 'SV_STORAGE_EMAIL', 'SV_STORAGE_PASSWORD', 'SV_STORAGE_BUCKET', 'SV_STORAGE_PREFIX'];
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.log('Missing in .env.local:', missing.join(', '));
  process.exit(1);
}
const ok = (label: string, yes: boolean, detail = '') => console.log(`${yes ? 'YES' : 'NO '}  ${label}${detail ? `  (${detail})` : ''}`);
const schema = env.SV_DB_SCHEMA;

// 1. Database
const db = new pg.Client({
  host: env.SV_DB_HOST, port: Number(env.SV_DB_PORT), database: env.SV_DB_NAME,
  user: env.SV_DB_USER, password: env.SV_DB_PASSWORD,
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});
try {
  await db.connect();
  ok('database login works', true);
  try {
    await db.query('SET ROLE slidevault_developer');
    ok('can switch to the shared developer role', true);
  } catch (e) {
    ok('can switch to the shared developer role', false, (e as Error).message);
  }
  const s = await db.query('select exists(select 1 from information_schema.schemata where schema_name = $1) as found', [schema]);
  ok('our schema exists', s.rows[0].found);
  const c = await db.query("select has_schema_privilege($1, 'CREATE') as can_create, has_schema_privilege($1, 'USAGE') as can_use", [schema]);
  ok('can create tables in our schema', c.rows[0].can_create);
  const t = await db.query('select table_name from information_schema.tables where table_schema = $1 order by 1', [schema]);
  ok('tables already in our schema', true, t.rows.length ? t.rows.map((r) => r.table_name).join(', ') : 'none yet');
  const v = await db.query("select exists(select 1 from pg_extension where extname = 'vector') as v");
  ok('meaning-based search add-on (pgvector) installed', v.rows[0].v);
} catch (e) {
  ok('database login works', false, (e as Error).message.replace(env.SV_DB_PASSWORD, '***'));
} finally {
  await db.end().catch(() => {});
}

// 2. Storage
const sb = createClient(env.SV_SUPABASE_URL, env.SV_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: signInError } = await sb.auth.signInWithPassword({ email: env.SV_STORAGE_EMAIL, password: env.SV_STORAGE_PASSWORD });
ok('storage sign-in works', !signInError, signInError?.message);
if (!signInError) {
  const prefix = env.SV_STORAGE_PREFIX.replace(/\/$/, '');
  // The guide says every allowlisted account can list and download all reference decks.
  const root = await sb.storage.from(env.SV_STORAGE_BUCKET).list('', { limit: 1000 });
  ok('can see the whole bucket', !root.error, root.error?.message ?? `${root.data?.length ?? 0} top-level folders or files`);
  for (const f of root.data ?? []) {
    if (`${f.name}` === prefix) continue;
    const inside = await sb.storage.from(env.SV_STORAGE_BUCKET).list(f.name, { limit: 1000 });
    console.log(`     ${f.id ? 'file' : 'folder'} ${f.id ? f.name : '(someone else\'s or shared)'}: ${inside.data?.length ?? 0} items inside`);
  }
  const list = await sb.storage.from(env.SV_STORAGE_BUCKET).list(prefix, { limit: 100 });
  ok('can list my upload folder', !list.error, list.error?.message ?? `${list.data?.length ?? 0} items: ${(list.data ?? []).map((f) => f.name).join(', ')}`);
  // Try each file type the app stores: decks (.pptx) and thumbnails (.png, .jpg). Test files are tiny and removed after.
  const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const tries: [string, Uint8Array, string][] = [
    ['_access-check.pptx', new Uint8Array(readFileSync('tests/fixtures/northwind-capabilities.pptx')), PPTX],
    ['_access-check.png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'],
    ['_access-check.jpg', Uint8Array.from([255, 216, 255, 217]), 'image/jpeg'],
  ];
  for (const [name, bytes, type] of tries) {
    const key = `${prefix}/${name.replace('.', `-${Date.now()}.`)}`; // a new name each run, so nothing is overwritten
    const up = await sb.storage.from(env.SV_STORAGE_BUCKET).upload(key, new Blob([new Uint8Array(bytes)], { type }), { upsert: false, contentType: type });
    ok(`can upload a ${name.split('.').pop()} file to my folder`, !up.error, up.error?.message);
    if (!up.error) {
      const dl = await sb.storage.from(env.SV_STORAGE_BUCKET).download(key);
      ok(`can read it back`, !dl.error, dl.error?.message);
      // Storage reports success even when a rule quietly blocks the delete, so check the file is really gone.
      await sb.storage.from(env.SV_STORAGE_BUCKET).remove([key]);
      const after = await sb.storage.from(env.SV_STORAGE_BUCKET).list(prefix, { limit: 1000 });
      const stillThere = (after.data ?? []).some((f) => key.endsWith(`/${f.name}`));
      ok(`can delete it`, !stillThere, stillThere ? 'the file is still there, so deleting is not allowed' : '');
    }
  }
  await sb.auth.signOut();
}

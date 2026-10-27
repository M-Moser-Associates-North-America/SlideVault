/**
 * Read-only look at the Storage bucket's rules: which file types and sizes it accepts.
 * Uploads nothing. Tries two ways: the Storage API (signed in as your Storage account) and the
 * database's storage.buckets table (with your database login). Either may be closed to us.
 *
 *   npx tsx scripts/check-bucket.mts
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const env: Record<string, string> = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^(SV_[A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}
const bucket = env.SV_STORAGE_BUCKET;
const show = (where: string, b: { allowed_mime_types?: string[] | null; file_size_limit?: number | string | null; public?: boolean } | null) => {
  if (!b) return;
  const types = b.allowed_mime_types?.length ? b.allowed_mime_types.join(', ') : 'any type (no list set)';
  const size = b.file_size_limit ? `${Math.round(Number(b.file_size_limit) / 1024 / 1024)} MB` : 'no limit set';
  console.log(`\n${where}\n  Accepts: ${types}\n  Size limit: ${size}\n  Public: ${b.public ? 'yes' : 'no'}`);
};

// 1. Storage API, signed in as the Storage account
const sb = createClient(env.SV_SUPABASE_URL, env.SV_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const signIn = await sb.auth.signInWithPassword({ email: env.SV_STORAGE_EMAIL, password: env.SV_STORAGE_PASSWORD });
if (signIn.error) console.log(`Storage sign-in failed: ${signIn.error.message}`);
else {
  const { data, error } = await sb.storage.getBucket(bucket);
  if (error) console.log(`Storage API: can't read the bucket's settings (${error.message})`);
  else show('From the Storage API:', data as never);
}

// 2. Database, read-only transaction
const c = new pg.Client({ host: env.SV_DB_HOST, port: Number(env.SV_DB_PORT), database: env.SV_DB_NAME, user: env.SV_DB_USER, password: env.SV_DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('begin read only');
try {
  await c.query('set local role slidevault_developer');
  const r = await c.query(`select allowed_mime_types, file_size_limit, public from storage.buckets where id = $1`, [bucket]);
  if (r.rows[0]) show('From the database (storage.buckets):', r.rows[0]);
  else console.log("\nDatabase: the bucket's row isn't visible to our login");
} catch (e) {
  console.log(`\nDatabase: can't read storage.buckets (${(e as Error).message})`);
} finally {
  await c.query('rollback');
  await c.end();
}
console.log('\nNothing was uploaded or changed.');

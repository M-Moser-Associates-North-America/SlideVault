/**
 * Sets up meaning search in our schema (docs/DECISIONS.md FD-55): checks that pgvector is switched
 * on and that our role can use it, then creates the slide_embeddings table (server/sql/vector.sql).
 * Safe to run more than once. Says exactly what to ask the project owner if something is missing.
 *
 *   npm run db:vector
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(import.meta.dirname, '..');
const env: Record<string, string> = {};
const envFile = path.join(root, '.env.local');
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
try {
  const ext = (await client.query<{ schema: string; version: string }>(`select extnamespace::regnamespace::text as schema, extversion as version from pg_extension where extname = 'vector'`)).rows[0];
  if (!ext) {
    console.log('pgvector is not switched on in this project yet. The project owner turns it on under Database > Extensions. Nothing was changed.');
    process.exitCode = 1;
  } else {
    await client.query('set role slidevault_developer');
    const [{ usage }] = (await client.query<{ usage: boolean }>(`select has_schema_privilege($1, 'USAGE') as usage`, [ext.schema])).rows;
    if (!usage) {
      console.log(`pgvector ${ext.version} is on, in the "${ext.schema}" schema, but our role can't use that schema yet. Nothing was changed.`);
      console.log(`Ask the project owner to run this once in the SQL editor:\n\n  grant usage on schema ${pg.escapeIdentifier(ext.schema)} to slidevault_developer;\n`);
      process.exitCode = 1;
    } else {
      await client.query(`set search_path to ${pg.escapeIdentifier(env.SV_DB_SCHEMA)}, public, ${pg.escapeIdentifier(ext.schema)}`);
      await client.query('begin');
      await client.query(readFileSync(path.join(root, 'features/slide-vault/server/sql/vector.sql'), 'utf8'));
      await client.query('commit');
      const [{ n }] = (await client.query<{ n: string }>('select count(*) as n from slide_embeddings')).rows;
      console.log(`pgvector ${ext.version} is on and usable. The slide_embeddings table is ready (${n} fingerprint(s) so far).`);
      console.log('Next: npm run embed:slides (a dry run first).');
    }
  }
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error('Meaning search setup failed, nothing was changed:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

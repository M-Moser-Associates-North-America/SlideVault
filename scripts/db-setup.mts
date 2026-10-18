/**
 * Creates SlideVault's tables in our schema in M Moser's Supabase project (docs/DECISIONS.md FD-12).
 * Safe to run more than once: it only adds what's missing.
 *
 *   npm run db:setup
 *
 * Uses your personal database login from .env.local (SV_DB_*), switches to the shared
 * slidevault_developer role so teammates can use the same tables, and runs
 * features/slide-vault/server/sql/schema.sql inside SV_DB_SCHEMA.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(import.meta.dirname, '..');
const envFile = path.join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
}
const e = process.env;
const missing = ['SV_DB_HOST', 'SV_DB_PORT', 'SV_DB_USER', 'SV_DB_PASSWORD', 'SV_DB_SCHEMA'].filter((k) => !e[k]);
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`);
  process.exit(1);
}

const client = new pg.Client({
  host: e.SV_DB_HOST, port: Number(e.SV_DB_PORT), database: e.SV_DB_NAME || 'postgres',
  user: e.SV_DB_USER, password: e.SV_DB_PASSWORD,
  ssl: e.SV_DB_SSL === 'disable' ? false : e.SV_DB_CA_FILE ? { ca: readFileSync(e.SV_DB_CA_FILE, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: false },
});
const schemaSql = readFileSync(path.join(root, 'features/slide-vault/server/sql/schema.sql'), 'utf8');

try {
  await client.connect();
  await client.query(`SET ROLE slidevault_developer; SET search_path TO ${pg.escapeIdentifier(e.SV_DB_SCHEMA!)}, public`);
  await client.query('begin');
  await client.query(schemaSql);
  await client.query('commit');
  const t = await client.query('select table_name from information_schema.tables where table_schema = $1 order by 1', [e.SV_DB_SCHEMA]);
  console.log(`Tables in our schema: ${t.rows.map((r) => r.table_name).join(', ')}`);
  console.log('Database is set up.');
} catch (err) {
  await client.query('rollback').catch(() => {});
  console.error('Setup failed, nothing was changed:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

/**
 * Read-only look at M Moser's SlideVault database: which tables exist in our schema and in
 * public, and how many rows each has. Runs inside a READ ONLY transaction, so it can't change
 * anything even by mistake. Uses your SV_DB_* settings from .env.local.
 *
 *   npm run db:check
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const envFile = path.resolve(import.meta.dirname, '..', '.env.local');
const env: Record<string, string> = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^(SV_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
}
const missing = ['SV_DB_HOST', 'SV_DB_PORT', 'SV_DB_NAME', 'SV_DB_USER', 'SV_DB_PASSWORD', 'SV_DB_SCHEMA'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`);
  process.exit(1);
}

const ssl =
  env.SV_DB_SSL === 'disable' ? false : env.SV_DB_CA_FILE ? { ca: readFileSync(env.SV_DB_CA_FILE, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: false };
const client = new pg.Client({ host: env.SV_DB_HOST, port: Number(env.SV_DB_PORT), database: env.SV_DB_NAME, user: env.SV_DB_USER, password: env.SV_DB_PASSWORD, ssl });

async function inReadOnly<T>(fn: () => Promise<T>): Promise<T> {
  await client.query('begin read only');
  try {
    await client.query('set local role slidevault_developer');
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

await client.connect();
const schemas = [env.SV_DB_SCHEMA, 'public'];
const tables = await inReadOnly(() =>
  client.query<{ table_schema: string; table_name: string }>(
    `select table_schema, table_name from information_schema.tables where table_schema = any($1) and table_type = 'BASE TABLE' order by 1, 2`,
    [schemas],
  ),
);
for (const schema of schemas) {
  const list = tables.rows.filter((r) => r.table_schema === schema);
  console.log(`\nSchema "${schema}": ${list.length ? `${list.length} table(s)` : 'no tables we can see'}`);
  for (const t of list) {
    const label = `  ${t.table_name}`;
    try {
      const n = await inReadOnly(async () => (await client.query<{ n: number }>(`select count(*)::int as n from ${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(t.table_name)}`)).rows[0].n);
      console.log(`${label}: ${n} row(s)`);
    } catch {
      console.log(`${label}: can't read (no permission)`);
    }
  }
}
if (tables.rows.some((r) => r.table_schema === env.SV_DB_SCHEMA && r.table_name === 'decks')) {
  const decks = await inReadOnly(() => client.query<{ title: string; status: string }>(`select title, status from ${pg.escapeIdentifier(env.SV_DB_SCHEMA)}.decks order by uploaded_at`));
  console.log(`\nDecks in "${env.SV_DB_SCHEMA}":`);
  for (const d of decks.rows) console.log(`  ${d.title} (${d.status})`);
}
await client.end();
console.log('\nNothing was changed.');

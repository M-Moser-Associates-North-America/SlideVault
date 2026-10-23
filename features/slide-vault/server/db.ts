import 'server-only';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { readMmoserConfig } from './config';

/**
 * Postgres connection to M Moser's Supabase project (docs/DECISIONS.md FD-12).
 *
 * Each developer connects with their own personal login (SV_DB_* in .env.local), switches to the
 * shared slidevault_developer role, and works only inside our schema. There is no master key:
 * the database itself limits what this connection can do.
 */
let pool: pg.Pool | null = null;

/**
 * TLS is required. With SV_DB_CA_FILE pointing at the project's CA certificate, the server's
 * certificate is fully verified (what the access guide asks for). Without it the connection is
 * still encrypted, but the certificate isn't checked; get the CA file from the project owner.
 * SV_DB_SSL=disable is only for a local test database.
 */
function sslOptions(): pg.ClientConfig['ssl'] {
  if (process.env.SV_DB_SSL === 'disable') return false;
  const caFile = process.env.SV_DB_CA_FILE;
  if (caFile) return { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export function db(): pg.Pool {
  if (pool) return pool;
  const c = readMmoserConfig().db;
  pool = new pg.Pool({
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.user,
    password: c.password,
    ssl: sslOptions(),
    // Each login is limited to five connections (docs/CONTRACTOR_ACCESS.md). Keep a couple free
    // for scripts like db:setup running at the same time.
    max: 3,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

/** Connections that have already switched role and schema. */
const prepared = new WeakSet<pg.PoolClient>();

/** Run one statement and return its rows. Values always go in as parameters ($1, $2...), never pasted into SQL. */
export async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = await db().connect();
  try {
    if (!prepared.has(client)) {
      // Every connection first switches to the shared role and our schema, before running anything.
      await client.query(`SET ROLE slidevault_developer; SET search_path TO ${pg.escapeIdentifier(readMmoserConfig().db.schema)}, public`);
      prepared.add(client);
    }
    const res = await client.query(text, values);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

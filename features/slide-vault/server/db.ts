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
/*
 * One pool for the whole server process, kept on globalThis. In development Next.js loads this module
 * again on every reload (and once per route), and each copy used to open its own pool, so connections
 * piled up until the login hit its limit ("too many connections for role", blank thumbnails, 31 Oct).
 * Reusing the one pool keeps it at `max` connections however often the code reloads.
 */
type Shared = { pool?: pg.Pool; prepared?: WeakSet<pg.PoolClient> };
const shared = ((globalThis as typeof globalThis & { __slidevaultDb?: Shared }).__slidevaultDb ??= {});

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
  if (shared.pool) return shared.pool;
  const c = readMmoserConfig().db;
  const pool = new pg.Pool({
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
  // A dropped idle connection (the database restarting, a laptop waking up) must not crash the server.
  pool.on('error', (e) => console.error('Database connection dropped; a new one opens on the next request:', e.message));
  shared.pool = pool;
  return pool;
}

/**
 * Connections that have already switched role and schema. The search path also names "extensions",
 * where Supabase keeps pgvector (FD-55); Postgres skips it where that schema doesn't exist.
 */
const prepared = (shared.prepared ??= new WeakSet<pg.PoolClient>());

/** Run one statement and return its rows. Values always go in as parameters ($1, $2...), never pasted into SQL. */
export async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = await db().connect();
  try {
    if (!prepared.has(client)) {
      // Every connection first switches to the shared role and our schema, before running anything.
      await client.query(`SET ROLE slidevault_developer; SET search_path TO ${pg.escapeIdentifier(readMmoserConfig().db.schema)}, public, extensions`);
      prepared.add(client);
    }
    const res = await client.query(text, values);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

/**
 * Run several statements as one: all of them happen, or none do (FD-52, e.g. making a pack and its
 * members). `q` works like sql() but on the same connection, inside the transaction.
 */
export async function transaction<R>(work: (q: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<T[]>) => Promise<R>): Promise<R> {
  const client = await db().connect();
  try {
    if (!prepared.has(client)) {
      await client.query(`SET ROLE slidevault_developer; SET search_path TO ${pg.escapeIdentifier(readMmoserConfig().db.schema)}, public, extensions`);
      prepared.add(client);
    }
    await client.query('begin');
    const q = async <T,>(text: string, values: unknown[] = []) => (await client.query(text, values)).rows as T[];
    const out = await work(q);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

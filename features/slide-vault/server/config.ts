import 'server-only';
import path from 'node:path';

/**
 * Server configuration, read from the environment (see env.example).
 * Defaults point at the synthetic fixtures, so a fresh checkout never touches client material.
 */
export type ServerConfig = {
  /** Folder of source .pptx decks the library is built from */
  libraryDir: string;
  /** Folder for derived data: library index and slide previews (gitignored) */
  dataDir: string;
};

export function readConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const root = process.cwd();
  return {
    libraryDir: path.resolve(root, env.SLIDEVAULT_LIBRARY_DIR || 'tests/fixtures'),
    dataDir: path.resolve(root, env.SLIDEVAULT_DATA_DIR || '.data'),
  };
}

/**
 * Supabase (Postgres + storage), used by the upload path (supabase/migrations).
 * Validated lazily, only when a route actually needs it, so the existing fixture/JSON
 * path keeps working on a checkout that hasn't set these up yet.
 */
export type SupabaseConfig = { url: string; serviceRoleKey: string };

export function readSupabaseConfig(env: Record<string, string | undefined> = process.env): SupabaseConfig {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for this operation. See env.example.');
  }
  return { url, serviceRoleKey };
}

/**
 * M Moser's Supabase project (FD-12): a personal database login plus a Storage account, both
 * from Alina. Read from SV_* settings in .env.local; never commit them. Validated lazily, only
 * when a route needs the database or Storage, so the fixture-only app still runs without them.
 */
export type MmoserConfig = {
  db: { host: string; port: number; database: string; user: string; password: string; schema: string };
  storage: { url: string; publishableKey: string; email: string; password: string; bucket: string; prefix: string };
};

export function readMmoserConfig(env: Record<string, string | undefined> = process.env): MmoserConfig {
  const need = ['SV_DB_HOST', 'SV_DB_PORT', 'SV_DB_USER', 'SV_DB_PASSWORD', 'SV_DB_SCHEMA',
    'SV_SUPABASE_URL', 'SV_SUPABASE_PUBLISHABLE_KEY', 'SV_STORAGE_EMAIL', 'SV_STORAGE_PASSWORD', 'SV_STORAGE_BUCKET', 'SV_STORAGE_PREFIX'];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing M Moser Supabase settings: ${missing.join(', ')}. See env.example.`);
  return {
    db: {
      host: env.SV_DB_HOST!, port: Number(env.SV_DB_PORT), database: env.SV_DB_NAME || 'postgres',
      user: env.SV_DB_USER!, password: env.SV_DB_PASSWORD!, schema: env.SV_DB_SCHEMA!,
    },
    storage: {
      url: env.SV_SUPABASE_URL!, publishableKey: env.SV_SUPABASE_PUBLISHABLE_KEY!, email: env.SV_STORAGE_EMAIL!,
      password: env.SV_STORAGE_PASSWORD!, bucket: env.SV_STORAGE_BUCKET!, prefix: env.SV_STORAGE_PREFIX!.replace(/\/+$/, ''),
    },
  };
}

/** True when the M Moser settings are present (used to skip database work on fixture-only checkouts). */
export function hasMmoserConfig(env: Record<string, string | undefined> = process.env): boolean {
  try {
    readMmoserConfig(env);
    return true;
  } catch {
    return false;
  }
}

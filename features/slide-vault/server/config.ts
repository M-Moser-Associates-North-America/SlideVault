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

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

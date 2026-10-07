import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Library } from '../types';

const DATA_FILE = path.join(process.cwd(), 'features/slide-vault/data/slides.json');

/**
 * The ingested library, or null when `npm run ingest` has not been run yet.
 * Cached: the data only changes when the ingest is re-run (restart the app afterwards).
 */
export async function loadLibrary(): Promise<Library | null> {
  'use cache';
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf8')) as Library;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

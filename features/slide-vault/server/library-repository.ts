import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readConfig } from './config';

/**
 * File-backed library index written by `npm run ingest` (.data/library.json).
 * Prototype stand-in for the Postgres tables in docs/DATA_AND_API.md (decision FD-02):
 * source deck → immutable version (content hash) → slides.
 */

export type IndexedSlide = {
  id: string;
  number: number;
  title: string;
  text: string;
  hidden: boolean;
};

export type IndexedSource = {
  id: string;
  title: string;
  fileName: string;
  /** Immutable version: derived from the SHA-256 of the original bytes */
  versionId: string;
  sha256: string;
  slides: IndexedSlide[];
};

export type LibraryIndex = {
  generatedAt: string;
  sources: IndexedSource[];
};

export const indexFile = (dataDir: string) => path.join(dataDir, 'library.json');
export const previewFile = (dataDir: string, slideId: string) => path.join(dataDir, 'previews', `${slideId}.png`);

/** The ingested library, or null before the first `npm run ingest`. Restart the app after re-ingesting. */
export async function loadLibraryIndex(): Promise<LibraryIndex | null> {
  'use cache';
  try {
    return JSON.parse(await readFile(indexFile(readConfig().dataDir), 'utf8')) as LibraryIndex;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export function findSlide(index: LibraryIndex, slideId: string) {
  for (const source of index.sources) {
    const slide = source.slides.find((s) => s.id === slideId);
    if (slide) return { source, slide };
  }
  return null;
}

/** Absolute path of a source's original file. Never exposed to clients. */
export const sourceFilePath = (source: IndexedSource) => path.join(readConfig().libraryDir, source.fileName);

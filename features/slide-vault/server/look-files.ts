import { createHash } from 'node:crypto';

/**
 * What each slide looks like ("map", "org chart", "table"), as the team's look tools write it to the data folder
 * (FD-86), and how those files' slide ids line up with the database (FD-99). No server-only import: the import
 * tool (scripts/import-looks.mts) and the app share these rules, so both read the files the same way.
 */

/** The picture sorter's look for every slide preview. */
export const LOOK_SORT_FILE = 'look-sort.json';
/** Looks the deck file itself gives away, no AI: real tables, diagram layouts, the office-map legend. */
export const FILE_CLUES_FILE = 'file-clues.json';
/** The local describing model's look, for slides the sorter wasn't sure of. */
export const VISUAL_SCAN_FILE = 'visual-scan.json';
/** Which diagram slides are waterfalls, one yes/no question each to the local vision model. */
export const WATERFALL_FILE = 'waterfall-check.json';

type Rows = Record<string, { look?: unknown; waterfall?: unknown } | null | undefined> | null | undefined;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []);

/**
 * One look list per slide from the four files, cheapest reader first and each later one overriding: the picture
 * sorter, then the deck file's own structure (a real table is a table, whatever the picture looks like), then the
 * describing model where it has run. A diagram confirmed as a waterfall says so first (Alina, 4 Nov).
 */
export function looksFromFiles(files: { sorted?: Rows; clues?: Rows; visual?: Rows; waterfall?: Rows }): Map<string, string[]> {
  const looks = new Map<string, string[]>();
  for (const src of [files.sorted, files.clues, files.visual]) {
    for (const [id, v] of Object.entries(src ?? {})) if (strings(v?.look).length) looks.set(id, strings(v?.look));
  }
  for (const [id, v] of Object.entries(files.waterfall ?? {})) {
    if (v?.waterfall === true) looks.set(id, ['waterfall', ...(looks.get(id) ?? []).filter((l) => l !== 'waterfall')]);
  }
  return looks;
}

/**
 * The id the look files (and the storyboard's local library) give a slide: made from the deck file's SHA-256 and
 * the slide number, the same rule as scripts/ingest.mts. The database keeps that SHA-256 for every uploaded deck
 * (decks.file_hash), so a slide in the files can be matched to its database row exactly, never by name.
 */
export function fileSlideId(fileHash: string, slideNumber: number): string {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  return `sld_${sha(`ver_${fileHash.toLowerCase().slice(0, 16)}:${slideNumber}`).slice(0, 16)}`;
}

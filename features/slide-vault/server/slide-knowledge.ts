import 'server-only';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { readConfig } from './config';
import { looksFromFiles } from './look-files';

/**
 * What SlideVault knows about each slide beyond its words, from two files in the data dir (never
 * the repo, since both describe real decks):
 *
 * - discover-scan.json and discover-scan-pdf.json (FD-26): what the local model read on every slide: its role in a story,
 *   its topics, and a one-line reading of what it shows and convinces a client of.
 * - slide-metadata.json (FD-28): reviewed metadata for the slides it covers: slide type, story
 *   role, reuse status, flags (such as a leftover client name), themes, sectors and projects.
 *
 * - look-sort.json, file-clues.json and visual-scan.json (FD-86): what each slide looks like (map, org chart,
 *   table...), from the offline picture sorter, the deck file's own structure, and the local describing model.
 *
 * Where both exist the reviewed metadata wins on role, and its themes, sectors and projects join
 * the topics. The storyboard uses this to place slides by what they do, not only by their words.
 */

export type SlideReading = {
  role: string;
  topics: string[];
  about: string;
  /** True when the role comes from the reviewed metadata, not the model's own reading. */
  reviewed?: boolean;
  /** The model's second reading disagreed with its first, so its role is a guess (scan only). */
  uncertain?: boolean;
  type?: string;
  /** "reusable", "reusable - check currency", "client-specific - reference only" or "internal - never show". */
  reuse?: string;
  flags?: string[];
  /** Sectors the slide proves experience in, e.g. "healthcare / life sciences" (reviewed metadata). */
  sectors?: string[];
  /** Projects a case study shows, so its slides are told together (reviewed metadata). */
  projects?: string[];
  /** Themes the slide carries, e.g. "health & wellbeing" (reviewed metadata) */
  themes?: string[];
  /** The sector of the client the slide's deck was made for, e.g. "healthcare / medtech" (reviewed metadata) */
  clientSector?: string;
  /** Slides that only work together share a pack (reviewed metadata), e.g. a team intro and its people */
  pack?: string;
  /** What the slide looks like ("map", "org chart", "portrait photo"), read from its image by the local vision model (visual-scan.json) */
  looks?: string[];
};

type ScanRow = { role?: unknown; topics?: unknown; shows?: unknown; convinces?: unknown; confidence?: unknown };
type MetaRow = { role?: unknown; type?: unknown; reuse?: unknown; flags?: unknown; themes?: unknown; proofSectors?: unknown; projects?: unknown; clientSector?: unknown; pack?: unknown };
type VisualRow = { look?: unknown; description?: unknown; people?: unknown };
type LookRow = { look?: unknown };

const SCAN = 'discover-scan.json';
/** The same reading for PDF pages, keyed by the page IDs ingest gives them. */
const PDF_SCAN = 'discover-scan-pdf.json';
const META = 'slide-metadata.json';
/** What each slide looks like, read from its preview image by the local vision model (tools/visual_scan.py). */
const VISUAL = 'visual-scan.json';
/** What kind of picture each slide is, from the offline picture sorter (tools/sort_looks.py): minutes for the whole library. */
const SORTED = 'look-sort.json';
/** Looks the deck file itself gives away, no AI (tools/file_clues.py): real tables, diagram layouts, the office-map legend. */
const CLUES = 'file-clues.json';
/** Which diagram slides are waterfalls, one yes/no question each to the local vision model (tools/waterfall_check.py). */
const WATERFALL = 'waterfall-check.json';
let cache: { key: string; dir: string; map: Map<string, SlideReading>; looks: Map<string, string[]> } | null = null;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []);

async function readJson<T>(file: string): Promise<{ mtimeMs: number; data: Record<string, T> } | null> {
  try {
    const { mtimeMs } = await stat(file);
    return { mtimeMs, data: JSON.parse(await readFile(file, 'utf8')) as Record<string, T> };
  } catch {
    return null;
  }
}

const FILES = [SCAN, PDF_SCAN, META, VISUAL, SORTED, CLUES, WATERFALL];
/** How often the files' dates are checked for changes, at most (FD-94): a search never re-reads unchanged files. */
const CHECK_EVERY_MS = 5000;
let checkedAt = 0;
let loading: Promise<Map<string, SlideReading>> | null = null;

/**
 * What the local model and the team know about each slide, read from the data folder. Read once and kept: the
 * files' dates are checked at most every few seconds, a file is only read again when it changed, and searches
 * that arrive together share one read (the 6 Nov load test: fifty searches at once each re-read all seven files).
 */
export async function loadSlideReadings(dataDir = readConfig().dataDir): Promise<Map<string, SlideReading>> {
  if (cache && cache.dir === dataDir && Date.now() - checkedAt < CHECK_EVERY_MS) return cache.map;
  if (loading) return loading;
  loading = (async () => {
    try {
      const dates = await Promise.all(FILES.map((f) => stat(path.join(dataDir, f)).then((x) => x.mtimeMs, () => 0)));
      checkedAt = Date.now();
      const key = `${dataDir}|${dates.join(':')}`;
      if (cache?.key === key) return cache.map;
      return await readAll(dataDir, key);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

async function readAll(dataDir: string, key: string): Promise<Map<string, SlideReading>> {
  const [pptxScan, pdfScan, meta, visual, sorted, clues, waterfall] = await Promise.all([
    readJson<ScanRow>(path.join(dataDir, SCAN)),
    readJson<ScanRow>(path.join(dataDir, PDF_SCAN)),
    readJson<MetaRow>(path.join(dataDir, META)),
    readJson<VisualRow>(path.join(dataDir, VISUAL)),
    readJson<LookRow>(path.join(dataDir, SORTED)),
    readJson<LookRow>(path.join(dataDir, CLUES)),
    readJson<{ waterfall?: unknown }>(path.join(dataDir, WATERFALL)),
  ]);
  const scan = { data: { ...(pptxScan?.data ?? {}), ...(pdfScan?.data ?? {}) } };

  // Neither file yet: the storyboard works from the words on the slides alone.
  const map = new Map<string, SlideReading>();
  for (const [id, r] of Object.entries(scan?.data ?? {})) {
    if (typeof r?.role !== 'string') continue;
    const about = [r.shows, r.convinces].filter((x): x is string => typeof x === 'string').join(' ').slice(0, 600);
    map.set(id, { role: r.role, topics: strings(r.topics).slice(0, 8), about, uncertain: String(r.confidence ?? '').startsWith('uncertain') });
  }
  for (const [id, m] of Object.entries(meta?.data ?? {})) {
    const base = map.get(id);
    const role = typeof m?.role === 'string' ? m.role : base?.role;
    if (!role) continue;
    const projects = strings(m.projects);
    const topics = [...new Set([...strings(m.themes), ...strings(m.proofSectors), ...projects, ...(base?.topics ?? [])])].slice(0, 12);
    map.set(id, {
      role,
      topics,
      about: [base?.about, projects.length ? `Projects: ${projects.join(', ')}.` : ''].filter(Boolean).join(' ').slice(0, 600),
      reviewed: typeof m.role === 'string',
      type: typeof m.type === 'string' ? m.type : undefined,
      reuse: typeof m.reuse === 'string' ? m.reuse : undefined,
      flags: strings(m.flags),
      sectors: strings(m.proofSectors),
      projects,
      themes: strings(m.themes),
      clientSector: typeof m.clientSector === 'string' ? m.clientSector : undefined,
      pack: typeof m.pack === 'string' && m.pack ? m.pack : undefined,
    });
  }
  // What a slide looks like, cheapest first, each later source overriding: the picture sorter, then the deck file's own
  // structure (a real table is a table, whatever the picture looks like), then the describing model where it has run.
  // Kept apart from the readings: a slide with only a look has no role, and the storyboard reads an empty role as known.
  // A diagram the model confirmed is a waterfall says so first (Alina, 4 Nov: "the slide that looks like a waterfall").
  const looks = looksFromFiles({ sorted: sorted?.data, clues: clues?.data, visual: visual?.data, waterfall: waterfall?.data });
  for (const [id, l] of looks) { const base = map.get(id); if (base) base.looks = l; }
  // What a slide looks like joins what it says: "world map with office dots" makes a map findable when no word on it says map.
  for (const [id, v] of Object.entries(visual?.data ?? {})) {
    const description = typeof v?.description === 'string' ? v.description.trim() : '';
    const people = strings(v?.people);
    const base = map.get(id);
    if (!base || !description) continue;
    const seen = [description, people.length ? `Pictured: ${people.join(', ')}.` : ''].filter(Boolean).join(' ');
    base.about = [seen, base.about].filter(Boolean).join(' ').slice(0, 800);
  }
  cache = { key, dir: dataDir, map, looks };
  return map;
}

/** What every slide looks like ("map", "org chart", "table"), including slides with no reading: for search, not stories. */
export async function loadSlideLooks(dataDir = readConfig().dataDir): Promise<Map<string, string[]>> {
  await loadSlideReadings(dataDir);
  return cache?.looks ?? new Map();
}

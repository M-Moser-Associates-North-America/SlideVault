import 'server-only';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { readConfig } from './config';

/**
 * What SlideVault knows about each slide beyond its words, from two files in the data dir (never
 * the repo, since both describe real decks):
 *
 * - discover-scan.json and discover-scan-pdf.json (FD-26): what the local model read on every slide: its role in a story,
 *   its topics, and a one-line reading of what it shows and convinces a client of.
 * - slide-metadata.json (FD-28): reviewed metadata for the slides it covers: slide type, story
 *   role, reuse status, flags (such as a leftover client name), themes, sectors and projects.
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
};

type ScanRow = { role?: unknown; topics?: unknown; shows?: unknown; convinces?: unknown; confidence?: unknown };
type MetaRow = { role?: unknown; type?: unknown; reuse?: unknown; flags?: unknown; themes?: unknown; proofSectors?: unknown; projects?: unknown; clientSector?: unknown; pack?: unknown };

const SCAN = 'discover-scan.json';
/** The same reading for PDF pages, keyed by the page IDs ingest gives them. */
const PDF_SCAN = 'discover-scan-pdf.json';
const META = 'slide-metadata.json';
let cache: { key: string; map: Map<string, SlideReading> } | null = null;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []);

async function readJson<T>(file: string): Promise<{ mtimeMs: number; data: Record<string, T> } | null> {
  try {
    const { mtimeMs } = await stat(file);
    return { mtimeMs, data: JSON.parse(await readFile(file, 'utf8')) as Record<string, T> };
  } catch {
    return null;
  }
}

export async function loadSlideReadings(dataDir = readConfig().dataDir): Promise<Map<string, SlideReading>> {
  const [pptxScan, pdfScan, meta] = await Promise.all([readJson<ScanRow>(path.join(dataDir, SCAN)), readJson<ScanRow>(path.join(dataDir, PDF_SCAN)), readJson<MetaRow>(path.join(dataDir, META))]);
  const key = `${pptxScan?.mtimeMs ?? 0}:${pdfScan?.mtimeMs ?? 0}:${meta?.mtimeMs ?? 0}`;
  const scan = { data: { ...(pptxScan?.data ?? {}), ...(pdfScan?.data ?? {}) } };
  if (cache?.key === key) return cache.map;

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
  cache = { key, map };
  return map;
}

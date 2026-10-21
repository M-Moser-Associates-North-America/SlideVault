import 'server-only';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { readConfig } from './config';

/**
 * What the local model learned about each slide (docs/DECISIONS.md FD-26): its role in a story
 * (the client's challenge, proof, why M Moser, or a divider), its topics, and a one-line reading of
 * what it shows and what it convinces a client of. Made by reading every slide on M Moser's own
 * machine (the discovery scan, kept in the data dir beside the library index, never in the repo).
 * The storyboard uses it to place slides by what they do, not only by the words on them.
 */

export type SlideReading = { role: string; topics: string[]; about: string };

const FILE = 'discover-scan.json';
let cache: { mtimeMs: number; map: Map<string, SlideReading> } | null = null;

export async function loadSlideReadings(dataDir = readConfig().dataDir): Promise<Map<string, SlideReading>> {
  const file = path.join(dataDir, FILE);
  try {
    const { mtimeMs } = await stat(file);
    if (cache?.mtimeMs === mtimeMs) return cache.map;
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, { role?: unknown; topics?: unknown; shows?: unknown; convinces?: unknown }>;
    const map = new Map<string, SlideReading>();
    for (const [id, r] of Object.entries(raw)) {
      if (typeof r?.role !== 'string') continue;
      const topics = Array.isArray(r.topics) ? r.topics.filter((t): t is string => typeof t === 'string').slice(0, 8) : [];
      const about = [r.shows, r.convinces].filter((x): x is string => typeof x === 'string').join(' ').slice(0, 600);
      map.set(id, { role: r.role, topics, about });
    }
    cache = { mtimeMs, map };
    return map;
  } catch {
    // No scan yet on this server: the storyboard works from the words on the slides alone.
    return new Map();
  }
}

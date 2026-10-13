import 'server-only';
import { createHash } from 'node:crypto';

/**
 * Group near-identical slides across decks (PRD v2.1, Journey 2, P1), so search can show one card
 * marked "also in N decks" instead of the same slide many times.
 *
 * Grouping never deletes or hides anything: it only links slides. An admin can later confirm or
 * split a group (PRD), so groups are suggestions, like AI tags.
 *
 * This first version compares slide text only:
 *  - identical: same words after normalizing case, punctuation and spacing
 *  - near: the sets of words overlap by at least `nearThreshold` (Jaccard), e.g. the same
 *    "About us" slide with one number changed, AND the titles overlap by at least `titleThreshold`,
 *    so a reused template with a different subject ("Expert insight: Acoustics" vs "...: Lighting")
 *    stays separate
 *
 * Known limit: charts, pictures and diagrams aren't text, so two slides with the same words but
 * different chart data look identical here. Thumbnail comparison is the planned fix.
 * Meaning-based matches (embeddings) and thumbnail similarity are later additions (PRD open question:
 * "How similar must two slides be to count as the same?", to tune on real decks).
 *
 * Cost: every pair is compared, which is fine for a few thousand slides. The full 45-year archive
 * will need bucketing first (e.g. MinHash), a change inside this module only.
 */

export type SlideText = { id: string; sourceId: string; title: string; text: string };

export type DuplicateGroup = {
  /** Stable for the same members: derived from their sorted IDs */
  id: string;
  /** Members in input order */
  slideIds: string[];
  /** Number of different decks the slide appears in */
  deckCount: number;
  match: 'identical' | 'near';
};

export type DuplicateOptions = {
  /** Word-set overlap needed for a near match, 0 to 1 */
  nearThreshold?: number;
  /** Title word overlap also needed for a near match, 0 to 1 */
  titleThreshold?: number;
  /** Slides with fewer words are never grouped: short text like "Thank you" matches too easily */
  minWords?: number;
};

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of small) if (large.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

export function groupDuplicates(slides: SlideText[], options: DuplicateOptions = {}): DuplicateGroup[] {
  const nearThreshold = options.nearThreshold ?? 0.9;
  const titleThreshold = options.titleThreshold ?? 0.8;
  const minWords = options.minWords ?? 5;

  const prepared = slides.map((s) => {
    const norm = normalize(`${s.title}\n${s.text}`);
    const words = norm ? norm.split(' ') : [];
    const title = normalize(s.title);
    return { slide: s, norm, words: new Set(words), titleWords: new Set(title ? title.split(' ') : []), eligible: words.length >= minWords };
  });

  // Union-find over slide positions
  const parent = prepared.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // Identical text: one pass by normalized text
  const byText = new Map<string, number>();
  prepared.forEach((p, i) => {
    if (!p.eligible) return;
    const first = byText.get(p.norm);
    if (first === undefined) byText.set(p.norm, i);
    else union(first, i);
  });

  // Near matches: compare every remaining pair. Word counts that differ a lot can't reach the threshold.
  for (let i = 0; i < prepared.length; i++) {
    const a = prepared[i];
    if (!a.eligible) continue;
    for (let j = i + 1; j < prepared.length; j++) {
      const b = prepared[j];
      if (!b.eligible || find(i) === find(j)) continue;
      const [lo, hi] = a.words.size <= b.words.size ? [a.words.size, b.words.size] : [b.words.size, a.words.size];
      if (lo / hi < nearThreshold) continue;
      if (jaccard(a.words, b.words) >= nearThreshold && jaccard(a.titleWords, b.titleWords) >= titleThreshold) union(i, j);
    }
  }

  const members = new Map<number, number[]>();
  prepared.forEach((_, i) => members.set(find(i), [...(members.get(find(i)) ?? []), i]));

  const groups: DuplicateGroup[] = [];
  for (const idx of members.values()) {
    if (idx.length < 2) continue;
    const slideIds = idx.map((i) => prepared[i].slide.id);
    const id = `dup_${createHash('sha256').update([...slideIds].sort().join('\n')).digest('hex').slice(0, 12)}`;
    const identical = idx.every((i) => prepared[i].norm === prepared[idx[0]].norm);
    groups.push({
      id,
      slideIds,
      deckCount: new Set(idx.map((i) => prepared[i].slide.sourceId)).size,
      match: identical ? 'identical' : 'near',
    });
  }
  return groups;
}

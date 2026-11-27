import 'server-only';
import type { IndexedSource, LibraryIndex } from '../library-repository';
import { deckFacts } from './search';

/**
 * Families of slides that belong together (docs/DECISIONS.md FD-42): the same client, the same year
 * and the same template (theme fonts and colors). A deck is a family; so are slides from one deck
 * stored as separate files, and copies of one file count once. Most M Moser decks share one house
 * template, so the template alone never makes a family: the client and year must match too. A PDF
 * has no template, so it is its own family.
 *
 * A family keeps its natural order: a deck's own slide order, or, for slides stored one per file, the
 * number at the end of each file name ("… - 04.pptx"), so a story already put together is told in
 * the order it was made.
 */
export type Family = { id: string; title: string; slideIds: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const fileNumber = (fileName: string) => Number(/(\d+)\s*\.(pptx|pdf)$/i.exec(fileName)?.[1] ?? NaN);

export function familiesOf(index: LibraryIndex | null): Map<string, Family> {
  const groups = new Map<string, IndexedSource[]>();
  const seenVersions = new Set<string>();
  for (const source of index?.sources ?? []) {
    if (seenVersions.has(source.versionId)) continue; // the same file twice is one deck
    seenVersions.add(source.versionId);
    const f = deckFacts(source);
    const key = source.template ? [norm(f.clientName ?? source.title), f.deckYear ?? '', source.template].join('|') : `deck:${source.id}`;
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  const bySlide = new Map<string, Family>();
  for (const [key, sources] of groups) {
    const numbered = sources.length > 1 && sources.every((s) => Number.isFinite(fileNumber(s.fileName)));
    const ordered = [...sources].sort((a, b) => (numbered ? fileNumber(a.fileName) - fileNumber(b.fileName) : a.fileName.localeCompare(b.fileName)));
    const facts = deckFacts(ordered[0]);
    const family: Family = {
      id: key,
      title: sources.length > 1 ? [facts.clientName, facts.deckYear].filter(Boolean).join(' · ') || facts.title : facts.title,
      slideIds: ordered.flatMap((s) => [...s.slides].sort((a, b) => a.number - b.number).map((x) => x.id)),
    };
    for (const id of family.slideIds) bySlide.set(id, family);
  }
  return bySlide;
}

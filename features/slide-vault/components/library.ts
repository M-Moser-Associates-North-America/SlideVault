import type { SlideSummary } from '../contracts/dto';
import { categoryOf, clientOf, slideMatches, yearOf, type Filters } from '../domain/filters';

/* The filter rules live in domain/filters.ts, shared with the server; the screens keep importing them from here. */
export { categoryOf, clientOf, countBy, createdByOf, facetCounts, NO_FILTERS, slideMatches, tagsOf, UNKNOWN_CLIENT, uploadedByOf, YEAR_PRESETS, yearOf, type Filters } from '../domain/filters';

/**
 * Pure helpers over the slides the API returns. Decks, clients, years and categories are all
 * worked out from slide provenance (the API has no separate deck endpoint yet), and anything the
 * folder path did not say stays "unknown" rather than being guessed.
 */

export type Deck = {
  id: string;
  title: string;
  fileName: string;
  clientName: string | null;
  year: number | null;
  category: string | null;
  bestOfTheBest: boolean;
  /** Where the client is (FD-35), or null */
  location?: string | null;
  /** Archived: hidden from the app, search and AI until restored (FD-50) */
  archived?: boolean;
  createdBy?: string | null;
  uploadedBy?: string | null;
  createdAt?: string | null;
  uploadedAt?: string | null;
  slides: SlideSummary[];
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Group slides into decks, keeping first-seen deck order and slide-number order inside a deck. */
export function groupDecks(slides: SlideSummary[]): Deck[] {
  const map = new Map<string, Deck>();
  for (const s of slides) {
    const p = s.provenance;
    let deck = map.get(p.sourceId);
    if (!deck) {
      deck = {
        id: p.sourceId,
        title: p.sourceTitle,
        fileName: p.sourceFileName,
        clientName: p.clientName ?? null,
        year: p.deckYear ?? null,
        category: p.category ?? null,
        bestOfTheBest: !!p.bestOfTheBest,
        location: p.location ?? null,
        archived: !!p.archived,
        createdBy: p.createdBy ?? null,
        uploadedBy: p.uploadedBy ?? null,
        createdAt: p.createdAt ?? null,
        uploadedAt: p.uploadedAt ?? null,
        slides: [],
      };
      map.set(p.sourceId, deck);
    }
    deck.slides.push(s);
  }
  const decks = [...map.values()];
  decks.forEach((d) => d.slides.sort((a, b) => a.provenance.slideNumber - b.provenance.slideNumber));
  return decks;
}

/** "Best of the Best / 2025 / Client A", from whatever the folder path told us. */
export function folderLabel(d: Pick<Deck, 'bestOfTheBest' | 'year' | 'clientName' | 'category' | 'fileName'>): string {
  const parts = [d.bestOfTheBest ? 'Best of the Best' : null, d.year, d.clientName, d.category].filter((x) => x !== null && x !== '');
  return parts.length ? parts.join(' / ') : d.fileName;
}

export const yearsOf = (decks: Deck[]) => [...new Set(decks.map((d) => d.year).filter((y): y is number => y !== null))].sort((a, b) => b - a);

export function filterCount(f: Filters): number {
  return f.category.length + f.client.length + f.slideType.length + f.createdBy.length + f.uploadedBy.length + f.tag.length + f.section.length + (f.bestOnly ? 1 : 0) + (f.yfrom !== null || f.yto !== null ? 1 : 0);
}

/** The names of the filters that are on, in the order the filter row shows them. */
export function filterKinds(f: Filters): string[] {
  return [
    ...(f.yfrom !== null || f.yto !== null ? ['Year'] : []),
    ...(f.client.length ? ['Client'] : []),
    ...(f.category.length ? ['Project type'] : []),
    ...(f.slideType.length ? ['Slide type'] : []),
    ...(f.createdBy.length ? ['File created by'] : []),
    ...(f.uploadedBy.length ? ['Uploaded by'] : []),
    ...(f.section.length ? ['Section'] : []),
    ...(f.tag.length ? ['Tag'] : []),
    ...(f.bestOnly ? ['Best of the Best'] : []),
  ];
}

/** A friendly next step when filters leave nothing: name the filter to remove. */
export function removeHint(f: Filters): string {
  const kinds = filterKinds(f);
  if (kinds.length === 0) return '';
  if (kinds.length === 1) return `Try removing ${kinds[0]}.`;
  return `Try removing ${kinds[kinds.length - 1]}, or clear all filters.`;
}

export const deckMatches = (d: Deck, f: Filters) => d.slides.some((s) => slideMatches(s, f));

export const sortNewest = (slides: SlideSummary[]) =>
  [...slides].sort(
    (a, b) => (yearOf(b) ?? -1) - (yearOf(a) ?? -1) || a.provenance.sourceTitle.localeCompare(b.provenance.sourceTitle) || a.provenance.slideNumber - b.provenance.slideNumber,
  );

/** Browse rows are named by a key such as "best", "recent", "client:Client A", "year:2025", "category:IDD". */
/** How many times a slide has been downloaded: the server's count, or none when it has none. */
export const downloadsOf = (s: SlideSummary): number => s.downloads ?? 0;

/** The line under a slide card in Most downloaded lists, or nothing when there is no count. */
export const downloadedNote = (s: SlideSummary): string | undefined => {
  const n = downloadsOf(s);
  return n > 0 ? `Downloaded ${n} ${n === 1 ? 'time' : 'times'}` : undefined;
};

export function browseSlides(key: string, all: SlideSummary[]): SlideSummary[] {
  const [kind, ...rest] = key.split(':');
  const value = rest.join(':');
  switch (kind) {
    case 'best':
      return all.filter((s) => s.provenance.bestOfTheBest);
    case 'recent':
      return sortNewest(all);
    case 'popular':
      return all.filter((s) => downloadsOf(s) > 0).sort((a, b) => downloadsOf(b) - downloadsOf(a));
    case 'client':
      return all.filter((s) => clientOf(s) === value);
    case 'year':
      return all.filter((s) => String(yearOf(s)) === value);
    case 'category':
      return all.filter((s) => categoryOf(s) === value);
    default:
      return [];
  }
}

export function browseTitle(key: string): string {
  const [kind, ...rest] = key.split(':');
  const value = rest.join(':');
  if (kind === 'client') return `Client: ${value}`;
  if (kind === 'year') return `Year: ${value}`;
  if (kind === 'category') return `Category: ${value}`;
  if (kind === 'decks') return 'Decks';
  if (kind === 'best') return 'Best of the Best';
  if (kind === 'recent') return 'Newest decks';
  if (kind === 'popular') return 'Most downloaded';
  return 'Browse';
}

/** What a download of these slides will produce (docs/DATA_AND_API.md; decision FD-09). */
export type DownloadPlan = { files: { deckId: string; deckTitle: string; count: number }[]; zip: boolean };

export function downloadPlan(slides: SlideSummary[]): DownloadPlan {
  const order: string[] = [];
  const by = new Map<string, { deckTitle: string; count: number }>();
  for (const s of slides) {
    const id = s.provenance.sourceId;
    if (!by.has(id)) {
      by.set(id, { deckTitle: s.provenance.sourceTitle, count: 0 });
      order.push(id);
    }
    by.get(id)!.count++;
  }
  const files = order.map((deckId) => ({ deckId, ...by.get(deckId)! }));
  return { files, zip: files.length > 1 };
}

/** What the download will be. `combine` only matters when the slides come from several decks. */
export const planSummary = (p: DownloadPlan, combine = false) =>
  !p.files.length ? 'nothing to download' : p.zip && !combine ? `a zip of ${p.files.length} editable .pptx files (one per deck)` : 'one editable .pptx';

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function timeAgo(at: number): string {
  const mins = Math.round((at - Date.now()) / 60000);
  if (mins > -1) return 'just now';
  if (mins > -60) return RELATIVE.format(mins, 'minute');
  const hours = Math.round(mins / 60);
  if (hours > -24) return RELATIVE.format(hours, 'hour');
  return RELATIVE.format(Math.round(hours / 24), 'day');
}

/** "12 Oct 2026" for a date the server sent, or null if there is none or it cannot be read. */
export function dateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * How many slides of a deck are not in the list because they were hidden in the original deck: the gaps in its
 * slide numbers (FD-50). 0 when none are missing, or when hidden slides are being shown.
 */
export function hiddenGap(slides: SlideSummary[]): number {
  if (slides.length === 0) return 0;
  const last = Math.max(...slides.map((s) => s.provenance.slideNumber));
  return Math.max(0, last - slides.length);
}

/** Names for the standard deck sections (server/services/sections.ts SectionKind); "other" isn't offered. */
export const SECTION_LABEL: Record<string, string> = {
  /* In the order they usually run in a proposal: who we are, what we heard, how we'd do it, who'd do it, proof, price, then the back matter. */
  firm: 'Firm overview',
  understanding: 'Understanding',
  approach: 'Approach',
  team: 'Team',
  'case-studies': 'Case studies',
  fees: 'Fees',
  appendix: 'Appendix',
};

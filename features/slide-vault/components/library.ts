import type { SlideSummary } from '../contracts/dto';
import { simContributor, simHasSlideType, simTier, simUploader, type Tier } from './simulation';

/**
 * Pure helpers over the slides the API returns. Decks, clients, years and categories are all
 * worked out from slide provenance (the API has no separate deck endpoint yet), and anything the
 * folder path did not say stays "unknown" rather than being guessed.
 */

export const UNKNOWN_CLIENT = 'Unknown client';

export type Deck = {
  id: string;
  title: string;
  fileName: string;
  clientName: string | null;
  year: number | null;
  category: string | null;
  bestOfTheBest: boolean;
  slides: SlideSummary[];
};

export type Filters = {
  category: string[];
  client: string[];
  bestOnly: boolean;
  /** Simulated approval status (FD-14) */
  status: Tier[];
  yfrom: number | null;
  yto: number | null;
  /** Simulated slide type labels, such as "About us" (FD-14) */
  slideType: string[];
  /** Simulated sample names (FD-14) */
  uploader: string[];
  contributor: string[];
};

export const NO_FILTERS: Filters = { category: [], client: [], bestOnly: false, status: [], yfrom: null, yto: null, slideType: [], uploader: [], contributor: [] };

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const clientOf = (s: SlideSummary) => s.provenance.clientName ?? UNKNOWN_CLIENT;
export const yearOf = (s: SlideSummary) => s.provenance.deckYear ?? null;
export const categoryOf = (s: SlideSummary) => s.provenance.category ?? null;

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
  return f.category.length + f.client.length + f.status.length + f.slideType.length + f.uploader.length + f.contributor.length + (f.bestOnly ? 1 : 0) + (f.yfrom !== null || f.yto !== null ? 1 : 0);
}

/** The names of the filters that are on, in the order the filter row shows them. */
export function filterKinds(f: Filters): string[] {
  return [
    ...(f.yfrom !== null || f.yto !== null ? ['Year'] : []),
    ...(f.client.length ? ['Client'] : []),
    ...(f.category.length ? ['Project type'] : []),
    ...(f.slideType.length ? ['Slide type'] : []),
    ...(f.uploader.length ? ['Uploaded by'] : []),
    ...(f.contributor.length ? ['Contributed by'] : []),
    ...(f.status.length ? ['Status'] : []),
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

export function slideMatches(s: SlideSummary, f: Filters): boolean {
  const year = yearOf(s);
  if (f.yfrom !== null && (year === null || year < f.yfrom)) return false;
  if (f.yto !== null && (year === null || year > f.yto)) return false;
  if (f.bestOnly && !s.provenance.bestOfTheBest) return false;
  if (f.client.length && !f.client.includes(clientOf(s))) return false;
  if (f.status.length && !f.status.includes(simTier(s))) return false;
  if (f.category.length && !f.category.includes(categoryOf(s) ?? '')) return false;
  if (f.slideType.length && !f.slideType.some((t) => simHasSlideType(s, t))) return false;
  if (f.uploader.length && !f.uploader.includes(simUploader(s))) return false;
  if (f.contributor.length && !f.contributor.includes(simContributor(s))) return false;
  return true;
}

export const deckMatches = (d: Deck, f: Filters) => d.slides.some((s) => slideMatches(s, f));

/** Counts per value, for the filter lists and browse tiles. */
export function countBy(slides: SlideSummary[], pick: (s: SlideSummary) => string | number | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of slides) {
    const v = pick(s);
    if (v === null || v === '') continue;
    m.set(String(v), (m.get(String(v)) ?? 0) + 1);
  }
  return m;
}

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
    case 'suggested':
      return all.filter((s) => simTier(s) === 'Suggested');
    case 'retired':
      return all.filter((s) => simTier(s) === 'Retired');
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
  if (kind === 'suggested') return 'Awaiting approval';
  if (kind === 'retired') return 'Out of date';
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

export const planSummary = (p: DownloadPlan) =>
  !p.files.length ? 'nothing to download' : p.zip ? `a zip of ${p.files.length} editable .pptx files (one per deck)` : 'one editable .pptx';

/**
 * Find premade decks from a plain request (docs/DECISIONS.md FD-31): "Barlow's proposal 2025",
 * "Bright Pixel Games", "all proposals from 2025". One set of rules for every deck, used by basic
 * search and by the AI alike, so neither has to rediscover what the library already knows.
 *
 * A deck is known by its client (the deck catalog's reviewed name, or the file name's), any other
 * name the file gives it ("Velora" for Velorra, "NYL" for New York Ledger, "Project Kiwi"), its year
 * and its kind (RFP, MSA). Slide words are never used to identify a deck: most slides don't name the
 * client in their text (on Barlow's it is a logo), but every deck has a client.
 */

export type FindableDeck = {
  id: string;
  title: string;
  fileName: string;
  clientName: string | null;
  year: number | null;
  category: string | null;
  /** Where the client is, e.g. "Vancouver" or "Waterloo / Americas" (FD-35) */
  location?: string | null;
  /** The same file copied into the library twice shares a version: shown once. */
  versionId?: string;
};

export type DeckFind<D extends FindableDeck> = {
  decks: D[];
  /** The client names the request matched, as the library writes them */
  clients: string[];
  years: number[];
  /** Asked for a year the client has no deck from: the client's other decks are shown instead */
  yearMissing: boolean;
  /** The places the request named that decks are from ("proposals in Vancouver") */
  places: string[];
  /**
   * Honest misses (FD-34): a name asked for as a deck that no deck goes by ("Google proposal"), and
   * years asked for that the library has no decks from ("proposals from 2019"). Never guessed at.
   */
  missing: { name: string | null; years: number[] };
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const squash = (s: string) => norm(s).replace(/ /g, '');

/** Words that say "a deck" without saying which one */
const DECK_WORDS = /\b(proposals?|decks?|presentations?|pitch(es)?|rfps?|msas?|submissions?|responses?|originals?|portfolios?)\b/;
/** First words too common to stand for a client on their own ("American bank", "next year") */
const COMMON_FIRST = new Set(['american', 'national', 'international', 'united', 'general', 'global', 'digital', 'health', 'capital', 'design', 'project', 'first', 'royal', 'british', 'canadian', 'pacific', 'atlantic', 'western', 'eastern', 'northern', 'southern', 'central', 'new', 'next', 'the']);
/** Words around a deck request that aren't the name of what's asked for */
const FILLER = new Set(['show', 'me', 'all', 'our', 'the', 'a', 'an', 'for', 'from', 'of', 'to', 'give', 'get', 'pull', 'up', 'open', 'find', 'see', 'retrieve', 'original', 'please', 'last', 'this', 'year', 'years', 'that', 'we', 'did', 'made', 'created', 'wrote', 'sent', 'old', 'can', 'you', 'i', 'want', 'need', 'and', 'x', 'm', 'moser', 'mmoser']);
/** A word written as a name: capitalized ("Google"), or in capitals ("IBM") */
const NAME_LIKE = /^[A-Z][\w&.'’-]*$/;

/**
 * The name a deck request asks for, when it is written like a name: "Google proposal" -> "Google".
 * Lower-case words are topics ("hospital proposal"), and a place after "in" or "at" is a location
 * ("proposals in Vancouver"), so neither is ever reported as a client we don't have.
 */
function askedName(query: string): string | null {
  if (!DECK_WORDS.test(norm(query))) return null;
  const words = query.replace(/[?!.,]/g, ' ').split(/\s+/).filter(Boolean);
  const name: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const low = norm(w);
    if (!low || FILLER.has(low) || DECK_WORDS.test(low) || /^(19|20)\d\d$/.test(low)) continue;
    if (/^(in|at|near)$/i.test(words[i - 1] ?? '')) continue;
    if (!NAME_LIKE.test(w)) return null;
    name.push(w);
  }
  return name.length && name.length <= 3 ? name.join(' ') : null;
}

/** Never a client name on its own */
const NOT_A_NAME = new Set(['m', 'moser', 'mmoser', 'the', 'and', 'of', 'x', 'rfp', 'msa', 'global', 'response', 'resumes', 'project', 'group', 'design', 'build', 'proposal']);

/** Every name a deck goes by, normalized: its client, the parts of a name like "Meridian Card (Project Kiwi)", and the file's own name for it. */
export function deckNames(d: FindableDeck): string[] {
  const names = new Set<string>();
  const add = (s: string | null | undefined) => {
    const n = norm(s ?? '');
    if (n.length >= 3 && !NOT_A_NAME.has(n)) names.add(n);
  };
  add(d.clientName);
  for (const part of (d.clientName ?? '').split(/[()]/)) {
    add(part);
    // "Halvorsen" for Halvorsen Medtech: a distinctive first word stands for the whole name.
    const first = norm(part).split(' ');
    if (first.length > 1 && first[0].length >= 6 && !COMMON_FIRST.has(first[0])) add(first[0]);
  }
  // The file's name for the client: the part after "M Moser_" ("Velora", "NYL(2)", "BrightPixelGames")
  const file = d.fileName.split('/').pop() ?? '';
  const fromFile = /^m\s*moser\s*_\s*([^_]+)/i.exec(file)?.[1] ?? (file.includes(' - ') ? file.split(' - ')[0] : null);
  add(fromFile?.replace(/\(\d+\)/g, ''));
  return [...names];
}

function yearsIn(q: string, thisYear: number): number[] {
  const years = new Set<number>((q.match(/\b(19|20)\d\d\b/g) ?? []).map(Number));
  if (/\blast year\b/.test(q)) years.add(thisYear - 1);
  if (/\bthis year\b/.test(q)) years.add(thisYear);
  return [...years];
}

function namedIn(q: string, name: string): boolean {
  if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)) return true;
  // "brightpixelgames" in a file, "bright pixel games" in the request (or the other way round)
  const s = name.replace(/ /g, '');
  return s.length >= 6 && squash(q).includes(s);
}

/** The decks a request asks for, or none when it isn't asking for a deck. */
export function findDecks<D extends FindableDeck>(query: string, decks: D[], thisYear = new Date().getFullYear()): DeckFind<D> {
  const q = norm(query);
  const none: DeckFind<D> = { decks: [], clients: [], years: [], yearMissing: false, places: [], missing: { name: null, years: [] } };
  if (!q) return none;
  const years = yearsIn(q, thisYear);
  const yearsWithout = years.filter((y) => !decks.some((d) => d.year === y));
  const unique = decks.filter((d, i) => !d.versionId || decks.findIndex((x) => x.versionId === d.versionId) === i);
  const byClient = unique.filter((d) => deckNames(d).some((n) => namedIn(q, n)));
  const kind = /\bmsas?\b/.test(q) ? 'MSA' : /\brfps?\b/.test(q) ? 'RFP' : null;
  const ofKind = (list: D[]) => (kind && list.some((d) => d.category === kind) ? list.filter((d) => d.category === kind) : list);
  const newestFirst = (list: D[]) => [...list].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
  if (byClient.length) {
    const inYear = years.length ? byClient.filter((d) => d.year !== null && years.includes(d.year)) : byClient;
    const clients = [...new Set(byClient.map((d) => d.clientName).filter((c): c is string => !!c))];
    return { ...none, decks: newestFirst(ofKind(inYear.length ? inYear : byClient)), clients, years, yearMissing: years.length > 0 && inYear.length === 0 };
  }
  // No client named: a year with deck words ("all proposals from 2025"), or a year on its own.
  const onlyYear = q.replace(/\b(19|20)\d\d\b/g, '').replace(/\b(show|me|all|our|the|from|in|of|every|list|find|give|pull|up|last|this|year)\b/g, '').trim();
  // A place the decks are from ("proposals in Vancouver"), when no client is named: the client always
  // wins, so "New York Ledger" is never read as New York.
  const placeOf = (d: D) => (d.location ?? '').split('/').map((x) => norm(x)).filter((x) => x.length >= 2);
  // Only when decks are asked for, or the place follows "in", "from" or "at": "global delivery approach" is a slide search.
  const places = [...new Set(unique.flatMap(placeOf))].filter((p) => namedIn(q, p) && (DECK_WORDS.test(q) || new RegExp(`\\b(in|from|at)\\s+${p}\\b`).test(q)));
  if (places.length) {
    const here = unique.filter((d) => placeOf(d).some((p) => places.includes(p)) && (!years.length || (d.year !== null && years.includes(d.year))));
    return { ...none, decks: newestFirst(ofKind(here)), years, places: places.map((p) => unique.flatMap((d) => (d.location ?? '').split('/').map((x) => x.trim())).find((x) => norm(x) === p) ?? p) };
  }
  const name = askedName(query);
  if (name) return { ...none, years, missing: { name, years: [] } };
  if (years.length && (DECK_WORDS.test(q) || !onlyYear)) {
    return { ...none, decks: newestFirst(ofKind(unique.filter((d) => d.year !== null && years.includes(d.year)))), years, missing: { name: null, years: yearsWithout } };
  }
  return none;
}

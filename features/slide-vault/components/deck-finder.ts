/**
 * Find premade decks from a plain request (docs/DECISIONS.md FD-31): "Moody's proposal 2025",
 * "Next Level Games", "all proposals from 2025". One set of rules for every deck, used by basic
 * search and by the AI alike, so neither has to rediscover what the library already knows.
 *
 * A deck is known by its client (the deck catalog's reviewed name, or the file name's), any other
 * name the file gives it ("Marvel" for Marvell, "NYT" for New York Times, "Project Mango"), its year
 * and its kind (RFP, MSA). Slide words are never used to identify a deck: most slides don't name the
 * client in their text (on Moody's it is a logo), but every deck has a client.
 */

export type FindableDeck = {
  id: string;
  title: string;
  fileName: string;
  clientName: string | null;
  year: number | null;
  category: string | null;
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
/** Never a client name on its own */
const NOT_A_NAME = new Set(['m', 'moser', 'mmoser', 'the', 'and', 'of', 'x', 'rfp', 'msa', 'global', 'response', 'resumes', 'project', 'group', 'design', 'build', 'proposal']);

/** Every name a deck goes by, normalized: its client, the parts of a name like "American Express (Project Mango)", and the file's own name for it. */
export function deckNames(d: FindableDeck): string[] {
  const names = new Set<string>();
  const add = (s: string | null | undefined) => {
    const n = norm(s ?? '');
    if (n.length >= 3 && !NOT_A_NAME.has(n)) names.add(n);
  };
  add(d.clientName);
  for (const part of (d.clientName ?? '').split(/[()]/)) add(part);
  // The file's name for the client: the part after "M Moser_" ("Marvel", "NYT(2)", "NextLevelGames")
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
  // "nextlevelgames" in a file, "next level games" in the request (or the other way round)
  const s = name.replace(/ /g, '');
  return s.length >= 6 && squash(q).includes(s);
}

/** The decks a request asks for, or none when it isn't asking for a deck. */
export function findDecks<D extends FindableDeck>(query: string, decks: D[], thisYear = new Date().getFullYear()): DeckFind<D> {
  const q = norm(query);
  const none: DeckFind<D> = { decks: [], clients: [], years: [], yearMissing: false };
  if (!q) return none;
  const years = yearsIn(q, thisYear);
  const unique = decks.filter((d, i) => !d.versionId || decks.findIndex((x) => x.versionId === d.versionId) === i);
  const byClient = unique.filter((d) => deckNames(d).some((n) => namedIn(q, n)));
  const kind = /\bmsas?\b/.test(q) ? 'MSA' : /\brfps?\b/.test(q) ? 'RFP' : null;
  const ofKind = (list: D[]) => (kind && list.some((d) => d.category === kind) ? list.filter((d) => d.category === kind) : list);
  const newestFirst = (list: D[]) => [...list].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
  if (byClient.length) {
    const inYear = years.length ? byClient.filter((d) => d.year !== null && years.includes(d.year)) : byClient;
    const clients = [...new Set(byClient.map((d) => d.clientName).filter((c): c is string => !!c))];
    return { decks: newestFirst(ofKind(inYear.length ? inYear : byClient)), clients, years, yearMissing: years.length > 0 && inYear.length === 0 };
  }
  // No client named: a year with deck words ("all proposals from 2025"), or a year on its own.
  const onlyYear = q.replace(/\b(19|20)\d\d\b/g, '').replace(/\b(show|me|all|our|the|from|in|of|every|list|find|give|pull|up|last|this|year)\b/g, '').trim();
  if (years.length && (DECK_WORDS.test(q) || !onlyYear)) {
    return { decks: newestFirst(ofKind(unique.filter((d) => d.year !== null && years.includes(d.year)))), clients: [], years, yearMissing: false };
  }
  return none;
}

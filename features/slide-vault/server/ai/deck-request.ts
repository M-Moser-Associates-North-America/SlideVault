import { findDecks, type FindableDeck } from '../../components/deck-finder';

/**
 * What a storyboard request asks for (docs/DECISIONS.md FD-31). The same library answers three
 * different questions, and the person's words say which:
 *
 * - retrieve: an existing deck as it was saved ("Show me the Barlow's proposal from 2025",
 *   "Retrieve the original Barlow's proposal"). Nothing is built; the deck opens whole.
 * - reimagine: an existing deck told better ("Tell me the story of Barlow's", "Improve the Barlow's
 *   deck"). Every slide of that deck is used, put in a client-first story.
 * - build: a new story from the whole library ("A hospital group is merging three campuses...").
 *
 * A deck counts as asked for only when the request names one client's deck (client, year, kind:
 * deck-finder) and is about that deck itself. A request that describes a new situation (a merger,
 * a pitch, "prove we're the right ones", an outline for a proposal) or names several clients builds
 * a new story; the decks we already made for the clients it names come with it as `context`, since
 * they are what the library knows about those clients.
 */
export type DeckRequest<D extends FindableDeck> =
  | { mode: 'build'; context: D[] }
  | { mode: 'retrieve' | 'reimagine'; deck: D }
  /** Asked for a deck the library doesn't have (FD-34): say so, never build a story in its place */
  | { mode: 'missing'; name: string | null; years: number[] };

const REIMAGINE = /\b(story of|tell (me )?(the|its|their) story|improve|better|stronger|re-?organi[sz]e|rework|reimagine|rebuild|redo|new version of|reorder)\b/;
const RETRIEVE = /\b(original|as (it was )?saved|show( me)?|pull (it )?up|pull up|open|retrieve|give me|get me|bring up|find|see)\b/;
/** A new situation to tell a story about, not an existing deck to open or retell */
const NEW_SITUATION = /\b(new (proposal|pitch|deck|presentation|rfp|office|hq|headquarters|campus|space|building)|pitch(es|ing)?|we need a proposal|proposals? (outline|for)|outline|rfp for|prove|right (ones?|partner|firm|team)|merg\w*|combin\w*|acquir\w*|acquisition|joint venture|partnership|consolidat\w*|relocat\w*|moving|win (the|this|them))\b/;
const SHORT = 12;

export function deckRequest<D extends FindableDeck>(text: string, decks: D[], asked?: 'retrieve' | 'reimagine' | 'build'): DeckRequest<D> {
  const found = findDecks(text, decks);
  // One deck per client named, the one from the year asked for (else the newest). A whole year
  // ("all proposals from 2025") names no client: that is a list for search, not a deck to open.
  const named = found.clients.map((c) => found.decks.find((d) => d.clientName === c)).filter((d): d is D => !!d);
  // Asked to build: a new story, whatever the request names (the decks it names are its context).
  if (asked === 'build') return { mode: 'build', context: named };
  const q0 = text.toLowerCase();
  // A deck asked for outright that the library doesn't have: say so rather than build something else.
  const missing = found.missing.name ?? (found.missing.years.length ? '' : null);
  if (!named.length && missing !== null && !NEW_SITUATION.test(q0) && (!!asked || RETRIEVE.test(q0) || REIMAGINE.test(q0) || q0.split(/\s+/).length <= SHORT))
    return { mode: 'missing', name: found.missing.name, years: found.missing.years };
  if (!named.length) return { mode: 'build', context: [] };
  if (asked && named.length === 1) return { mode: asked, deck: named[0] };
  const q = text.toLowerCase();
  if (named.length === 1 && !NEW_SITUATION.test(q)) {
    if (REIMAGINE.test(q)) return { mode: 'reimagine', deck: named[0] };
    if (RETRIEVE.test(q) || q.split(/\s+/).length <= SHORT) return { mode: 'retrieve', deck: named[0] };
  }
  return { mode: 'build', context: named };
}

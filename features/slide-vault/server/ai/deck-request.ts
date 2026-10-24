import { findDecks, type FindableDeck } from '../../components/deck-finder';

/**
 * What a storyboard request asks for (docs/DECISIONS.md FD-31). The same library answers three
 * different questions, and the person's words say which:
 *
 * - retrieve: an existing deck as it was saved ("Show me the Moody's proposal from 2025",
 *   "Retrieve the original Moody's proposal"). Nothing is built; the deck opens whole.
 * - reimagine: an existing deck told better ("Tell me the story of Moody's", "Improve the Moody's
 *   deck"). Every slide of that deck is used, put in a client-first story.
 * - build: a new story from the whole library ("A hospital group is merging three campuses...").
 *
 * A deck counts as asked for only when the request names it (client, year, kind: deck-finder) and
 * either asks for it outright or is short enough to be about it. A brief that mentions a client in
 * passing, or asks for a new proposal or pitch, still builds a new story.
 */
export type DeckRequest<D extends FindableDeck> = { mode: 'build' } | { mode: 'retrieve' | 'reimagine'; deck: D };

const REIMAGINE = /\b(story of|tell (me )?(the|its|their) story|improve|better|stronger|re-?organi[sz]e|rework|reimagine|rebuild|redo|new version of|reorder)\b/;
const RETRIEVE = /\b(original|as (it was )?saved|show( me)?|pull (it )?up|pull up|open|retrieve|give me|get me|bring up|find|see)\b/;
const NEW_WORK = /\b(new (proposal|pitch|deck|presentation|rfp)|pitch(ing)?|we need a proposal|proposal outline|rfp for)\b/;
const SHORT = 12;

export function deckRequest<D extends FindableDeck>(text: string, decks: D[], asked?: 'retrieve' | 'reimagine'): DeckRequest<D> {
  const found = findDecks(text, decks);
  // Asked for a whole year ("all proposals from 2025") is a list for search, not one deck to open or retell.
  const deck = found.clients.length ? found.decks[0] : undefined;
  if (!deck) return { mode: 'build' };
  if (asked) return { mode: asked, deck };
  const q = text.toLowerCase();
  if (REIMAGINE.test(q)) return { mode: 'reimagine', deck };
  if (NEW_WORK.test(q)) return { mode: 'build' };
  if (RETRIEVE.test(q) || q.split(/\s+/).length <= SHORT) return { mode: 'retrieve', deck };
  return { mode: 'build' };
}

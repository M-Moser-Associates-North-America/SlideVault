/**
 * When the same file is uploaded again from another folder, work out what the new folder adds
 * to the deck we already have (docs/DECISIONS.md FD-11).
 *
 * M Moser's Best of the Best decks are copies of past submittals, so one file can sit in two
 * folders: Submittals/2024/<client>/ says the year and client, Best of the Best/<category>/ says
 * it's Best of the Best and its category. Each folder only knows half. We keep one deck record
 * and fill it in from both, whichever order they arrive in.
 *
 * Rules: only add, never overwrite. Best of the Best can be turned on, never off. Year, client
 * and category are filled in only when the deck doesn't have them yet, so a later folder can't
 * quietly change what an earlier one said.
 */
export type DeckDetails = {
  client: string | null;
  year: number | null;
  category: string | null;
  bestOfTheBest: boolean;
};

export type DetailChanges = Partial<DeckDetails>;

/** "Unknown client" is what upload stores when no client was given; treat it as missing. */
const known = (client: string | null) => (client && client !== 'Unknown client' ? client : null);

export function detailsToAdd(existing: DeckDetails, incoming: DeckDetails): DetailChanges {
  const changes: DetailChanges = {};
  if (incoming.bestOfTheBest && !existing.bestOfTheBest) changes.bestOfTheBest = true;
  if (existing.year == null && incoming.year != null) changes.year = incoming.year;
  if (!known(existing.client) && known(incoming.client)) changes.client = known(incoming.client);
  if (!existing.category && incoming.category) changes.category = incoming.category;
  return changes;
}

/** Plain words for what was added, e.g. ["Best of the Best", "year 2024"]. */
export function describeChanges(changes: DetailChanges): string[] {
  const out: string[] = [];
  if (changes.bestOfTheBest) out.push('Best of the Best');
  if (changes.year != null) out.push(`year ${changes.year}`);
  if (changes.client) out.push(`client ${changes.client}`);
  if (changes.category) out.push(`category ${changes.category}`);
  return out;
}

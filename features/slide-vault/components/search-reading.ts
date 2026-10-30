import type { SmartSearchChip, SmartSearchResult } from '../contracts/dto';
import { slideTypeForTopic } from './search-rules';

/**
 * How the server read the search (GET /smart-search chips), shared by the filter row and the
 * results header so both show the same reading. Client, year and slide type appear in the filter
 * row; the results header lists only what the row can't show.
 */

export type RowReading = { client: SmartSearchChip | null; year: SmartSearchChip | null; types: { chip: SmartSearchChip; label: string }[] };

export function rowReading(result: SmartSearchResult | null): RowReading {
  const chips = result?.chips ?? [];
  // When nothing matched every detail, the server dropped the client and year, so the row mustn't show them as on.
  const applied = !result?.relaxed;
  return {
    client: applied ? (chips.find((c) => c.kind === 'Client') ?? null) : null,
    year: applied ? (chips.find((c) => c.kind === 'Year') ?? null) : null,
    types: chips.flatMap((chip) => {
      const label = chip.kind === 'Topic' ? slideTypeForTopic(chip.label) : null;
      return label ? [{ chip, label }] : [];
    }),
  };
}

/** True when the filter row already shows this chip. */
export const shownInFilterRow = (chip: SmartSearchChip) => chip.kind === 'Client' || chip.kind === 'Year' || (chip.kind === 'Topic' && slideTypeForTopic(chip.label) !== null);

/** The search text without a chip's words, so removing a chip re-runs the search without it. */
export function withoutChip(q: string, chip: SmartSearchChip): string {
  const words = chip.kind === 'Collection' ? ['best', 'of', 'the', 'best'] : chip.label.toLowerCase().split(/\s+/);
  return q
    .split(/\s+/)
    .filter((w) => !words.includes(w.toLowerCase().replace(/[^a-z0-9/-]/g, '')))
    .join(' ');
}

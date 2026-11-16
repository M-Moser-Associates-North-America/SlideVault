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

/** A word without its plural: "studies" and "study", "decks" and "deck" count as the same word. */
const stem = (w: string) => {
  const x = w.toLowerCase().replace(/[^a-z0-9/-]/g, '');
  return x.endsWith('ies') && x.length > 4 ? `${x.slice(0, -3)}y` : x.endsWith('s') && !x.endsWith('ss') && x.length > 3 ? x.slice(0, -1) : x;
};

/** The search text without a chip's words (plural or singular), to find which words made the chip. */
export function withoutChip(q: string, chip: SmartSearchChip): string {
  const words = (chip.kind === 'Collection' ? ['best', 'of', 'the', 'best'] : chip.label.split(/\s+/)).map(stem);
  return q
    .split(/\s+/)
    .filter((w) => !words.includes(stem(w)))
    .join(' ');
}

/**
 * The words in the search that made a chip, as runs of neighbouring words ("case studies"), so the chip can be switched
 * off without touching what was typed. Tries what the chip is called, then `alsoCalled` (the slide type's own name),
 * because the search may name a reading differently from the words ("Proof and references" for "case studies").
 */
export function wordsBehindChip(q: string, chip: SmartSearchChip, alsoCalled?: string): string[] {
  const typed = q.split(/\s+/).filter(Boolean);
  for (const label of [chip.label, alsoCalled]) {
    if (!label) continue;
    const kept = withoutChip(q, { ...chip, label }).split(/\s+/).filter(Boolean);
    if (kept.length === typed.length) continue;
    const runs: string[] = [];
    let run: string[] = [];
    let k = 0;
    for (const w of typed) {
      if (kept[k] === w) {
        k++;
        if (run.length) runs.push(run.join(' '));
        run = [];
      } else run.push(w);
    }
    if (run.length) runs.push(run.join(' '));
    return runs;
  }
  return [];
}

import type { SmartSearchChip, SmartSearchResult } from '../contracts/dto';
import { parseQuery, slideTypeForTopic } from '../domain/search-rules';

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

/** Runs of neighbouring typed words ("case studies") whose words are in `drop`. */
function runsOf(typed: string[], drop: Set<string>): string[] {
  const runs: string[] = [];
  let run: string[] = [];
  for (const w of typed) {
    if (drop.has(stem(w))) run.push(w);
    else {
      if (run.length) runs.push(run.join(' '));
      run = [];
    }
  }
  if (run.length) runs.push(run.join(' '));
  return runs;
}

/**
 * The words in the search that made a chip, as runs of neighbouring words ("case studies"), so the chip can be switched
 * off without touching what was typed. The rules that read the search know which words each reading took (parseQuery's
 * `strip`: "projects" made the Portfolio topic in "past projects"), so ask them first. If they do not know it (a reading
 * the AI made), try what the chip is called, then `alsoCalled` (the slide type's own name), matching plural and singular.
 * Empty when nothing in the search can be tied to the chip.
 */
export function wordsBehindChip(q: string, chip: SmartSearchChip, alsoCalled?: string): string[] {
  const typed = q.split(/\s+/).filter(Boolean);
  const read = parseQuery(q, []).chips.find((c) => c.label === chip.label && (c.kind === chip.kind || c.kind === 'Topic'));
  if (read && read.strip.length) {
    const runs = runsOf(typed, new Set(read.strip.flatMap((s) => s.split(/\s+/)).map(stem)));
    if (runs.length) return runs;
  }
  for (const label of [chip.label, alsoCalled]) {
    if (!label) continue;
    const runs = runsOf(typed, new Set(label.split(/\s+/).map(stem)));
    if (runs.length) return runs;
  }
  return [];
}

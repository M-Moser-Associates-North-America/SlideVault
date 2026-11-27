/**
 * "Don't read this": the person crossed out a chip (Slide type: Case study, Year: 2024, Client: …) or unticked its
 * box. Their typed words stay exactly as typed; only the reading of those words is switched off.
 *
 * The screen sends the words that made the chip (`ignore=case studies|2024`). The server then reads the request
 * as if those words were not there (kind of slide, topics, year, client, section, order), and still searches for
 * them as plain words, so the results follow what the person changed and nothing else.
 */

const MAX_PHRASES = 6;
const MAX_PHRASE_LENGTH = 60;

/** `ignore` as the screen sends it: phrases separated by "|". Short, few, and never empty. */
export function parseIgnore(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split('|').map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p && p.length <= MAX_PHRASE_LENGTH))].slice(0, MAX_PHRASES);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The request without the ignored phrases, to be read by the usual rules. Whole words only, any case. */
export function withoutIgnored(query: string, ignore: string[]): string {
  let out = query;
  for (const phrase of ignore) out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escape(phrase).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu'), '$1 ');
  return out.replace(/\s+/g, ' ').trim();
}

/** The ignored phrases as plain search words (they were typed, so they are still looked for). */
export const ignoredWords = (ignore: string[]): string[] => [...new Set(ignore.flatMap((p) => p.toLowerCase().split(/\s+/)).filter((w) => w.length > 1))];

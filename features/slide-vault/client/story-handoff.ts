/**
 * Carries what someone typed in search over to the Storyboard (FD-24), when it reads like a client
 * brief and they choose "Build a story instead". Kept in memory only, for one hand-off.
 */
let pending: string | null = null;

export function handOffBrief(text: string) {
  pending = text.trim() || null;
}

export function takeHandedOffBrief(): string | null {
  const text = pending;
  pending = null;
  return text;
}

/** Words that show someone is describing a client's situation, not naming a slide. */
const BRIEF_WORDS = /\b(client|clients|proposal|rfp|brief|pitch|pitching|wants?|needs?|worr(y|ied|ies)|board|merg(e|ing|er)|moving|consolidat\w*|staff|employees|tenant|headquarters|campus(es)?|budget|deadline|outline)\b/i;
const MIN_WORDS = 15;
const MIN_WORDS_WITH_CLUE = 8;

/** True when a search reads like a brief: long, or shorter but clearly about a client's situation. */
export function looksLikeBrief(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words >= MIN_WORDS || (words >= MIN_WORDS_WITH_CLUE && BRIEF_WORDS.test(text));
}

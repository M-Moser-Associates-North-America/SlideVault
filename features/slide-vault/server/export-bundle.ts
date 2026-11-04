import 'server-only';
import JSZip from 'jszip';

/**
 * Package several single-deck exports as one .zip (PRD v2.1, Journey 5: "Slides from different decks
 * come as separate editable files in one zip"). Merging decks into one .pptx is a separate P1 item,
 * because masters and themes from different decks can conflict (decision FD-09).
 */

export type DeckFile = { deckTitle: string; slideNumbers: number[]; bytes: Uint8Array };

/** Keep file names readable and safe on every OS: letters, digits, spaces and . , ( ) - _ only. */
export function safeFileName(text: string, maxLength = 80): string {
  const cleaned = text
    .replace(/[^A-Za-z0-9 .,()_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
  return cleaned || 'Deck';
}

/** "2 - Harbor Bank Proposal (slides 1, 3).pptx": numbered in the order decks first appear in the selection. */
export function deckFileName(position: number, deckTitle: string, slideNumbers: number[]): string {
  const label = slideNumbers.length === 1 ? 'slide' : 'slides';
  return `${position} - ${safeFileName(deckTitle.replace(/\.pptx$/i, ''))} (${label} ${slideNumbers.join(', ')}).pptx`;
}

export async function bundleDeckFiles(files: DeckFile[]): Promise<Uint8Array> {
  const zip = new JSZip();
  files.forEach((f, i) => zip.file(deckFileName(i + 1, f.deckTitle, f.slideNumbers), f.bytes));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

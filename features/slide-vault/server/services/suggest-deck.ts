import { extractSlides } from '../../../../workers/slide-vault/processors/extract-text';
import { coverText, mergeAiFacts, type DeckFactsReader } from '../ai/deck-facts';
import { missingFacts, readFileProperties, suggestFromRules, type DeckSuggestions } from '../deck-suggestions';

/**
 * Pre-fill an upload (docs/DECISIONS.md FD-23): read the .pptx, suggest its deck facts with where
 * each came from, and say whether AI was used. Nothing is stored; the person uploading confirms or
 * changes every value, then uploads as usual. The route wires in the configured reader and the
 * library's categories; tests pass fakes.
 */

export type DeckSuggestionResult = {
  suggestions: DeckSuggestions;
  reader: 'rules' | 'model';
  /** Set when AI reading was asked for and didn't work, so the screen can say so plainly */
  readerNote: string | null;
  slideCount: number;
};

export async function suggestDeckFacts(
  fileName: string,
  bytes: Uint8Array,
  deps: { reader?: DeckFactsReader | null; categories: string[]; log?: (m: string) => void },
  opts: { folderPath?: string | null; read?: boolean; thisYear?: number } = {},
): Promise<DeckSuggestionResult> {
  const [properties, slides] = await Promise.all([readFileProperties(bytes), extractSlides(bytes)]);
  let suggestions = suggestFromRules({ fileName, folderPath: opts.folderPath, properties, slides, thisYear: opts.thisYear });
  let reader: DeckSuggestionResult['reader'] = 'rules';
  let readerNote: string | null = null;
  if (deps.reader && opts.read && missingFacts(suggestions).length) {
    try {
      const ai = await deps.reader.read({ fileName, coverText: coverText(slides), categories: deps.categories });
      suggestions = mergeAiFacts(suggestions, ai, { categories: deps.categories, thisYear: opts.thisYear, model: deps.reader.name.replace(/^openai-compatible:/, '') });
      reader = 'model';
    } catch (e) {
      deps.log?.(`Deck facts reader ${deps.reader.name} unavailable, using the file's own details: ${(e as Error).message}`);
      readerNote = "AI reading is unavailable right now, so these come from the file's own details only.";
    }
  }
  return { suggestions, reader, readerNote, slideCount: slides.length };
}

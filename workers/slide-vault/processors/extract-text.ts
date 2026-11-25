/**
 * Read slide titles and text out of a .pptx package.
 * Pure functions over the package XML: no rendering, no network, nothing executed.
 * Slide text is untrusted data (AGENTS.md): it is only stored and displayed, never followed.
 */
import JSZip from 'jszip';
import { listSlides } from '../../../features/slide-vault/server/export-pptx';
import { decode, slideTexts, type SlideText } from '../../../features/slide-vault/domain/slide-text';

/* The reading rules are shared with the Upload screen's preview (domain/slide-text.ts), so both read a slide the same way. */
export { paragraphText } from '../../../features/slide-vault/domain/slide-text';
export type ExtractedSlide = SlideText;

export async function extractSlides(pptx: Uint8Array): Promise<ExtractedSlide[]> {
  const zip = await JSZip.loadAsync(pptx);
  const slides = await listSlides(pptx);
  return slideTexts(await Promise.all(slides.map(async (s) => ({ number: s.number, hidden: s.hidden, xml: await zip.file(s.part)!.async('string') }))));
}

/** The deck's own title from its document properties, if it has one. */
export async function deckTitle(pptx: Uint8Array): Promise<string | null> {
  const core = await (await JSZip.loadAsync(pptx)).file('docProps/core.xml')?.async('string');
  const title = core?.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1]?.trim();
  return title ? decode(title) : null;
}

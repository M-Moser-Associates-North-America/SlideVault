import JSZip from 'jszip';
import { decode, slideTexts, type SlideXml } from '../domain/slide-text';

/**
 * Read a .pptx in the browser so the Upload screen can show its slides before anything is sent
 * (nothing leaves the computer here). It numbers slides, picks titles and flags hidden slides
 * with the server's own rules (domain/slide-text.ts, also used by workers/slide-vault/processors/extract-text.ts),
 * so a slide's number, title and text here are what the library will show. It draws no pictures: that stays with the server.
 * Slide text is untrusted data: it is only displayed, never followed.
 */
export type PreviewSlide = { number: number; title: string; text: string; hidden: boolean };
export type DeckPreview = { title: string | null; slides: PreviewSlide[] };

const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A relationship target as a path inside the package ("slides/slide1.xml" next to ppt/presentation.xml, or "/ppt/slides/slide1.xml"). */
function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ['ppt'];
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Reads the deck. `onProgress(done, total)` is called as each slide is read. Throws when the file isn't a readable .pptx. */
export async function readDeckPreview(file: File, onProgress?: (done: number, total: number) => void): Promise<DeckPreview> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer()).catch(() => {
    throw new Error("This doesn't look like a PowerPoint (.pptx) file.");
  });
  const presXml = await zip.file('ppt/presentation.xml')?.async('string');
  const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  if (!presXml || !relsXml) throw new Error("This doesn't look like a PowerPoint (.pptx) file.");
  const parser = new DOMParser();
  const pres = parser.parseFromString(presXml, 'application/xml');
  const rels = parser.parseFromString(relsXml, 'application/xml');
  const targets = new Map<string, string>();
  for (const r of Array.from(rels.getElementsByTagName('Relationship'))) targets.set(r.getAttribute('Id') ?? '', resolveTarget(r.getAttribute('Target') ?? ''));
  const ids = Array.from(pres.getElementsByTagNameNS(NS_P, 'sldId'));
  if (ids.length === 0) throw new Error('This deck has no slides.');

  const raw: SlideXml[] = [];
  for (const [i, el] of ids.entries()) {
    const part = targets.get(el.getAttributeNS(NS_R, 'id') ?? '');
    const xml = part ? await zip.file(part)?.async('string') : undefined;
    if (xml === undefined) throw new Error(`Slide ${i + 1} is missing from the file.`);
    raw.push({ number: i + 1, hidden: /<p:sld\b[^>]*\sshow="0"/.test(xml), xml });
    onProgress?.(i + 1, ids.length);
    if (i % 8 === 7) await new Promise((r) => setTimeout(r)); /* let the progress bar repaint on big decks */
  }

  const core = await zip.file('docProps/core.xml')?.async('string');
  const docTitle = core?.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1]?.trim();
  return {
    title: docTitle ? decode(docTitle) : null,
    slides: slideTexts(raw),
  };
}

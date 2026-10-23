/**
 * Read slide titles and text out of a .pptx package.
 * Pure functions over the package XML: no rendering, no network, nothing executed.
 * Slide text is untrusted data (AGENTS.md): it is only stored and displayed, never followed.
 */
import JSZip from 'jszip';
import { listSlides } from '../../../features/slide-vault/server/export-pptx';

export type ExtractedSlide = { number: number; title: string; text: string; hidden: boolean };

type Shape = { paragraphs: string[]; placeholder: string | null; maxSize: number };

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const runs = (xml: string) => (xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => decode(t.slice(5, -6)));

function shapesOf(slideXml: string): Shape[] {
  const shapes: Shape[] = [];
  for (const sp of slideXml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) ?? []) {
    const paragraphs = (sp.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? []).map((p) => runs(p).join('').trim()).filter(Boolean);
    if (!paragraphs.length) continue;
    const placeholder = sp.match(/<p:ph\b[^>]*?type="([^"]+)"/)?.[1] ?? null;
    const sizes = (sp.match(/\bsz="(\d+)"/g) ?? []).map((m) => Number(m.slice(4, -1)));
    shapes.push({ paragraphs, placeholder, maxSize: sizes.length ? Math.max(...sizes) : 0 });
  }
  for (const table of slideXml.match(/<a:tbl\b[\s\S]*?<\/a:tbl>/g) ?? []) {
    const cells = runs(table).map((t) => t.trim()).filter(Boolean);
    if (cells.length) shapes.push({ paragraphs: cells, placeholder: 'table', maxSize: 0 });
  }
  return shapes;
}

const joinShape = (s: Shape) => s.paragraphs.join(' ').replace(/\s+/g, ' ').trim();

/**
 * Title rules, in order: a title placeholder; else the clearly largest text (joined across
 * boxes, e.g. "Less searching." + "More storytelling."); else the first line of the largest box;
 * else the first table cell; else "Slide N".
 */
function pickTitle(shapes: Shape[], isBoilerplate: (t: string) => boolean, fallback: string): string {
  const titled = shapes.find((s) => s.placeholder === 'title' || s.placeholder === 'ctrTitle');
  if (titled) return joinShape(titled);
  const candidates = shapes.filter((s) => s.placeholder !== 'table' && !isBoilerplate(joinShape(s)) && joinShape(s).length <= 90);
  if (candidates.length) {
    const top = Math.max(...candidates.map((s) => s.maxSize));
    const second = Math.max(0, ...candidates.map((s) => s.maxSize).filter((z) => z < top));
    const atTop = candidates.filter((s) => s.maxSize === top);
    return top >= second * 1.25 ? atTop.map(joinShape).join(' ') : atTop[0].paragraphs[0];
  }
  return shapes.find((s) => s.placeholder === 'table')?.paragraphs[0] ?? fallback;
}

export async function extractSlides(pptx: Uint8Array): Promise<ExtractedSlide[]> {
  const zip = await JSZip.loadAsync(pptx);
  const slides = await listSlides(pptx);
  const perSlide = await Promise.all(slides.map(async (s) => shapesOf(await zip.file(s.part)!.async('string'))));

  // Running headers/footers: short text that repeats on most slides of the deck (e.g. a company name, a year).
  const counts = new Map<string, number>();
  for (const shapes of perSlide) for (const t of new Set(shapes.flatMap((s) => s.paragraphs))) counts.set(t, (counts.get(t) ?? 0) + 1);
  const threshold = Math.max(3, Math.ceil(slides.length * 0.6));
  const isBoilerplate = (t: string) => t.length <= 40 && (counts.get(t) ?? 0) >= threshold;

  return slides.map((s, i) => ({
    number: s.number,
    hidden: s.hidden,
    title: pickTitle(perSlide[i], isBoilerplate, `Slide ${s.number}`),
    text: perSlide[i].flatMap((sh) => sh.paragraphs).filter((p) => !isBoilerplate(p)).join('\n'),
  }));
}

/** The deck's own title from its document properties, if it has one. */
export async function deckTitle(pptx: Uint8Array): Promise<string | null> {
  const core = await (await JSZip.loadAsync(pptx)).file('docProps/core.xml')?.async('string');
  const title = core?.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1]?.trim();
  return title ? decode(title) : null;
}

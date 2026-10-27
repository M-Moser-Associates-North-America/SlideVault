import JSZip from 'jszip';

/**
 * Read a .pptx in the browser so the Upload screen can show its slides before anything is sent
 * (nothing leaves the computer here). It numbers slides, picks titles and flags hidden slides the
 * same way the server does (workers/slide-vault/processors/extract-text.ts), so a slide's number
 * here is its number in the library. It draws no pictures: that stays with the server.
 * Slide text is untrusted data: it is only displayed, never followed.
 */
export type PreviewSlide = { number: number; title: string; text: string; hidden: boolean };
export type DeckPreview = { title: string | null; slides: PreviewSlide[] };

const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

type Shape = { paragraphs: string[]; placeholder: string | null; maxSize: number };

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
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

/** The same title rules as the server: a title placeholder; else the clearly largest text; else the first line of the largest box. */
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

  const raw: { number: number; hidden: boolean; shapes: Shape[] }[] = [];
  for (const [i, el] of ids.entries()) {
    const part = targets.get(el.getAttributeNS(NS_R, 'id') ?? '');
    const xml = part ? await zip.file(part)?.async('string') : undefined;
    if (xml === undefined) throw new Error(`Slide ${i + 1} is missing from the file.`);
    raw.push({ number: i + 1, hidden: /<p:sld\b[^>]*\sshow="0"/.test(xml), shapes: shapesOf(xml) });
    onProgress?.(i + 1, ids.length);
    if (i % 8 === 7) await new Promise((r) => setTimeout(r)); /* let the progress bar repaint on big decks */
  }

  /* Running headers and footers: short text that repeats on most slides is left out of titles and text. */
  const counts = new Map<string, number>();
  for (const { shapes } of raw) for (const t of new Set(shapes.flatMap((s) => s.paragraphs))) counts.set(t, (counts.get(t) ?? 0) + 1);
  const threshold = Math.max(3, Math.ceil(raw.length * 0.6));
  const isBoilerplate = (t: string) => t.length <= 40 && (counts.get(t) ?? 0) >= threshold;

  const core = await zip.file('docProps/core.xml')?.async('string');
  const docTitle = core?.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1]?.trim();
  return {
    title: docTitle ? decode(docTitle) : null,
    slides: raw.map((s) => ({
      number: s.number,
      hidden: s.hidden,
      title: pickTitle(s.shapes, isBoilerplate, `Slide ${s.number}`),
      text: s.shapes.flatMap((sh) => sh.paragraphs).filter((p) => !isBoilerplate(p)).join('\n'),
    })),
  };
}

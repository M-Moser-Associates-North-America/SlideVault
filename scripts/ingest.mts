/**
 * Ingest the reference deck into the library.
 *
 *   npm run ingest
 *
 * Reads reference/SlideVault_Presentation1_Aug5.pptx (never modified) and writes:
 *   - public/generated/previews/slide-NNN.png   one thumbnail per slide, hidden slides included
 *   - features/slide-vault/data/slides.json     titles, text and flags for the library
 *
 * Both outputs are gitignored: they are derived from client content and rebuilt locally.
 * Needs LibreOffice (`soffice`) and poppler (`pdftoppm`) on the PATH.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { listSlides } from '../features/slide-vault/server/export-pptx';
import { SOURCE_DECK } from '../features/slide-vault/server/source-deck';

const ROOT = path.resolve(import.meta.dirname, '..');
const PREVIEW_DIR = path.join(ROOT, 'public/generated/previews');
const DATA_FILE = path.join(ROOT, 'features/slide-vault/data/slides.json');
const SOFFICE = process.env.SOFFICE ?? 'soffice';

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

type Shape = { paragraphs: string[]; placeholder: string | null; maxSize: number };

function shapesOf(slideXml: string): Shape[] {
  const shapes: Shape[] = [];
  for (const sp of slideXml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) ?? []) {
    const paragraphs = (sp.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [])
      .map((p) => decode((p.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.slice(5, -6)).join('')).trim())
      .filter(Boolean);
    if (!paragraphs.length) continue;
    const ph = sp.match(/<p:ph\b[^>]*?type="([^"]+)"/);
    const sizes = (sp.match(/\bsz="(\d+)"/g) ?? []).map((m) => Number(m.slice(4, -1)));
    shapes.push({ paragraphs, placeholder: ph ? ph[1] : null, maxSize: sizes.length ? Math.max(...sizes) : 0 });
  }
  // Tables carry text too (e.g. the content-type matrix).
  for (const tbl of slideXml.match(/<a:tbl\b[\s\S]*?<\/a:tbl>/g) ?? []) {
    const cells = (tbl.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => decode(t.slice(5, -6)).trim()).filter(Boolean);
    if (cells.length) shapes.push({ paragraphs: cells, placeholder: 'table', maxSize: 0 });
  }
  return shapes;
}

// Running header/footer text on every slide of this deck: never a title.
const BOILERPLATE = /^(m moser associates|\d{4}|mock up)$/i;

function pickTitle(shapes: Shape[], fallback: string): string {
  const join = (s: Shape) => s.paragraphs.join(' ').replace(/\s+/g, ' ').trim();
  const titled = shapes.find((s) => s.placeholder === 'title' || s.placeholder === 'ctrTitle');
  if (titled) return join(titled);
  const candidates = shapes.filter((s) => s.placeholder !== 'table' && !BOILERPLATE.test(join(s)) && join(s).length <= 90);
  if (candidates.length) {
    const top = Math.max(...candidates.map((s) => s.maxSize));
    const second = Math.max(0, ...candidates.map((s) => s.maxSize).filter((z) => z < top));
    const atTop = candidates.filter((s) => s.maxSize === top); // document order
    // A clearly larger size marks the title, even when it is split across text boxes
    // ("Less searching." + "More storytelling."). Otherwise use the first line of the first box.
    if (top >= second * 1.25) return atTop.map(join).join(' ');
    return atTop[0].paragraphs[0];
  }
  const table = shapes.find((s) => s.placeholder === 'table');
  return table ? table.paragraphs[0] : fallback;
}

async function main() {
  const source = new Uint8Array(readFileSync(SOURCE_DECK.path));
  const slides = await listSlides(source);
  const zip = await JSZip.loadAsync(source);

  const records = [];
  for (const s of slides) {
    const xml = await zip.file(s.part)!.async('string');
    const shapes = shapesOf(xml);
    const text = shapes.flatMap((sh) => sh.paragraphs).filter((p) => !BOILERPLATE.test(p)).join('\n');
    records.push({
      number: s.number,
      title: pickTitle(shapes, `Slide ${s.number}`),
      text,
      hidden: s.hidden,
      preview: `/generated/previews/slide-${String(s.number).padStart(3, '0')}.png`,
    });
  }

  // Render thumbnails from an un-hidden temporary copy (renderers skip hidden slides).
  const work = mkdtempSync(path.join(tmpdir(), 'slidevault-ingest-'));
  try {
    const copy = await JSZip.loadAsync(source);
    // The deck's fonts (Untitled Sans, Bebas Neue, Helvetica Neue) are often missing for LibreOffice,
    // which then falls back to a serif. For thumbnails only, map them to Arial / Arial Narrow, the
    // fallbacks the design system lists. Exports are built from the original package and keep the
    // original fonts.
    const fontSwap = (xml: string) =>
      xml
        .replace(/typeface="(Untitled Sans[^"]*|Helvetica Neue|Maison Neue)"/g, 'typeface="Arial"')
        .replace(/typeface="Bebas Neue[^"]*"/g, 'typeface="Arial Narrow"');
    for (const name of Object.keys(copy.files).filter((n) => /^ppt\/(slides|slideLayouts|slideMasters|theme)\/[^/]+\.xml$/.test(n))) {
      copy.file(name, fontSwap(await copy.file(name)!.async('string')));
    }
    for (const s of slides) {
      const xml = await copy.file(s.part)!.async('string');
      copy.file(s.part, xml.replace(/(<p:sld\b[^>]*?)\sshow="0"/, '$1'));
    }
    const pptx = path.join(work, 'deck.pptx');
    writeFileSync(pptx, await copy.generateAsync({ type: 'uint8array' }));
    execFileSync(SOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', work, pptx], { stdio: 'ignore' });
    rmSync(PREVIEW_DIR, { recursive: true, force: true });
    mkdirSync(PREVIEW_DIR, { recursive: true });
    execFileSync('pdftoppm', ['-png', '-scale-to-x', '1280', '-scale-to-y', '-1', path.join(work, 'deck.pdf'), path.join(PREVIEW_DIR, 'p')]);
    // pdftoppm names files p-01.png / p-1.png; normalise to slide-NNN.png
    for (const f of readdirSync(PREVIEW_DIR)) {
      const n = Number(f.match(/-(\d+)\.png$/)![1]);
      execFileSync('mv', [path.join(PREVIEW_DIR, f), path.join(PREVIEW_DIR, `slide-${String(n).padStart(3, '0')}.png`)]);
    }
    const rendered = readdirSync(PREVIEW_DIR).length;
    if (rendered !== slides.length) throw new Error(`Rendered ${rendered} previews for ${slides.length} slides`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  writeFileSync(
    DATA_FILE,
    JSON.stringify(
      {
        deck: { fileName: SOURCE_DECK.fileName, slideCount: slides.length, hiddenCount: slides.filter((s) => s.hidden).length },
        slides: records,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Ingested ${records.length} slides (${records.filter((r) => r.hidden).length} hidden) from ${SOURCE_DECK.fileName}`);
  for (const r of records) console.log(`  ${String(r.number).padStart(2)}${r.hidden ? ' (hidden)' : '         '}  ${r.title}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

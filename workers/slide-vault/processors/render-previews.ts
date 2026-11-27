/**
 * Render one PNG preview per slide (hidden slides included) with LibreOffice + poppler.
 * Runs on a temporary copy; the source package is never modified.
 * Needs `soffice` and `pdftoppm` on the PATH (override soffice with the SOFFICE variable).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { listSlides } from '../../../features/slide-vault/server/export-pptx';

// Brand fonts are often not installed, and LibreOffice then falls back to a serif.
// For previews only, map them to the fallbacks the design system lists. Exports keep the original fonts.
const fontSwap = (xml: string) =>
  xml
    .replace(/typeface="(Untitled Sans[^"]*|Helvetica Neue|Maison Neue)"/g, 'typeface="Arial"')
    .replace(/typeface="Bebas Neue[^"]*"/g, 'typeface="Arial Narrow"');

/** Writes `${outDir}/${fileNameFor(n)}` for every slide number n. */
export async function renderPreviews(pptx: Uint8Array, outDir: string, fileNameFor: (slideNumber: number) => string) {
  const work = mkdtempSync(path.join(tmpdir(), 'slidevault-render-'));
  try {
    const copy = await JSZip.loadAsync(pptx);
    for (const name of Object.keys(copy.files).filter((n) => /^ppt\/(slides|slideLayouts|slideMasters|theme)\/[^/]+\.xml$/.test(n))) {
      copy.file(name, fontSwap(await copy.file(name)!.async('string')));
    }
    const slides = await listSlides(pptx);
    for (const s of slides) {
      // Renderers skip hidden slides; un-hide them in the copy so every slide gets a preview.
      const xml = await copy.file(s.part)!.async('string');
      copy.file(s.part, xml.replace(/(<p:sld\b[^>]*?)\sshow="0"/, '$1'));
    }
    const deck = path.join(work, 'deck.pptx');
    writeFileSync(deck, await copy.generateAsync({ type: 'uint8array' }));
    execFileSync(process.env.SOFFICE ?? 'soffice', ['--headless', '--convert-to', 'pdf', '--outdir', work, deck], { stdio: 'ignore' });
    execFileSync('pdftoppm', ['-png', '-scale-to-x', '1280', '-scale-to-y', '-1', path.join(work, 'deck.pdf'), path.join(work, 'page')]);

    const pages = readdirSync(work).filter((f) => /^page-\d+\.png$/.test(f));
    if (pages.length !== slides.length) throw new Error(`Rendered ${pages.length} previews for ${slides.length} slides`);
    for (const page of pages) {
      const n = Number(page.match(/-(\d+)\.png$/)![1]);
      renameSync(path.join(work, page), path.join(outDir, fileNameFor(n)));
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

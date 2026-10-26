/**
 * Build the library index from every .pptx and .pdf in the library folder.
 *
 *   npm run ingest
 *
 * Reads every .pptx under SLIDEVAULT_LIBRARY_DIR, subfolders included (default: tests/fixtures, the
 * synthetic decks), with settings from .env.local exactly as the app reads them. Never modifies a source.
 * Each deck is recorded by its path inside the library, so folders like "2024/Kestrel Law" or
 * "Best of the Best/IDD" give its year, client and category (server/folder-path.ts).
 * Writes into SLIDEVAULT_DATA_DIR (default: .data, gitignored):
 *   library.json            sources, immutable versions and slides
 *   previews/<slideId>.png  one preview per slide
 *
 * IDs are opaque and stable: the version ID comes from the SHA-256 of the original bytes,
 * so a changed file becomes a new version with new slide IDs (docs/DATA_AND_API.md, "Domain model").
 * A .pdf becomes one slide per page, with its text and a picture of the page (Poppler's pdftotext and
 * pdftoppm). Its pages can be found, previewed and used in a storyboard, but never downloaded as
 * editable PowerPoint: there is none. A PDF with the same name as a PowerPoint is skipped as a copy.
 * Its page IDs are the ones the local model's PDF scan used (pdf_<name hash>_p<n>), so what the
 * model read on each page (discover-scan-pdf.json) attaches to it.
 *
 * Previews already drawn for a version are kept, so adding a deck doesn't redraw every other one.
 * deck-catalog.json in the data dir, when present, gives decks their reviewed client, year and kind.
 * Restart the app afterwards so it reloads the index.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nextEnv from '@next/env';
import { readConfig } from '../features/slide-vault/server/config';
import { indexFile, type IndexedSource, type LibraryIndex } from '../features/slide-vault/server/library-repository';
import JSZip from 'jszip';
import { deckTitle, extractSlides } from '../workers/slide-vault/processors/extract-text';
import { renderPreviews } from '../workers/slide-vault/processors/render-previews';

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const humanize = (fileName: string) =>
  path.basename(fileName).replace(/\.(pptx|pdf)$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Every .pptx and .pdf under dir, as paths relative to it with / between folders, sorted. Office lock files (~$...) are skipped. */
function deckFiles(dir: string, rel = ''): string[] {
  return readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) return deckFiles(dir, p);
      return e.isFile() && /\.(pptx|pdf)$/i.test(e.name) && !e.name.startsWith('~$') ? [p] : [];
    })
    .sort();
}

/**
 * A deck's template, from its first theme: heading and body fonts, color scheme and main accent.
 * Slides made on the same template look alike; with the client and year it marks slides that belong
 * together even when they are stored as separate files (FD-42). Null when there is no theme.
 */
async function templateOf(bytes: Uint8Array): Promise<string | null> {
  const zip = await JSZip.loadAsync(bytes);
  const first = Object.keys(zip.files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n)).sort()[0];
  if (!first) return null;
  const t = await zip.file(first)!.async('string');
  const pick = (re: RegExp) => re.exec(t)?.[1] ?? '';
  const parts = [pick(/<a:majorFont>\s*<a:latin typeface="([^"]*)"/), pick(/<a:minorFont>\s*<a:latin typeface="([^"]*)"/), pick(/<a:clrScheme name="([^"]*)"/), pick(/<a:accent1>\s*<a:srgbClr val="([^"]*)"/)];
  return parts.some(Boolean) ? parts.join('/') : null;
}

const stem = (fileName: string) => path.basename(fileName).replace(/\.(pptx|pdf)$/i, '').toLowerCase();

/** One slide per page: its text (the first line as its title) and, unless already drawn, its picture. */
function pdfPages(file: string, previewDir: string, pageId: (n: number) => string) {
  const pages = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8').split('\f');
  if (pages.length && !pages[pages.length - 1].trim()) pages.pop();
  const missing = pages.some((_, i) => !existsSync(path.join(previewDir, `${pageId(i + 1)}.png`)));
  if (missing) {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'sv-pdf-'));
    try {
      execFileSync('pdftoppm', ['-png', '-scale-to', '960', file, path.join(tmp, 'p')]);
      for (const f of readdirSync(tmp)) {
        const n = Number(/-(\d+)\.png$/.exec(f)?.[1]);
        if (n) renameSync(path.join(tmp, f), path.join(previewDir, `${pageId(n)}.png`));
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return pages.map((page, i) => {
    const lines = page.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return { number: i + 1, title: (lines[0] ?? `Page ${i + 1}`).slice(0, 120), text: lines.join('\n'), hidden: false };
  });
}

async function main() {
  // Same settings as the app: .env.local, then .env (Next.js's own loader).
  nextEnv.loadEnvConfig(process.cwd());
  const { libraryDir, dataDir } = readConfig();
  const all = deckFiles(libraryDir);
  const pptxStems = new Set(all.filter((f) => /\.pptx$/i.test(f)).map(stem));
  const files = all.filter((f) => /\.pptx$/i.test(f) || !pptxStems.has(stem(f)));
  if (files.length === 0) throw new Error(`No .pptx or .pdf files in ${libraryDir}`);

  const previewDir = path.join(dataDir, 'previews');
  mkdirSync(previewDir, { recursive: true });
  const drawn = new Set(readdirSync(previewDir));
  // Reviewed facts about each deck (client, year, kind), keyed by its path in the library, when there are any.
  const catalogFile = path.join(dataDir, 'deck-catalog.json');
  const catalog = existsSync(catalogFile) ? (JSON.parse(readFileSync(catalogFile, 'utf8')) as Record<string, IndexedSource['deck']>) : {};
  // By path inside the library, else by file name alone, so a copy of the library in other folders still matches.
  const byName = new Map(Object.entries(catalog).map(([k, v]) => [path.basename(k), v]));
  const deckFacts = (fileName: string) => catalog[fileName] ?? byName.get(path.basename(fileName));

  const index: LibraryIndex = { generatedAt: new Date().toISOString(), sources: [] };
  for (const fileName of files) {
    const bytes = new Uint8Array(readFileSync(path.join(libraryDir, fileName)));
    const hash = sha256(bytes);
    const versionId = `ver_${hash.slice(0, 16)}`;
    const slideId = (n: number) => `sld_${sha256(`${versionId}:${n}`).slice(0, 16)}`;

    if (/\.pdf$/i.test(fileName)) {
      const deck = `pdf_${sha256(path.basename(fileName)).slice(0, 12)}`;
      const slides = pdfPages(path.join(libraryDir, fileName), previewDir, (n) => `${deck}_p${n}`);
      index.sources.push({ id: `src_${sha256(fileName).slice(0, 12)}`, title: humanize(fileName), fileName, versionId, sha256: hash, slides: slides.map((s) => ({ id: `${deck}_p${s.number}`, ...s })), ...(deckFacts(fileName) ? { deck: deckFacts(fileName) } : {}) });
      console.log(`${fileName}: ${slides.length} pages (PDF)`);
      continue;
    }
    const slides = await extractSlides(bytes);
    if (slides.some((s) => !drawn.has(`${slideId(s.number)}.png`))) await renderPreviews(bytes, previewDir, (n) => `${slideId(n)}.png`);

    index.sources.push({
      id: `src_${sha256(fileName).slice(0, 12)}`,
      title: (await deckTitle(bytes)) ?? humanize(fileName),
      fileName,
      versionId,
      sha256: hash,
      slides: slides.map((s) => ({ id: slideId(s.number), ...s })),
      ...(deckFacts(fileName) ? { deck: deckFacts(fileName) } : {}),
      template: await templateOf(bytes),
    });
    console.log(`${fileName}: ${slides.length} slides`);
    for (const s of slides) console.log(`  ${String(s.number).padStart(2)}${s.hidden ? ' (hidden)' : '         '}  ${s.title}`);
  }

  // Pictures of slides no longer in the library go.
  const keep = new Set(index.sources.flatMap((s) => s.slides.map((x) => `${x.id}.png`)));
  for (const f of readdirSync(previewDir)) if (!keep.has(f)) rmSync(path.join(previewDir, f));
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(indexFile(dataDir), JSON.stringify(index, null, 2) + '\n');
  console.log(`\nIndexed ${index.sources.length} decks into ${path.relative(process.cwd(), dataDir) || '.'}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Build the library index from every .pptx in the library folder.
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
 * Restart the app afterwards so it reloads the index.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import nextEnv from '@next/env';
import { readConfig } from '../features/slide-vault/server/config';
import { indexFile, type LibraryIndex } from '../features/slide-vault/server/library-repository';
import { deckTitle, extractSlides } from '../workers/slide-vault/processors/extract-text';
import { renderPreviews } from '../workers/slide-vault/processors/render-previews';

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const humanize = (fileName: string) =>
  path.basename(fileName).replace(/\.pptx$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Every .pptx under dir, as paths relative to it with / between folders, sorted. Office lock files (~$...) are skipped. */
function pptxFiles(dir: string, rel = ''): string[] {
  return readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) return pptxFiles(dir, p);
      return e.isFile() && e.name.toLowerCase().endsWith('.pptx') && !e.name.startsWith('~$') ? [p] : [];
    })
    .sort();
}

async function main() {
  // Same settings as the app: .env.local, then .env (Next.js's own loader).
  nextEnv.loadEnvConfig(process.cwd());
  const { libraryDir, dataDir } = readConfig();
  const files = pptxFiles(libraryDir);
  if (files.length === 0) throw new Error(`No .pptx files in ${libraryDir}`);

  const previewDir = path.join(dataDir, 'previews');
  rmSync(previewDir, { recursive: true, force: true });
  mkdirSync(previewDir, { recursive: true });

  const index: LibraryIndex = { generatedAt: new Date().toISOString(), sources: [] };
  for (const fileName of files) {
    const bytes = new Uint8Array(readFileSync(path.join(libraryDir, fileName)));
    const hash = sha256(bytes);
    const versionId = `ver_${hash.slice(0, 16)}`;
    const slideId = (n: number) => `sld_${sha256(`${versionId}:${n}`).slice(0, 16)}`;

    const slides = await extractSlides(bytes);
    await renderPreviews(bytes, previewDir, (n) => `${slideId(n)}.png`);

    index.sources.push({
      id: `src_${sha256(fileName).slice(0, 12)}`,
      title: (await deckTitle(bytes)) ?? humanize(fileName),
      fileName,
      versionId,
      sha256: hash,
      slides: slides.map((s) => ({ id: slideId(s.number), ...s })),
    });
    console.log(`${fileName}: ${slides.length} slides`);
    for (const s of slides) console.log(`  ${String(s.number).padStart(2)}${s.hidden ? ' (hidden)' : '         '}  ${s.title}`);
  }

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(indexFile(dataDir), JSON.stringify(index, null, 2) + '\n');
  console.log(`\nIndexed ${index.sources.length} decks into ${path.relative(process.cwd(), dataDir) || '.'}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

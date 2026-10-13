/**
 * Build the library index from every .pptx in the library folder.
 *
 *   npm run ingest
 *
 * Reads SLIDEVAULT_LIBRARY_DIR (default: tests/fixtures, the synthetic decks). Never modifies a source.
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
import { readConfig } from '../features/slide-vault/server/config';
import { indexFile, type LibraryIndex } from '../features/slide-vault/server/library-repository';
import { deckTitle, extractSlides } from '../workers/slide-vault/processors/extract-text';
import { renderPreviews } from '../workers/slide-vault/processors/render-previews';

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const humanize = (fileName: string) =>
  fileName.replace(/\.pptx$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

async function main() {
  const { libraryDir, dataDir } = readConfig();
  const files = readdirSync(libraryDir).filter((f) => f.toLowerCase().endsWith('.pptx')).sort();
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

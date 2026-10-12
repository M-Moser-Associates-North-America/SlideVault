import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractSlides } from '../../../../workers/slide-vault/processors/extract-text';
import { renderPreviews } from '../../../../workers/slide-vault/processors/render-previews';
import type { DeckSummary, UploadDeckMeta } from '../../contracts/dto';
import { ServiceError } from '../http';
import { createDeck, findDeckByHash, insertSlides, markDeckFailed, markDeckReady } from '../pg-repository';
import { readSlideSize } from '../slide-size';
import { uploadOriginal, uploadPreview } from '../storage';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Store a .pptx unchanged, split it into slide records, and save everything in Postgres
 * (docs/foundry/SLIDE_RECORD.md). Runs synchronously in the request -- the same accepted
 * prototype shortcut as exports (docs/DECISIONS.md FD-03), not a silent gap; a real job
 * queue is a later milestone.
 *
 * `meta` fields come from a form today; reading them from real SharePoint-style subfolders
 * is Vincent's ingest-reads-subfolders piece and plugs into this same function later.
 */
export async function processUpload(fileName: string, bytes: Uint8Array, meta: UploadDeckMeta): Promise<DeckSummary> {
  if (!fileName.toLowerCase().endsWith('.pptx')) {
    throw new ServiceError(415, 'UNSUPPORTED_FILE_TYPE', 'Only .pptx files are accepted.');
  }

  const fileHash = sha256(bytes);
  const existing = await findDeckByHash(fileHash);
  if (existing) throw new ServiceError(409, 'DUPLICATE_DECK', `This file was already uploaded as "${existing.title}".`);

  const title = fileName.replace(/\.pptx$/i, '');
  const deckId = randomUUID();
  const sourceStorageKey = await uploadOriginal(deckId, bytes);
  const slideSize = await readSlideSize(bytes);

  await createDeck({
    id: deckId,
    client: meta.clientName ?? 'Unknown client',
    year: meta.deckYear,
    category: meta.category,
    sourcePath: meta.folderPath ?? fileName,
    title,
    sourceFilename: fileName,
    filePath: sourceStorageKey,
    fileHash,
    bestOfTheBest: meta.bestOfTheBest,
    slideSize,
  });

  // The deck row exists now (status "processing"); failures from here are recorded on
  // it rather than only returned, so the library can show what went wrong.
  try {
    const slides = await extractSlides(bytes);
    const previewDir = mkdtempSync(path.join(tmpdir(), 'slidevault-upload-'));
    try {
      await renderPreviews(bytes, previewDir, (n) => `${n}.png`);
      const slideInputs = await Promise.all(
        slides.map(async (slide) => {
          const previewBytes = new Uint8Array(readFileSync(path.join(previewDir, `${slide.number}.png`)));
          const thumbnailStorageKey = await uploadPreview(deckId, slide.number, previewBytes);
          return {
            slideNumber: slide.number,
            title: slide.title,
            extractedText: slide.text,
            thumbnailStorageKey,
            isHiddenInSource: slide.hidden,
          };
        }),
      );
      await insertSlides(deckId, slideInputs);
    } finally {
      rmSync(previewDir, { recursive: true, force: true });
    }

    await markDeckReady(deckId, slides.length);
    return { id: deckId, title, status: 'ready', error: null, slideCount: slides.length };
  } catch (e) {
    const message = (e as Error).message || 'Could not process this deck.';
    await markDeckFailed(deckId, message).catch(() => {});
    throw new ServiceError(422, 'UPLOAD_FAILED', message);
  }
}

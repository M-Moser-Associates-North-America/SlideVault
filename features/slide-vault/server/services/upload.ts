import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractSlides } from '../../../../workers/slide-vault/processors/extract-text';
import { renderPreviews } from '../../../../workers/slide-vault/processors/render-previews';
import type { DeckSummary, UploadDeckMeta } from '../../contracts/dto';
import { ServiceError } from '../http';
import { describeChanges, detailsToAdd } from '../deck-details';
import { createDeck, findDeckByHash, insertSlides, markDeckFailed, markDeckReady, restartDeck, updateDeckDetails } from '../pg-repository';
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
  const changes = existing
    ? detailsToAdd(existing, { client: meta.clientName, year: meta.deckYear, category: meta.category, bestOfTheBest: meta.bestOfTheBest })
    : {};

  if (existing?.status === 'failed') {
    // An earlier attempt stored the original but didn't finish (for example a network hiccup while
    // storing previews). Its original is already in the bucket, which can't be overwritten, so
    // process it again under the same deck: nothing new is stored for the original.
    if (describeChanges(changes).length) await updateDeckDetails(existing.id, changes);
    await restartDeck(existing.id);
    return processSlides(existing.id, existing.title, bytes);
  }

  if (existing) {
    // Same file from another folder (e.g. a Best of the Best copy of a past submittal): keep one
    // deck and add whatever this folder knows that the first one didn't (deck-details.ts, FD-11).
    const added = describeChanges(changes);
    if (added.length === 0) throw new ServiceError(409, 'DUPLICATE_DECK', `This file was already uploaded as "${existing.title}".`);
    await updateDeckDetails(existing.id, changes);
    return {
      id: existing.id,
      title: existing.title,
      status: existing.status,
      error: null,
      slideCount: existing.slideCount,
      alreadyUploaded: true,
      addedDetails: added,
    };
  }

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
  return processSlides(deckId, title, bytes);
}

/** Previews stored at the same time. Big decks have 50+ slides; all at once overwhelms the connection. */
const PREVIEW_UPLOADS_AT_ONCE = 4;

async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  return out;
}

/**
 * Split a stored deck into slide records with previews. The deck row exists (status "processing");
 * failures are recorded on it rather than only returned, so the library can show what went wrong
 * and the same upload can be run again to finish it.
 */
async function processSlides(deckId: string, title: string, bytes: Uint8Array): Promise<DeckSummary> {
  try {
    const slides = await extractSlides(bytes);
    const previewDir = mkdtempSync(path.join(tmpdir(), 'slidevault-upload-'));
    try {
      await renderPreviews(bytes, previewDir, (n) => `${n}.png`);
      const slideInputs = await inBatches(slides, PREVIEW_UPLOADS_AT_ONCE, async (slide) => {
        const previewBytes = new Uint8Array(readFileSync(path.join(previewDir, `${slide.number}.png`)));
        const thumbnailStorageKey = await uploadPreview(deckId, slide.number, previewBytes);
        return {
          slideNumber: slide.number,
          title: slide.title,
          extractedText: slide.text,
          thumbnailStorageKey,
          isHiddenInSource: slide.hidden,
        };
      });
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

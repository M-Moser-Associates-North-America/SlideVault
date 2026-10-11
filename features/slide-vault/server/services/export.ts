import 'server-only';
import { readFile } from 'node:fs/promises';
import type { ExportRequest } from '../../contracts/dto';
import { bundleDeckFiles, type DeckFile } from '../export-bundle';
import { exportSelectedSlides, ExportValidationError } from '../export-pptx';
import { ServiceError } from '../http';
import { findSlide, sourceFilePath, type IndexedSlide, type IndexedSource, type LibraryIndex } from '../library-repository';

export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const ZIP_TYPE = 'application/zip';

export type ExportFile = { bytes: Uint8Array; fileName: string; contentType: string; deckCount: number };

/**
 * Validate an export request against the library, then build the download.
 *
 *  - Slides from one deck: one .pptx, in the selected order.
 *  - Slides from several decks: a .zip with one .pptx per deck (FD-09). Each file keeps the selected
 *    order of its own slides; files are numbered in the order their decks first appear.
 *
 * Prototype limits, recorded in docs/DECISIONS.md:
 *  - FD-03: the file is built in the request and returned directly (no job queue yet)
 *  - FD-05 (rule kept): each slide at most once per export
 */
export async function exportSlides(index: LibraryIndex, request: ExportRequest): Promise<ExportFile> {
  if (request.format !== 'pptx') throw new ServiceError(400, 'BAD_REQUEST', 'Only "pptx" export is available.');
  if (request.fidelityPolicy !== 'preserve-source')
    throw new ServiceError(400, 'BAD_REQUEST', 'Only the "preserve-source" fidelity policy is available.');
  if (!Array.isArray(request.items) || request.items.length === 0)
    throw new ServiceError(400, 'INVALID_SELECTION', 'Select at least one slide.');

  const resolved = request.items.map((item) => {
    const found = typeof item?.slideId === 'string' ? findSlide(index, item.slideId) : null;
    if (!found) throw new ServiceError(400, 'INVALID_SELECTION', 'A selected slide is no longer in the library. Remove it and try again.');
    if (found.source.versionId !== item.sourceVersionId)
      throw new ServiceError(400, 'INVALID_SELECTION', `"${found.slide.title}" has a newer version. Re-add it and try again.`);
    return found;
  });

  // Group by deck, keeping the order decks first appear and the selected order within each deck.
  const groups = new Map<string, { source: IndexedSource; slides: IndexedSlide[] }>();
  for (const { source, slide } of resolved) {
    const group = groups.get(source.id) ?? { source, slides: [] };
    group.slides.push(slide);
    groups.set(source.id, group);
  }

  const files: DeckFile[] = [];
  for (const { source, slides } of groups.values()) {
    const original = new Uint8Array(await readFile(sourceFilePath(source)));
    const slideNumbers = slides.map((s) => s.number);
    try {
      files.push({ deckTitle: source.title, slideNumbers, bytes: await exportSelectedSlides(original, slideNumbers) });
    } catch (e) {
      if (e instanceof ExportValidationError) throw new ServiceError(400, 'INVALID_SELECTION', e.message);
      throw e;
    }
  }

  if (files.length === 1) return { bytes: files[0].bytes, fileName: 'SlideVault-export.pptx', contentType: PPTX_TYPE, deckCount: 1 };
  return { bytes: await bundleDeckFiles(files), fileName: 'SlideVault-export.zip', contentType: ZIP_TYPE, deckCount: files.length };
}

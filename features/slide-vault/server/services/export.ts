import 'server-only';
import { readFile } from 'node:fs/promises';
import type { ExportRequest } from '../../contracts/dto';
import { hasMmoserConfig } from '../config';
import { bundleDeckFiles, type DeckFile } from '../export-bundle';
import { exportSelectedSlides, ExportValidationError } from '../export-pptx';
import { ServiceError } from '../http';
import { findSlide, sourceFilePath, type LibraryIndex } from '../library-repository';
import { getSlidesForExport, type ExportableSlide } from '../pg-repository';
import { downloadOriginal } from '../storage';

export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const ZIP_TYPE = 'application/zip';

export type ExportFile = { bytes: Uint8Array; fileName: string; contentType: string; deckCount: number };

/**
 * Where uploaded decks live (Postgres records + the private slide-originals bucket).
 * Passed in so tests can use a fake instead of a real Supabase project.
 */
export type UploadedDecks = {
  findSlides(slideIds: string[]): Promise<ExportableSlide[]>;
  loadOriginal(storageKey: string): Promise<Uint8Array>;
};


/** The real uploaded-deck store. On a checkout without Supabase set up, it simply has no slides. */
export const supabaseUploadedDecks: UploadedDecks = {
  findSlides: async (ids) => (hasMmoserConfig() ? getSlidesForExport(ids) : []),
  loadOriginal: downloadOriginal,
};

/** One selected slide, wherever it came from. */
type Resolved = {
  deckKey: string;
  deckTitle: string;
  slideNumber: number;
  loadDeck: () => Promise<Uint8Array>;
};

/**
 * Validate an export request, then build the download. Slides can come from the fixture
 * library index, from uploaded decks in Postgres, or both in one selection.
 *
 *  - Slides from one deck: one .pptx, in the selected order.
 *  - Slides from several decks: a .zip with one .pptx per deck (FD-09). Each file keeps the selected
 *    order of its own slides; files are numbered in the order their decks first appear.
 *
 * Prototype limits, recorded in docs/DECISIONS.md:
 *  - FD-03: the file is built in the request and returned directly (no job queue yet)
 *  - FD-05 (rule kept): each slide at most once per export
 */
export async function exportSlides(
  index: LibraryIndex | null,
  request: ExportRequest,
  uploaded: UploadedDecks = supabaseUploadedDecks,
): Promise<ExportFile> {
  if (request.format !== 'pptx') throw new ServiceError(400, 'BAD_REQUEST', 'Only "pptx" export is available.');
  if (request.fidelityPolicy !== 'preserve-source')
    throw new ServiceError(400, 'BAD_REQUEST', 'Only the "preserve-source" fidelity policy is available.');
  if (!Array.isArray(request.items) || request.items.length === 0)
    throw new ServiceError(400, 'INVALID_SELECTION', 'Select at least one slide.');
  if (request.items.some((item) => typeof item?.slideId !== 'string'))
    throw new ServiceError(400, 'INVALID_SELECTION', 'A selected slide is no longer in the library. Remove it and try again.');

  // Anything not in the fixture index is looked up among uploaded decks, in one query.
  const notInIndex = request.items.filter((item) => !(index && findSlide(index, item.slideId))).map((item) => item.slideId);
  const uploadedById = new Map((notInIndex.length ? await uploaded.findSlides(notInIndex) : []).map((s) => [s.slideId, s]));

  const resolved: Resolved[] = request.items.map((item) => {
    const fixture = index ? findSlide(index, item.slideId) : null;
    if (fixture) {
      if (fixture.source.versionId !== item.sourceVersionId)
        throw new ServiceError(400, 'INVALID_SELECTION', `"${fixture.slide.title}" has a newer version. Re-add it and try again.`);
      const file = sourceFilePath(fixture.source);
      return {
        deckKey: `fixture:${fixture.source.id}`,
        deckTitle: fixture.source.title,
        slideNumber: fixture.slide.number,
        loadDeck: async () => new Uint8Array(await readFile(file)),
      };
    }
    const up = uploadedById.get(item.slideId);
    if (!up) throw new ServiceError(400, 'INVALID_SELECTION', 'A selected slide is no longer in the library. Remove it and try again.');
    if (!up.deckReady)
      throw new ServiceError(400, 'INVALID_SELECTION', `"${up.deckTitle}" is still processing or failed to process. Try again once it's ready.`);
    if (up.deckVersionId !== item.sourceVersionId)
      throw new ServiceError(400, 'INVALID_SELECTION', `"${up.title}" has a newer version. Re-add it and try again.`);
    return {
      deckKey: `upload:${up.deckId}`,
      deckTitle: up.deckTitle,
      slideNumber: up.slideNumber,
      loadDeck: () => uploaded.loadOriginal(up.originalStorageKey),
    };
  });

  // Group by deck, keeping the order decks first appear and the selected order within each deck.
  const groups = new Map<string, { first: Resolved; slideNumbers: number[] }>();
  for (const r of resolved) {
    const group = groups.get(r.deckKey) ?? { first: r, slideNumbers: [] };
    group.slideNumbers.push(r.slideNumber);
    groups.set(r.deckKey, group);
  }

  const files: DeckFile[] = [];
  for (const { first, slideNumbers } of groups.values()) {
    let original: Uint8Array;
    try {
      original = await first.loadDeck();
    } catch (e) {
      console.error('Could not load original deck for export', e);
      throw new ServiceError(503, 'EXPORT_FAILED', `Couldn't load "${first.deckTitle}" right now. Please try again.`);
    }
    try {
      files.push({ deckTitle: first.deckTitle, slideNumbers, bytes: await exportSelectedSlides(original, slideNumbers) });
    } catch (e) {
      if (e instanceof ExportValidationError) throw new ServiceError(400, 'INVALID_SELECTION', e.message);
      throw e;
    }
  }

  if (files.length === 1) return { bytes: files[0].bytes, fileName: 'SlideVault-export.pptx', contentType: PPTX_TYPE, deckCount: 1 };
  return { bytes: await bundleDeckFiles(files), fileName: 'SlideVault-export.zip', contentType: ZIP_TYPE, deckCount: files.length };
}

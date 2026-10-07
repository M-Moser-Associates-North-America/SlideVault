import 'server-only';
import { readFile } from 'node:fs/promises';
import type { ExportRequest } from '../../contracts/dto';
import { exportSelectedSlides, ExportValidationError } from '../export-pptx';
import { ServiceError } from '../http';
import { findSlide, sourceFilePath, type LibraryIndex } from '../library-repository';

/**
 * Validate an export request against the library, then build the .pptx.
 *
 * Prototype limits, recorded in docs/DECISIONS.md:
 *  - FD-03: the file is built in the request and returned directly (no job queue yet)
 *  - FD-05: all items must come from one source deck version
 */
export async function exportSlides(index: LibraryIndex, request: ExportRequest): Promise<Uint8Array> {
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

  const source = resolved[0].source;
  if (resolved.some((r) => r.source.id !== source.id))
    throw new ServiceError(422, 'UNSUPPORTED_SELECTION', 'This version exports slides from one deck at a time. Remove slides from other decks, then export.');

  const original = new Uint8Array(await readFile(sourceFilePath(source)));
  try {
    return await exportSelectedSlides(original, resolved.map((r) => r.slide.number));
  } catch (e) {
    if (e instanceof ExportValidationError) throw new ServiceError(400, 'INVALID_SELECTION', e.message);
    throw e;
  }
}

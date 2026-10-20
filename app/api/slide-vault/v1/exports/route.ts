import type { ExportRequest } from '@/features/slide-vault/contracts/dto';
import { exportSlides, fail, file, hasMmoserConfig, loadLibraryIndex, RATE_POLICIES, rateLimit, ServiceError, toResponse } from '@/features/slide-vault/server';
import { recordDownloads } from '@/features/slide-vault/server/user-data';

// POST /exports: build an editable .pptx from an ordered selection (a .zip of one .pptx per deck when it spans decks).
// Prototype: returns the file directly instead of 202 + job (decision FD-03).
export async function POST(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.export);
  if (limited) return limited;
  let body: ExportRequest;
  try {
    body = (await request.json()) as ExportRequest;
  } catch {
    return fail(400, 'BAD_REQUEST', 'Send a JSON export request.');
  }

  // Slides can come from the fixture index, uploaded decks, or both. With no fixture index
  // (ingest not run), uploaded slides still export; unknown slides get a clear 400.
  const index = await loadLibraryIndex();

  try {
    const result = await exportSlides(index, body);
    // "Most downloaded" (FD-18): count each slide once per download. Never blocks or fails the download.
    if (hasMmoserConfig()) {
      await recordDownloads(body.items.map((item) => item.slideId)).catch((e) => console.error('Could not count this download', e));
    }
    return file(result.bytes, result.contentType, result.fileName);
  } catch (e) {
    if (e instanceof ServiceError) return toResponse(e);
    console.error('Export failed', e);
    return fail(500, 'EXPORT_FAILED', 'The export could not be built. Please try again.', true);
  }
}

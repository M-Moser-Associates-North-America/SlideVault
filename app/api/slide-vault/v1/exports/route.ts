import type { ExportRequest } from '@/features/slide-vault/contracts/dto';
import { exportSlides, fail, file, loadLibraryIndex, ServiceError, toResponse } from '@/features/slide-vault/server';

// POST /exports: build an editable .pptx from an ordered selection.
// Prototype: returns the file directly instead of 202 + job (decision FD-03).
export async function POST(request: Request) {
  let body: ExportRequest;
  try {
    body = (await request.json()) as ExportRequest;
  } catch {
    return fail(400, 'BAD_REQUEST', 'Send a JSON export request.');
  }

  const index = await loadLibraryIndex();
  if (!index) return fail(503, 'LIBRARY_NOT_READY', 'The library is empty. Run `npm run ingest`, then restart the app.', true);

  try {
    const pptx = await exportSlides(index, body);
    return file(pptx, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'SlideVault-export.pptx');
  } catch (e) {
    if (e instanceof ServiceError) return toResponse(e);
    console.error('Export failed', e);
    return fail(500, 'EXPORT_FAILED', 'The export could not be built. Please try again.', true);
  }
}

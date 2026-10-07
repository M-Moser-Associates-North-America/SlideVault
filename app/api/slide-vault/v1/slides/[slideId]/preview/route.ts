import { readFile } from 'node:fs/promises';
import { fail, file, findSlide, loadLibraryIndex, previewFile, readConfig } from '@/features/slide-vault/server';

// GET /slides/:id/preview: the slide thumbnail, served through the API rather than as a public file
// so access can be checked here once sign-in exists (docs/DATA_AND_API.md).
export async function GET(_request: Request, ctx: RouteContext<'/api/slide-vault/v1/slides/[slideId]/preview'>) {
  const { slideId } = await ctx.params;
  const index = await loadLibraryIndex();
  if (!index || !findSlide(index, slideId)) return fail(404, 'NOT_FOUND', 'Slide not found.');
  try {
    return file(new Uint8Array(await readFile(previewFile(readConfig().dataDir, slideId))), 'image/png');
  } catch {
    return fail(404, 'NOT_FOUND', 'Preview not generated yet. Run `npm run ingest`.');
  }
}

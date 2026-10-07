import { readFile } from 'node:fs/promises';
import { exportSelectedSlides, ExportValidationError, SOURCE_DECK } from '@/features/slide-vault/server';

// Thin handler: parse, delegate to the feature, map errors to HTTP.
export async function POST(request: Request) {
  let slideNumbers: unknown;
  try {
    ({ slideNumbers } = (await request.json()) as { slideNumbers?: unknown });
  } catch {
    return Response.json({ error: { code: 'BAD_REQUEST', message: 'Send JSON: {"slideNumbers": [1, 2, 3]}' } }, { status: 400 });
  }
  if (!Array.isArray(slideNumbers)) {
    return Response.json({ error: { code: 'BAD_REQUEST', message: 'slideNumbers must be an array of slide numbers.' } }, { status: 400 });
  }

  try {
    const source = new Uint8Array(await readFile(SOURCE_DECK.path));
    const pptx = await exportSelectedSlides(source, slideNumbers as number[]);
    return new Response(Buffer.from(pptx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="SlideVault-export.pptx"',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof ExportValidationError) {
      return Response.json({ error: { code: 'INVALID_SELECTION', message: e.message } }, { status: 400 });
    }
    console.error('Export failed', e);
    return Response.json({ error: { code: 'EXPORT_FAILED', message: 'The export could not be built. Please try again.' } }, { status: 500 });
  }
}

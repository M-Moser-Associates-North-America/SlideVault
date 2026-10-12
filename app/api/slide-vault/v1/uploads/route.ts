import type { UploadDeckMeta } from '@/features/slide-vault/contracts/dto';
import { fail, ok, ServiceError, toResponse } from '@/features/slide-vault/server';
import { processUpload } from '@/features/slide-vault/server/services/upload';

// POST /uploads (multipart/form-data): file + clientName, deckYear, category, folderPath,
// bestOfTheBest. A .pptx goes in, is stored unchanged, and is split into slide records.
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'BAD_REQUEST', 'Expected multipart/form-data.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return fail(400, 'BAD_REQUEST', 'Attach a .pptx file as "file".');

  const deckYearRaw = form.get('deckYear') as string | null;
  const meta: UploadDeckMeta = {
    clientName: (form.get('clientName') as string | null)?.trim() || null,
    deckYear: deckYearRaw && Number.isInteger(Number(deckYearRaw)) ? Number(deckYearRaw) : null,
    category: (form.get('category') as string | null)?.trim() || null,
    folderPath: (form.get('folderPath') as string | null)?.trim() || null,
    bestOfTheBest: form.get('bestOfTheBest') === 'true',
  };

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const summary = await processUpload(file.name, bytes, meta);
    return ok(summary);
  } catch (e) {
    if (e instanceof ServiceError) return toResponse(e);
    console.error('Upload failed', e);
    return fail(500, 'UPLOAD_FAILED', 'The upload could not be processed. Please try again.', true);
  }
}

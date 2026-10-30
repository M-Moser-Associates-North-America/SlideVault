import { fail, ok, RATE_POLICIES, rateLimit, ServiceError, toResponse } from '@/features/slide-vault/server';
import { previewUpload } from '@/features/slide-vault/server/services/upload-preview';

// POST /uploads/preview (multipart/form-data: file) (docs/DECISIONS.md FD-54)
// The chosen deck's slides as pictures, so the upload page can show real cards before anything is
// stored. Nothing is saved to the database or the bucket. Returns
// { token, fileName, slideCount, alreadyUploadedAs, slides: [{ number, title, hiddenInSource, previewPath }] }.
export async function POST(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.uploadSuggest);
  if (limited) return limited;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'BAD_REQUEST', 'Expected multipart/form-data.');
  }
  const file = form.get('file');
  if (!(file instanceof File)) return fail(400, 'BAD_REQUEST', 'Attach a .pptx file as "file".');
  try {
    return ok(await previewUpload(file.name, new Uint8Array(await file.arrayBuffer())));
  } catch (e) {
    if (e instanceof ServiceError) return toResponse(e);
    console.error('Upload preview failed', e);
    return fail(500, 'UPLOAD_FAILED', 'The preview could not be made. Please try again.', true);
  }
}

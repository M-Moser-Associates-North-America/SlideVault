import { after } from 'next/server';
import type { UploadDeckMeta } from '@/features/slide-vault/contracts/dto';
import { fail, ok, RATE_POLICIES, rateLimit, ServiceError, toResponse } from '@/features/slide-vault/server';
import { userOf } from '@/features/slide-vault/server/principal';
import { processUpload } from '@/features/slide-vault/server/services/upload';
import { embedDeckQuietly } from '@/features/slide-vault/server/slide-embeddings';
import { addUploadTags } from '@/features/slide-vault/server/tags';

// POST /uploads (multipart/form-data): file + clientName, deckYear, category, folderPath,
// bestOfTheBest. A .pptx goes in, is stored unchanged, and is split into slide records. Its meaning
// fingerprints are made right after the response (FD-82), so the deck joins meaning search and tag
// suggestions without anyone running embed:slides; the upload never waits on or fails because of them.
export async function POST(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.upload);
  if (limited) return limited;
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

  // Tags chosen on the upload page (FD-54): deckTags = ["..."], slideTags = { "3": ["..."] } (by slide number), both JSON.
  let deckTags: string[] = [];
  let slideTags: Record<string, string[]> = {};
  try {
    const d = form.get('deckTags');
    const s = form.get('slideTags');
    if (typeof d === 'string' && d) deckTags = JSON.parse(d);
    if (typeof s === 'string' && s) slideTags = JSON.parse(s);
    const okShape = Array.isArray(deckTags) && deckTags.every((t) => typeof t === 'string') && slideTags && typeof slideTags === 'object' && !Array.isArray(slideTags)
      && Object.values(slideTags).every((v) => Array.isArray(v) && v.every((t) => typeof t === 'string'));
    if (!okShape) throw new Error('shape');
  } catch {
    return fail(400, 'BAD_REQUEST', 'deckTags must be a JSON list of text, and slideTags a JSON object of slide number to a list of text.');
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const user = userOf(request);
    const summary = await processUpload(file.name, bytes, meta, user);
    if ((deckTags.length || Object.keys(slideTags).length) && summary.status === 'ready') {
      try {
        summary.tagsAdded = await addUploadTags(summary.id, deckTags, slideTags, user ?? 'uploader (not signed in)');
      } catch (e) {
        // The deck is stored either way; tags can be added from the slide page afterwards.
        console.error('Upload tags could not be saved', e);
        summary.tagsAdded = 0;
      }
    }
    if (summary.status === 'ready') {
      const job = () => embedDeckQuietly(summary.id);
      try {
        after(job);
      } catch {
        void job(); // outside a request (scripts and tests): just start it
      }
    }
    return ok(summary);
  } catch (e) {
    if (e instanceof ServiceError) return toResponse(e);
    console.error('Upload failed', e);
    return fail(500, 'UPLOAD_FAILED', 'The upload could not be processed. Please try again.', true);
  }
}

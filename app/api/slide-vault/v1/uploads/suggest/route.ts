import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { checkUploadFile, checkUploadSize } from '@/features/slide-vault/server/upload-guard';
import { asPerson } from '@/features/slide-vault/server/ai/usage';
import { userOf } from '@/features/slide-vault/server/principal';
import type { DeckFactsReader } from '@/features/slide-vault/server/ai/deck-facts';
import { configuredDeckFactsReader, configuredDeckTagsReader, suggestUploadFacts, suggestUploadTags } from '@/features/slide-vault/server/services/library-smart-search';

// POST /uploads/suggest (multipart/form-data): file + folderPath?, read? (docs/DECISIONS.md FD-23)
// Reads a .pptx and suggests its deck facts (client, year, category, Best of the Best, author,
// last editor, office), each with where it came from. Nothing is stored: the upload form fills in
// these values for the person to confirm, then POST /uploads stores the deck as usual.
// read=true lets the configured AI read the first slides for anything the file itself doesn't say.
// tags=true (with read=true) also has the AI read the slides for tags: up to 5 for the deck and 2 per slide,
// as { tags: { deck: [{ tag, from: 'ai', score }], slides: { '3': [...] } } } (FD-85). Left out when it can't.
export async function POST(request: Request) {
  const limited = await rateLimit(request, RATE_POLICIES.uploadSuggest);
  if (limited) return limited;
  // Too big is turned away before the upload is read (FD-93).
  const oversized = checkUploadSize(request);
  if (oversized) return oversized;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'BAD_REQUEST', 'Expected multipart/form-data.');
  }
  const file = form.get('file');
  if (!(file instanceof File)) return fail(400, 'BAD_REQUEST', 'Attach a .pptx file as "file".');
  // Named .pptx, within the size limit, and a real PowerPoint file inside (FD-93).
  const badFile = await checkUploadFile(file);
  if (badFile) return badFile;

  let reader: DeckFactsReader | null;
  try {
    reader = configuredDeckFactsReader();
  } catch (e) {
    console.error('Deck facts AI is misconfigured:', (e as Error).message);
    return fail(500, 'LIBRARY_NOT_READY', 'Suggestions are not set up correctly on the server.');
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const folderPath = (form.get('folderPath') as string | null)?.trim() || null;
    const read = form.get('read') === 'true';
    const facts = await asPerson(userOf(request), () => suggestUploadFacts(file.name, bytes, { reader, read, folderPath }));
    // Tags are a second, bigger AI job, only when asked for; the details above never wait on it failing.
    const tags = read && form.get('tags') === 'true' ? await asPerson(userOf(request), () => suggestUploadTags(file.name, bytes, { reader: configuredDeckTagsReader(), clientName: facts.suggestions.client?.value ?? null })) : null;
    return ok(tags && (tags.deck.length || Object.keys(tags.slides).length) ? { ...facts, tags } : facts);
  } catch (e) {
    console.error('Deck suggestions failed', e);
    return fail(422, 'UPLOAD_FAILED', 'This file could not be read. Check it opens in PowerPoint and try again.');
  }
}

// GET /uploads/suggest: { aiAvailable }, whether this server has an AI that can fill deck details, so the
// upload form only offers "Fill the rest with AI" when it can work (FD-23, FD-82). A misconfigured AI
// counts as not available here; POST still reports the setup error.
export async function GET(request: Request) {
  const limited = await rateLimit(request, RATE_POLICIES.search);
  if (limited) return limited;
  let aiAvailable = false;
  try {
    aiAvailable = configuredDeckFactsReader() !== null;
  } catch {
    aiAvailable = false;
  }
  return ok({ aiAvailable });
}

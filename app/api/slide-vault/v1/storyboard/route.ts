import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import type { StoryReader } from '@/features/slide-vault/server/ai/storyboard';
import { roleOf } from '@/features/slide-vault/server/ai/roles';
import { configuredStoryReader, storyboardLibrary } from '@/features/slide-vault/server/services/library-smart-search';

// POST /storyboard { situation, answers?, read?, role?, mode? } (docs/DECISIONS.md FD-22, FD-25, FD-31)
// A client situation (an RFP, notes or an outline) in; the story of slides out, part by part,
// with gaps where no slide proves a part yet and questions about what the story still needs.
// read: true lets the configured AI read the situation; otherwise the standard story order is used.
// A request that names an existing deck opens it as saved, or retells it (mode forces either).
export async function POST(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.smartSearch);
  if (limited) return limited;
  let body: { situation?: unknown; answers?: unknown; read?: unknown; role?: unknown; mode?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail(400, 'BAD_REQUEST', 'Send JSON with the client situation.');
  }
  const situation = typeof body.situation === 'string' ? body.situation.trim() : '';
  const answers = typeof body.answers === 'string' ? body.answers.trim() : '';
  if (situation.length < 20) return fail(400, 'BAD_REQUEST', 'Describe the client situation in a sentence or more.');
  if (situation.length > 8000 || answers.length > 2000) return fail(400, 'BAD_REQUEST', 'Keep the situation under 8,000 characters and the answers under 2,000.');

  // A provider that is named but misconfigured is a setup error, not a reason to quietly use another.
  let reader: StoryReader | null;
  try {
    reader = configuredStoryReader();
  } catch (e) {
    console.error('Storyboard AI is misconfigured:', (e as Error).message);
    return fail(500, 'LIBRARY_NOT_READY', 'The storyboard is not set up correctly on the server.');
  }

  try {
    const mode = body.mode === 'retrieve' || body.mode === 'reimagine' || body.mode === 'build' ? body.mode : undefined;
    return ok(await storyboardLibrary(situation, { reader, read: body.read === true, answers, role: roleOf(body.role), mode }));
  } catch (e) {
    console.error('Storyboard failed', e);
    return fail(503, 'LIBRARY_NOT_READY', 'The storyboard is unavailable right now. Please try again.', true);
  }
}

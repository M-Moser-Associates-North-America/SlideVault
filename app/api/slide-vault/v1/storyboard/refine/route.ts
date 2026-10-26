import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import type { StoryRefineRequest } from '@/features/slide-vault/contracts/dto';
import { STORY_ROLES, type StoryReader } from '@/features/slide-vault/server/ai/storyboard';
import { roleOf } from '@/features/slide-vault/server/ai/roles';
import { configuredStoryReader, refineStoryboard } from '@/features/slide-vault/server/services/library-smart-search';

// POST /storyboard/refine { situation, message, beats, pinned, role? } (docs/DECISIONS.md FD-43)
// One message in a conversation about the story on screen: the story continues instead of starting
// over. Only slide ids are taken from the request; every slide is read again from the library.
const MAX_BEATS = 60;
const MAX_SLIDES = 200;

export async function POST(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.smartSearch);
  if (limited) return limited;
  let body: Partial<StoryRefineRequest>;
  try {
    body = (await request.json()) as Partial<StoryRefineRequest>;
  } catch {
    return fail(400, 'BAD_REQUEST', 'Send JSON with the story and your message.');
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const situation = typeof body.situation === 'string' ? body.situation.trim() : '';
  if (message.length < 2 || message.length > 2000) return fail(400, 'BAD_REQUEST', 'Say what to change, in under 2,000 characters.');
  if (situation.length < 20 || situation.length > 8000) return fail(400, 'BAD_REQUEST', 'The story needs the client situation it was built from.');
  const beats = (Array.isArray(body.beats) ? body.beats : []).slice(0, MAX_BEATS).filter((b) => b && STORY_ROLES.includes(b.role) && Array.isArray(b.slideIds) && b.slideIds.every((id) => typeof id === 'string' && id.length <= 200));
  if (beats.reduce((n, b) => n + b.slideIds.length, 0) > MAX_SLIDES) return fail(400, 'BAD_REQUEST', 'That story is too long to change in one go.');
  const pinned = (Array.isArray(body.pinned) ? body.pinned : []).filter((id): id is string => typeof id === 'string' && id.length <= 200).slice(0, MAX_SLIDES);

  let reader: StoryReader | null;
  try {
    reader = configuredStoryReader();
  } catch (e) {
    console.error('Storyboard AI is misconfigured:', (e as Error).message);
    return fail(500, 'LIBRARY_NOT_READY', 'The storyboard is not set up correctly on the server.');
  }
  try {
    return ok(await refineStoryboard({ situation, message, beats, pinned, role: roleOf(body.role) }, { reader, read: true }));
  } catch (e) {
    console.error('Storyboard refine failed', e);
    return fail(503, 'LIBRARY_NOT_READY', "Couldn't change the story right now. Please try again.", true);
  }
}

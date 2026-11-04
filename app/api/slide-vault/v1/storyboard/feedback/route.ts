import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { userOf } from '@/features/slide-vault/server/principal';
import { cleanFeedback, mayLearnFrom, recordStoryFeedback } from '@/features/slide-vault/server/story-feedback';
import { activityOptedIn } from '@/features/slide-vault/server/user-data';

// POST /storyboard/feedback { role, slideId, verdict, topics, by? } (docs/DECISIONS.md FD-24, FD-25)
// "Was this helpful?": a slide is useful or not right for its part of the story, or nothing in a
// part fits. Saved without a name or the brief, and used to rank the next storyboard for a similar brief,
// only from people who turned on "learn from my activity" (FD-37): otherwise { saved: false, reason: 'opted-out' }.
export async function POST(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.storyFeedback);
  if (limited) return limited;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(400, 'BAD_REQUEST', 'Send JSON with the feedback.');
  }
  const feedback = cleanFeedback(raw);
  if (!feedback) return fail(400, 'BAD_REQUEST', 'Feedback needs a story part, a verdict, and a slide unless nothing fits.');
  try {
    if (!(await mayLearnFrom(userOf(request), activityOptedIn))) return ok({ saved: false, reason: 'opted-out' });
    await recordStoryFeedback(feedback);
    return ok({ saved: true });
  } catch (e) {
    console.error('Story feedback failed', e);
    return fail(503, 'LIBRARY_NOT_READY', "Couldn't save that right now. Please try again.", true);
  }
}

import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { userOf } from '@/features/slide-vault/server/principal';
import { cleanSearchFeedback, recordSearchFeedback, retractSearchFeedback } from '@/features/slide-vault/server/search-feedback';
import { mayLearnFrom } from '@/features/slide-vault/server/story-feedback';
import { activityOptedIn } from '@/features/slide-vault/server/user-data';

// POST /smart-search/feedback { query, slideId, verdict: 'useful' | 'not-relevant', by?, undo? } (docs/DECISIONS.md FD-59)
// Useful / Not relevant on a search result. Saved as the slide, the verdict and the search's words
// (never the search itself or a name), and used to rank the next search with those words, only from
// people who turned on "learn from my activity" (FD-37): otherwise { saved: false, reason: 'opted-out' }.
export async function POST(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.searchFeedback);
  if (limited) return limited;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(400, 'BAD_REQUEST', 'Send JSON with the feedback.');
  }
  const feedback = cleanSearchFeedback(raw);
  if (!feedback) return fail(400, 'BAD_REQUEST', 'Feedback needs the search, a slide and a verdict (useful or not-relevant).');
  try {
    if (!(await mayLearnFrom(userOf(request), activityOptedIn))) return ok({ saved: false, reason: 'opted-out' });
    if (feedback.undo) await retractSearchFeedback(feedback);
    else await recordSearchFeedback(feedback);
    return ok({ saved: true });
  } catch (e) {
    console.error('Search feedback failed', e);
    return fail(503, 'LIBRARY_NOT_READY', "Couldn't save that right now. Please try again.", true);
  }
}

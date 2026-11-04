import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { cleanSearchFeedback, recordSearchFeedback, retractSearchFeedback } from '@/features/slide-vault/server/search-feedback';

// POST /smart-search/feedback { query, slideId, verdict: 'useful' | 'not-relevant', by?, undo? } (docs/DECISIONS.md FD-59)
// Useful / Not relevant on a search result. Saved as the slide, the verdict, the search's words and the
// person's role (never the search itself or a name), and used to rank the next search with those words.
// On for everyone (FD-84): it is not personalization and stores nobody's identity, so it needs no opt-in.
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
    if (feedback.undo) await retractSearchFeedback(feedback);
    else await recordSearchFeedback(feedback);
    return ok({ saved: true });
  } catch (e) {
    console.error('Search feedback failed', e);
    return fail(503, 'LIBRARY_NOT_READY', "Couldn't save that right now. Please try again.", true);
  }
}

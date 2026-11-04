import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { sectionList } from '@/features/slide-vault/server/services/library-smart-search';

// GET /sections?kind=case-studies&hidden=include: every deck's section of one standard kind, so sections can be
// browsed without a search (docs/DECISIONS.md FD-80). Returns [{ dividerId, name, kind, slideCount, cover }].
// Open one with GET /sections/:dividerId. Read-only; hidden-in-source and internal-only covers are left out.
const KINDS = ['firm', 'case-studies', 'approach', 'team', 'fees', 'understanding', 'appendix'];

export async function GET(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.search);
  if (limited) return limited;
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? '';
  if (!KINDS.includes(kind)) return fail(400, 'BAD_REQUEST', `kind must be one of: ${KINDS.join(', ')}.`);
  try {
    return ok(await sectionList(kind, url.searchParams.get('hidden') === 'include'));
  } catch (e) {
    console.error('Section list failed', e);
    return fail(503, 'LIBRARY_NOT_READY', 'Sections could not be loaded right now. Please try again.', true);
  }
}

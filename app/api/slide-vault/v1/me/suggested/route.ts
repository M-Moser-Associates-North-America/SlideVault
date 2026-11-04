import { ok } from '@/features/slide-vault/server';
import { getRole, ROLE_MIN_PEOPLE, roleSuggestions } from '@/features/slide-vault/server/user-data';
import { withUser } from '@/features/slide-vault/server/user-route';

// GET /me/suggested: Suggested for you by the signed-in person's role (docs/DECISIONS.md FD-71).
// { role, minPeople, items: [{ slideId, people }] }, most-used first. The role is read on the server,
// never taken from the request. No role picked yet, or no slide used by minPeople people in it: items is empty.
export async function GET(request: Request) {
  return withUser(request, async (user) => {
    const role = await getRole(user);
    return ok({ role, minPeople: ROLE_MIN_PEOPLE, items: role ? await roleSuggestions(role, 24) : [] });
  });
}

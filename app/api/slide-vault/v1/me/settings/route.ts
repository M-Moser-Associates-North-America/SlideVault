import { fail, ok } from '@/features/slide-vault/server';
import { activityOptedIn, getRole, ROLES, setRole, type UserRole } from '@/features/slide-vault/server/user-data';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';

// The signed-in person's settings (docs/DECISIONS.md FD-71).
// GET /me/settings: { role, activityOptedIn }. role is 'business-developer', 'director', 'bd-support' or null.
export async function GET(request: Request) {
  return withUser(request, async (user) => ok({ role: await getRole(user), activityOptedIn: await activityOptedIn(user) }));
}

// PATCH /me/settings { role }: pick a role, or null to clear it. Activity opt-in stays on PATCH /me/activity.
export async function PATCH(request: Request) {
  return withUser(request, async (user) => {
    const body = await jsonBody(request);
    const role = body?.role;
    if (!body || !('role' in body) || (role !== null && !ROLES.includes(role as UserRole))) {
      return fail(400, 'BAD_REQUEST', `role must be one of ${ROLES.join(', ')}, or null.`);
    }
    await setRole(user, role as UserRole | null);
    return ok({ role });
  });
}

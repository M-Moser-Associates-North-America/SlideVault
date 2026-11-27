import type { ActivityKind, ActivityResponse } from '@/features/slide-vault/contracts/dto';
import { fail, ok } from '@/features/slide-vault/server';
import { jsonBody, withUser } from '@/features/slide-vault/server/user-route';
import { ACTIVITY_KINDS, ACTIVITY_RETENTION_DAYS, activityOptedIn, LIMITS, listActivity, recordActivity, setActivityOptIn } from '@/features/slide-vault/server/user-data';

// Opt-in activity for the signed-in person's own Top 10 and Suggested rows (FD-18). Off until they
// turn it on; kept 90 days; turning it off deletes it all.

// GET /me/activity: { optedIn, retentionDays, entries } (entries empty unless opted in)
export async function GET(request: Request) {
  return withUser(request, async (user) => {
    const optedIn = await activityOptedIn(user);
    const body: ActivityResponse = { optedIn, retentionDays: ACTIVITY_RETENTION_DAYS, entries: optedIn ? await listActivity(user) : [] };
    return ok(body);
  });
}

// POST /me/activity { kind, slideId?, label? }: record one event. Ignored (recorded: false) when not opted in.
export async function POST(request: Request) {
  return withUser(request, async (user) => {
    const body = await jsonBody(request);
    const kind = body?.kind as ActivityKind;
    if (!ACTIVITY_KINDS.includes(kind)) return fail(400, 'BAD_REQUEST', `kind must be one of: ${ACTIVITY_KINDS.join(', ')}.`);
    const slideId = body?.slideId === undefined || body?.slideId === null ? null : body.slideId;
    if (slideId !== null && (typeof slideId !== 'string' || !slideId || slideId.length > LIMITS.slideId)) return fail(400, 'BAD_REQUEST', 'slideId must be a slide id.');
    const label = typeof body?.label === 'string' ? body.label.slice(0, LIMITS.label) : '';
    return ok({ recorded: await recordActivity(user, kind, slideId, label) });
  });
}

// PATCH /me/activity { optedIn }: turn tracking on or off. Off deletes everything recorded.
export async function PATCH(request: Request) {
  return withUser(request, async (user) => {
    const body = await jsonBody(request);
    if (typeof body?.optedIn !== 'boolean') return fail(400, 'BAD_REQUEST', 'Send optedIn: true or false.');
    await setActivityOptIn(user, body.optedIn);
    return ok({ optedIn: body.optedIn, retentionDays: ACTIVITY_RETENTION_DAYS });
  });
}

/**
 * Calls for per-person data (docs/DECISIONS.md FD-18): saved slides, My decks and opt-in activity.
 * Every call names the signed-in person in the X-SlideVault-User header. That header is a
 * prototype stand-in for M Moser's sign-in (see server/principal.ts); a host that signs people in
 * itself can drop it.
 */
import type { ActivityEntry, ActivityResponse, ApiError, ApiOk, Draft } from '../contracts/dto';
import type { Transport } from './api';

export const USER_HEADER = 'X-SlideVault-User';

/** A failed per-person call. `status` 0 means the request never reached the server. */
export class UserDataError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(runtime: Transport, user: string, path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await runtime.request({ path, method, body, headers: { [USER_HEADER]: encodeURIComponent(user) } });
  } catch (e) {
    throw new UserDataError((e as Error).message || 'Network error', 0);
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiError | null;
    throw new UserDataError(err?.error.message ?? `Request failed (${res.status}).`, res.status);
  }
  return ((await res.json()) as ApiOk<T>).data;
}

export const userApi = {
  listSaved: (rt: Transport, user: string) => call<{ slideIds: string[] }>(rt, user, '/me/saved', 'GET').then((d) => d.slideIds),
  setSaved: (rt: Transport, user: string, slideId: string, saved: boolean) => call(rt, user, '/me/saved', 'PATCH', { slideId, saved }),
  listDrafts: (rt: Transport, user: string) => call<{ drafts: Draft[] }>(rt, user, '/me/drafts', 'GET').then((d) => d.drafts),
  createDraft: (rt: Transport, user: string, name: string, slideIds: string[]) =>
    call<{ draft: Draft }>(rt, user, '/me/drafts', 'POST', { name, slideIds }).then((d) => d.draft),
  deleteDraft: (rt: Transport, user: string, id: string) => call(rt, user, `/me/drafts/${encodeURIComponent(id)}`, 'DELETE'),
  getActivity: (rt: Transport, user: string) => call<ActivityResponse>(rt, user, '/me/activity', 'GET'),
  recordActivity: (rt: Transport, user: string, entry: Omit<ActivityEntry, 'at'>) =>
    call<{ recorded: boolean }>(rt, user, '/me/activity', 'POST', entry).then((d) => d.recorded),
  setActivityOptIn: (rt: Transport, user: string, optedIn: boolean) => call(rt, user, '/me/activity', 'PATCH', { optedIn }),
};

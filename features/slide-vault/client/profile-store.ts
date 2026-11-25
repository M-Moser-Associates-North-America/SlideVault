import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ActivityEntry, Draft as ServerDraft, SlideSummary } from '../contracts/dto';
import type { Transport } from './api';
import { userApi } from './user-api';

/**
 * Sign-in name, saved slides, My decks and activity for the signed-in person.
 *
 * With a `transport` (the app passes the runtime), saved slides and My decks live on the server, so
 * they follow the person to any device, and activity is recorded on the server only after the
 * person opts in (docs/DECISIONS.md FD-18). This browser's localStorage is kept as a fast copy so
 * screens render instantly, and as the fallback when the server has no database set up: then these
 * behave exactly as the earlier browser-only prototype did.
 *
 * Sign-in itself is still a stand-in (a name kept in this browser) until M Moser's login plugs in.
 */
export type { ActivityEntry };
/** A deck under My decks. `pending`: changed in this browser while the server could not be reached; sent when it next answers (until then it is not saved there). */
export type Draft = ServerDraft & { pending?: boolean };

// Higher than a simple recent-activity list would need, because Top 10 (views/shared.tsx TopTenRow)
// counts how often each slide shows up in this history to rank "what this profile uses most."
const ACTIVITY_LIMIT = 60;
const PROFILE_KEY = 'slidevault:profile';
const savedKey = (profile: string) => `slidevault:${profile}:saved`;
/* Saves and unsaves made in this browser that the server has not taken yet ({ slideId: saved }), kept apart from the copy of the server's list. */
const savedPendingKey = (profile: string) => `slidevault:${profile}:saved-pending`;
/* Set once this browser has met the server: from then on an empty server list means "nothing saved", never "move this browser's saves up". */
const savedMovedKey = (profile: string) => `slidevault:${profile}:saved-moved`;
const activityKey = (profile: string) => `slidevault:${profile}:activity`;
const draftsKey = (profile: string) => `slidevault:${profile}:drafts`;

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}
function write(key: string, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: memory only, for this visit */
  }
  listeners.forEach((l) => l());
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => e.key?.startsWith('slidevault:') && onChange();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Re-reads a localStorage key whenever any SlideVault key changes. */
function useStored(key: string | null): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
}

const warn = (what: string) => (e: unknown) => console.warn(`SlideVault: could not ${what} on the server.`, e);

export function useProfile() {
  const profile = useSyncExternalStore(subscribe, () => read(PROFILE_KEY), () => null);
  const signIn = useCallback((name: string) => write(PROFILE_KEY, name), []);
  const signOut = useCallback(() => write(PROFILE_KEY, null), []);
  return { profile, signIn, signOut };
}

function parseStrings(raw: string | null): string[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function parsePending(raw: string | null): Record<string, boolean> {
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter((e): e is [string, boolean] => typeof e[1] === 'boolean')) : {};
  } catch {
    return {};
  }
}

/**
 * Saved slides. On the server when it's available. This browser keeps a copy of the server's list to show at once, and, apart from it,
 * the saves and unsaves the server has not taken yet; those are sent when it answers. Saves made in this browser before there was a
 * server are moved up once, the first time it answers, and never again (so an old copy cannot bring back a slide unsaved on another device).
 */
export function useSaved(profile: string | null, transport?: Transport) {
  const key = profile ? savedKey(profile) : null;
  const raw = useStored(key);
  const ids = new Set(key ? parseStrings(raw) : []);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    if (!profile || !transport || !key) return;
    let live = true;
    userApi
      .listSaved(transport, profile)
      .then(async (serverIds) => {
        const next = new Set(serverIds);
        if (read(savedMovedKey(profile)) === null) {
          const localOnly = parseStrings(read(key)).filter((id) => !next.has(id));
          if (!serverIds.length && localOnly.length) {
            await Promise.all(localOnly.map((id) => userApi.setSaved(transport, profile, id, true)));
            localOnly.forEach((id) => next.add(id));
          }
          write(savedMovedKey(profile), '1');
        }
        const pending = parsePending(read(savedPendingKey(profile)));
        await Promise.all(Object.entries(pending).map(([id, saved]) => userApi.setSaved(transport, profile, id, saved)));
        for (const [id, saved] of Object.entries(pending)) {
          if (saved) next.add(id);
          else next.delete(id);
        }
        write(savedPendingKey(profile), null);
        if (!live) return;
        write(key, JSON.stringify([...next]));
        setOnline(true);
      })
      .catch(() => live && setOnline(false));
    return () => {
      live = false;
    };
  }, [profile, transport, key]);

  const toggle = useCallback(
    (slide: SlideSummary) => {
      if (!key || !profile) return;
      const current = new Set(parseStrings(read(key)));
      const saved = !current.has(slide.id);
      if (saved) current.add(slide.id);
      else current.delete(slide.id);
      write(key, JSON.stringify([...current]));
      /* Not sent yet (the server has not answered, or this send fails): kept as pending, and sent when the server next answers. */
      const pend = () => write(savedPendingKey(profile), JSON.stringify({ ...parsePending(read(savedPendingKey(profile))), [slide.id]: saved }));
      if (online && transport) {
        userApi.setSaved(transport, profile, slide.id, saved).catch((e) => {
          pend();
          warn('update a saved slide')(e);
        });
      } else if (transport) pend();
    },
    [key, profile, online, transport],
  );
  return { ids, toggle };
}

function parseActivity(raw: string | null): ActivityEntry[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? (value as ActivityEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * What this person opened, saved and downloaded, for their own Top 10 and Suggested rows.
 *
 * Opt-in only (Alina, Oct 20): nothing is recorded or used until the person opts in
 * (`setOptedIn(true)`); records are kept 90 days on the server; opting out deletes them. `optedIn`
 * is null while loading or when the server has no database, and then nothing is recorded either,
 * so the screens show the shared rows instead.
 */
export function useActivity(profile: string | null, transport?: Transport) {
  const key = profile ? activityKey(profile) : null;
  const raw = useStored(key);
  const [optedIn, setOptedInState] = useState<boolean | null>(null);
  const entries = key && optedIn === true ? parseActivity(raw) : [];
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!profile || !transport || !key) return;
    let live = true;
    userApi
      .getActivity(transport, profile)
      .then((res) => {
        if (!live) return;
        setOptedInState(res.optedIn);
        setRetentionDays(res.retentionDays);
        write(key, JSON.stringify(res.entries));
      })
      .catch(() => {
        if (!live) return;
        setOptedInState(null);
        write(key, null); // never rank from an older browser-only history
      });
    return () => {
      live = false;
    };
  }, [profile, transport, key, reload]);

  const log = useCallback(
    (kind: ActivityEntry['kind'], label: string, slideId?: string) => {
      // Only after this person has opted in on the server. Otherwise record nothing, anywhere.
      if (!key || !profile || !transport || optedIn !== true) return;
      const next = [{ kind, label, at: Date.now(), slideId }, ...parseActivity(read(key))].slice(0, ACTIVITY_LIMIT);
      write(key, JSON.stringify(next));
      userApi.recordActivity(transport, profile, { kind, label, slideId }).catch(warn('record activity'));
    },
    [key, profile, transport, optedIn],
  );

  const setOptedIn = useCallback(
    async (on: boolean) => {
      if (!profile || !transport || !key) return;
      await userApi.setActivityOptIn(transport, profile, on);
      if (!on) write(key, null);
      setReload((n) => n + 1);
    },
    [profile, transport, key],
  );

  return { entries, log, optedIn, setOptedIn, retentionDays };
}

function parseDrafts(raw: string | null): Draft[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? (value as Draft[]).filter((d) => d && typeof d.id === 'string' && Array.isArray(d.slideIds)) : [];
  } catch {
    return [];
  }
}

const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A draft the server has stored (its id came from the server); the others live only in this browser. */
export const isServerDraft = (id: string) => SERVER_ID.test(id);
const localId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A named set of slides kept under "My decks". On the server when it's available. */
export function useDrafts(profile: string | null, transport?: Transport) {
  const key = profile ? draftsKey(profile) : null;
  const raw = useStored(key);
  const drafts = key ? parseDrafts(raw) : [];
  const [online, setOnline] = useState(false);

  // On sign-in (not on every save): load from the server, moving up once any decks that were
  // saved only in this browser before the server kept them.
  useEffect(() => {
    if (!profile || !transport || !key) return;
    let live = true;
    userApi
      .listDrafts(transport, profile)
      .then(async (server) => {
        const localOnly = parseDrafts(read(key)).filter((d) => !SERVER_ID.test(d.id));
        if (localOnly.length) {
          for (const d of [...localOnly].reverse()) await userApi.createDraft(transport, profile, d.name, d.slideIds);
          server = await userApi.listDrafts(transport, profile);
        }
        /* Updates made while the server was out of reach go up now, so the server's older copy does not overwrite them. One that still cannot go up stays pending. */
        const stillPending: Draft[] = [];
        for (const d of parseDrafts(read(key)).filter((x) => x.pending && SERVER_ID.test(x.id))) {
          await userApi.updateDraft(transport, profile, d.id, d.name, d.slideIds).catch(() => stillPending.push(d));
        }
        if (parseDrafts(read(key)).some((x) => x.pending)) server = await userApi.listDrafts(transport, profile);
        const mine: Draft[] = server.map((d) => stillPending.find((p) => p.id === d.id) ?? d);
        if (!live) return;
        write(key, JSON.stringify(mine));
        setOnline(true);
      })
      .catch(() => live && setOnline(false));
    return () => {
      live = false;
    };
  }, [profile, transport, key]);

  /** Save a new deck. Resolves to its id (the server's, once it has one) so the draft deck can stay linked to it. */
  const save = useCallback(
    async (name: string, slideIds: string[]): Promise<string | null> => {
      if (!key || !profile) return null;
      const draft: Draft = { id: localId(), name, slideIds, savedAt: Date.now() };
      write(key, JSON.stringify([draft, ...parseDrafts(read(key))]));
      if (!online || !transport) return draft.id;
      try {
        const created = await userApi.createDraft(transport, profile, name, slideIds);
        write(key, JSON.stringify(parseDrafts(read(key)).map((d) => (d.id === draft.id ? created : d))));
        return created.id;
      } catch (e) {
        warn('save a deck')(e);
        return draft.id;
      }
    },
    [key, profile, online, transport],
  );
  /**
   * Update an existing deck in place: same id, new name and slides, moved to the top of the list (newest first).
   * On the server when it can be reached (a refusal throws, and nothing changes). Otherwise the change is kept in this
   * browser and marked pending, and goes up the next time the server answers. Resolves to the deck's id.
   */
  const replace = useCallback(
    async (id: string, name: string, slideIds: string[]): Promise<string> => {
      if (!key || !profile) return id;
      let draft: Draft = { id, name, slideIds, savedAt: Date.now() };
      if (online && transport && SERVER_ID.test(id)) draft = await userApi.updateDraft(transport, profile, id, name, slideIds);
      else if (transport && SERVER_ID.test(id)) draft.pending = true;
      write(key, JSON.stringify([draft, ...parseDrafts(read(key)).filter((d) => d.id !== id)]));
      return draft.id;
    },
    [key, profile, online, transport],
  );
  const remove = useCallback(
    (id: string) => {
      if (!key || !profile) return;
      write(key, JSON.stringify(parseDrafts(read(key)).filter((d) => d.id !== id)));
      if (online && transport && SERVER_ID.test(id)) userApi.deleteDraft(transport, profile, id).catch(warn('delete a deck'));
    },
    [key, profile, online, transport],
  );
  return { drafts, save, replace, remove };
}

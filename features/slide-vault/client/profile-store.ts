import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ActivityEntry, Draft, SlideSummary } from '../contracts/dto';
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
export type { ActivityEntry, Draft };

// Higher than a simple recent-activity list would need, because Top 10 (Views.tsx TopTenRow)
// counts how often each slide shows up in this history to rank "what this profile uses most."
const ACTIVITY_LIMIT = 60;
const PROFILE_KEY = 'slidevault:profile';
const savedKey = (profile: string) => `slidevault:${profile}:saved`;
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

/** Saved slides. On the server when it's available; ones saved only in this browser are moved up once. */
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
        const localOnly = parseStrings(read(key)).filter((id) => !serverIds.includes(id));
        if (!serverIds.length && localOnly.length) {
          await Promise.all(localOnly.map((id) => userApi.setSaved(transport, profile, id, true)));
          serverIds = localOnly;
        }
        if (!live) return;
        write(key, JSON.stringify(serverIds));
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
      if (online && transport) userApi.setSaved(transport, profile, slide.id, saved).catch(warn('update a saved slide'));
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
const localId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A named set of slides kept under "My decks". On the server when it's available. */
export function useDrafts(profile: string | null, transport?: Transport) {
  const key = profile ? draftsKey(profile) : null;
  const raw = useStored(key);
  const drafts = key ? parseDrafts(raw) : [];
  const [online, setOnline] = useState(false);

  useEffect(() => {
    if (!profile || !transport || !key) return;
    let live = true;
    userApi
      .listDrafts(transport, profile)
      .then(async (server) => {
        // Decks saved only in this browser (before the server kept them) are moved up once.
        const localOnly = parseDrafts(read(key)).filter((d) => !SERVER_ID.test(d.id));
        if (localOnly.length) {
          for (const d of [...localOnly].reverse()) await userApi.createDraft(transport, profile, d.name, d.slideIds);
          server = await userApi.listDrafts(transport, profile);
        }
        if (!live) return;
        write(key, JSON.stringify(server));
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
   * Re-save an existing deck with new contents. The server has no edit call, so the new version is saved
   * first and the old one removed after it, which means a failure never loses the older version. It then
   * sits at the top of the list (newest first). Resolves to the deck's id.
   */
  const replace = useCallback(
    async (id: string, name: string, slideIds: string[]): Promise<string> => {
      if (!key || !profile) return id;
      let finalId = id;
      let draft: Draft = { id, name, slideIds, savedAt: Date.now() };
      if (online && transport && SERVER_ID.test(id)) {
        draft = await userApi.createDraft(transport, profile, name, slideIds); // throws if the server says no; nothing changes then
        finalId = draft.id;
        await userApi.deleteDraft(transport, profile, id).catch(warn('remove the older version of a deck'));
      }
      write(key, JSON.stringify([draft, ...parseDrafts(read(key)).filter((d) => d.id !== id)]));
      return finalId;
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

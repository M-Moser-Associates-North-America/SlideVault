'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { listLibrary, searchSlides } from '../client/api';
import { useActivity, useDrafts, useProfile, useSaved, type ActivityEntry, type Draft } from '../client/profile-store';
import { useSelection } from '../client/selection-store';
import type { SlideSummary } from '../contracts/dto';
import type { SlideVaultRuntime } from '../contracts/runtime';
import { groupDecks, NO_FILTERS, type Deck, type Filters } from './library';
import { canSeeTier, simTier } from './simulation';

export type LibraryState = { status: 'loading' } | { status: 'ready'; slides: SlideSummary[]; decks: Deck[] } | { status: 'error'; message: string };

export type SearchState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; slides: SlideSummary[] } | { status: 'error'; message: string };

export type Toast = { id: number; message: string };

/** Local design prototype: fake sign-in, five demo profiles, no real accounts (not pushed). */
export const DEMO_PROFILES = ['Anna Wintour', 'Charlie Chocolate Factory', 'Grease Lightning', 'Charlie Moser', 'Two and a Half Men'];
export type { ActivityEntry, Draft };

/** First letter of the first and last word, e.g. "Two and a Half Men" -> "TM". */
export function profileInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words[0]?.[0] ?? '') + (words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '');
}

type Workspace = {
  runtime: SlideVaultRuntime;
  library: LibraryState;
  reloadLibrary: () => void;
  query: string;
  setQuery: (q: string) => void;
  retrySearch: () => void;
  search: SearchState;
  filters: Filters;
  patchFilters: (patch: Partial<Filters>) => void;
  clearFilters: () => void;
  selection: SlideSummary[];
  updateSelection: (fn: (cur: SlideSummary[]) => SlideSummary[]) => void;
  /** Slides in the cart that are unticked, so left out of the download */
  excluded: ReadonlySet<string>;
  setIncluded: (id: string, included: boolean) => void;
  cartMin: boolean;
  setCartMin: (min: boolean) => void;
  toasts: Toast[];
  toast: (message: string) => void;
  dismissToast: (id: number) => void;
  announcement: string;
  announce: (message: string) => void;
  /** Large preview over the page; `list` is what the arrows step through */
  preview: { list: SlideSummary[]; index: number } | null;
  openPreview: (list: SlideSummary[], index: number) => void;
  closePreview: () => void;
  movePreview: (delta: -1 | 1) => void;
  /** Slides waiting in the download dialog, or null when it is closed */
  downloadSlides: SlideSummary[] | null;
  openDownload: (slides: SlideSummary[]) => void;
  closeDownload: () => void;
  /** The slide whose "Also in other decks" list is open, or null when it is closed */
  alsoFor: SlideSummary | null;
  openAlso: (slide: SlideSummary) => void;
  closeAlso: () => void;
  /** Local design prototype: fake sign-in (docs/DECISIONS.md FD-01 is still the real default --
      this is a mockup for the pitch, not a real auth system). */
  profile: string | null;
  authStage: 'login' | 'pick';
  submitLogin: () => void;
  pickProfile: (name: string) => void;
  signOut: () => void;
  savedIds: ReadonlySet<string>;
  toggleSaved: (slide: SlideSummary) => void;
  activity: ActivityEntry[];
  logActivity: (kind: ActivityEntry['kind'], label: string, slideId?: string) => void;
  /** Working drafts: named sets of slides saved from the draft deck, kept under My decks. */
  drafts: Draft[];
  saveDraft: (name: string, slides: SlideSummary[]) => void;
  deleteDraft: (id: string) => void;
  /** Replace the draft deck with a saved draft's slides. Returns how many slides were found. */
  loadDraft: (draft: Draft) => number;
};

const Ctx = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return v;
}

const SEARCH_DELAY_MS = 250;
const TOAST_MS = 5000;

export function WorkspaceProvider({ runtime, children }: { runtime: SlideVaultRuntime; children: ReactNode }) {
  const { request, onSessionExpired } = runtime;
  const transport = useMemo(() => ({ request, onSessionExpired }), [request, onSessionExpired]);

  /* The whole library: one request, then filtered and grouped in the browser. */
  const [rawLibrary, setLibrary] = useState<LibraryState>({
    status: 'loading',
  });
  const [libraryTry, setLibraryTry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    listLibrary(transport, controller.signal)
      .then((slides) => setLibrary({ status: 'ready', slides, decks: groupDecks(slides) }))
      .catch((e: Error) => e.name !== 'AbortError' && setLibrary({ status: 'error', message: e.message }));
    return () => controller.abort();
  }, [transport, libraryTry]);
  const reloadLibrary = useCallback(() => {
    setLibrary({ status: 'loading' });
    setLibraryTry((n) => n + 1);
  }, []);

  /* Search text lives in memory, not in the URL (docs/INTEGRATION_CONTRACT.md). */
  const [query, setQueryRaw] = useState('');
  const [rawSearch, setSearch] = useState<SearchState>({ status: 'idle' });
  const [searchTry, setSearchTry] = useState(0);
  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setSearch(q.trim() ? { status: 'loading' } : { status: 'idle' });
  }, []);
  const retrySearch = useCallback(() => {
    setSearch({ status: 'loading' });
    setSearchTry((n) => n + 1);
  }, []);
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchSlides(transport, q, controller.signal)
        .then((slides) => setSearch({ status: 'ready', slides }))
        .catch((e: Error) => e.name !== 'AbortError' && setSearch({ status: 'error', message: e.message }));
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [transport, query, searchTry]);

  /* Simulated approval tiers (FD-14): what the signed-in access may see. The server has no tiers yet. */
  const caps = runtime.capabilities;
  const library = useMemo<LibraryState>(() => {
    if (rawLibrary.status !== 'ready') return rawLibrary;
    const slides = rawLibrary.slides.filter((s) => canSeeTier(simTier(s), caps));
    return { status: 'ready', slides, decks: groupDecks(slides) };
  }, [rawLibrary, caps]);
  const search = useMemo<SearchState>(
    () =>
      rawSearch.status === 'ready'
        ? {
            status: 'ready',
            slides: rawSearch.slides.filter((s) => canSeeTier(simTier(s), caps)),
          }
        : rawSearch,
    [rawSearch, caps],
  );

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const patchFilters = useCallback((patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch })), []);
  const clearFilters = useCallback(() => setFilters(NO_FILTERS), []);

  /* The cart is the saved selection; "excluded" is only for this visit. */
  const [selection, updateSelection] = useSelection(runtime.sessionScopeKey);
  const [excludedList, setExcludedList] = useState<string[]>([]);
  const excluded = useMemo(() => new Set(excludedList), [excludedList]);
  const setIncluded = useCallback(
    (id: string, included: boolean) => setExcludedList((cur) => (included ? cur.filter((x) => x !== id) : cur.includes(id) ? cur : [...cur, id])),
    [],
  );

  /* Collapsed by default; opens by itself the first time something is added. */
  const [cartMin, setCartMin] = useState(true);
  const prevCount = useRef(selection.length);
  useEffect(() => {
    if (prevCount.current === 0 && selection.length > 0) setCartMin(false);
    prevCount.current = selection.length;
  }, [selection.length]);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToast = useRef(1);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string) => {
      const id = nextToast.current++;
      setToasts((t) => [...t, { id, message }]);
      setTimeout(() => dismissToast(id), TOAST_MS);
    },
    [dismissToast],
  );

  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((message: string) => {
    setAnnouncement('');
    setTimeout(() => setAnnouncement(message), 40);
  }, []);

  const [preview, setPreview] = useState<{
    list: SlideSummary[];
    index: number;
  } | null>(null);
  const openPreview = useCallback((list: SlideSummary[], index: number) => setPreview({ list, index }), []);
  const closePreview = useCallback(() => setPreview(null), []);
  const movePreview = useCallback((delta: -1 | 1) => setPreview((p) => (p && p.list.length > 1 ? { ...p, index: (p.index + delta + p.list.length) % p.list.length } : p)), []);

  const [downloadSlides, setDownloadSlides] = useState<SlideSummary[] | null>(null);
  const openDownload = useCallback((slides: SlideSummary[]) => setDownloadSlides(slides), []);
  const closeDownload = useCallback(() => setDownloadSlides(null), []);

  const [alsoFor, setAlsoFor] = useState<SlideSummary | null>(null);
  const openAlso = useCallback((slide: SlideSummary) => setAlsoFor(slide), []);
  const closeAlso = useCallback(() => setAlsoFor(null), []);

  /* Fake sign-in: no server, no password check. `profile` persists across reloads so a demo
     doesn't have to log in again; clearing localStorage (as the test suite does) logs out. */
  const { profile, signIn, signOut: signOutStore } = useProfile();
  const [authStage, setAuthStage] = useState<'login' | 'pick'>('login');
  const submitLogin = useCallback(() => setAuthStage('pick'), []);
  const pickProfile = useCallback(
    (name: string) => {
      signIn(name);
      setAuthStage('login');
    },
    [signIn],
  );
  /* "Switch profile" (on the profile page) skips straight to the picker; signing out fully
     (not currently reachable in the UI, kept for completeness) goes back to the login form. */
  const signOut = useCallback(() => {
    signOutStore();
    setAuthStage('pick');
  }, [signOutStore]);

  /* Saved slides and recent activity, scoped per demo profile so switching profiles actually
     shows a different person's stuff. */
  const { ids: savedIds, toggle: toggleSaved } = useSaved(profile);
  const { entries: activity, log: logActivity } = useActivity(profile);
  const { drafts, save: saveDraftStore, remove: deleteDraft } = useDrafts(profile);
  const saveDraft = useCallback((name: string, slides: SlideSummary[]) => saveDraftStore(name, slides.map((s) => s.id)), [saveDraftStore]);
  const loadDraft = useCallback(
    (draft: Draft) => {
      const all = library.status === 'ready' ? library.slides : [];
      const found = draft.slideIds.map((id) => all.find((s) => s.id === id)).filter((s): s is SlideSummary => s !== undefined);
      updateSelection(() => found);
      return found.length;
    },
    [library, updateSelection],
  );

  const value: Workspace = {
    runtime,
    library,
    reloadLibrary,
    query,
    setQuery,
    retrySearch,
    search,
    filters,
    patchFilters,
    clearFilters,
    selection,
    updateSelection,
    excluded,
    setIncluded,
    cartMin,
    setCartMin,
    toasts,
    toast,
    dismissToast,
    announcement,
    announce,
    preview,
    openPreview,
    closePreview,
    movePreview,
    downloadSlides,
    openDownload,
    closeDownload,
    alsoFor,
    openAlso,
    closeAlso,
    profile,
    authStage,
    submitLogin,
    pickProfile,
    signOut,
    savedIds,
    toggleSaved,
    activity,
    logActivity,
    drafts,
    saveDraft,
    deleteDraft,
    loadDraft,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

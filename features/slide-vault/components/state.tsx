'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { listLibrary, searchSlides } from '../client/api';
import { useSelection } from '../client/selection-store';
import type { SlideSummary } from '../contracts/dto';
import type { SlideVaultRuntime } from '../contracts/runtime';
import { groupDecks, NO_FILTERS, type Deck, type Filters } from './library';

export type LibraryState =
  | { status: 'loading' }
  | { status: 'ready'; slides: SlideSummary[]; decks: Deck[] }
  | { status: 'error'; message: string };

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; slides: SlideSummary[] }
  | { status: 'error'; message: string };

export type Toast = { id: number; message: string };

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
  const [library, setLibrary] = useState<LibraryState>({ status: 'loading' });
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
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
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

  const [preview, setPreview] = useState<{ list: SlideSummary[]; index: number } | null>(null);
  const openPreview = useCallback((list: SlideSummary[], index: number) => setPreview({ list, index }), []);
  const closePreview = useCallback(() => setPreview(null), []);
  const movePreview = useCallback(
    (delta: -1 | 1) => setPreview((p) => (p && p.list.length > 1 ? { ...p, index: (p.index + delta + p.list.length) % p.list.length } : p)),
    [],
  );

  const [downloadSlides, setDownloadSlides] = useState<SlideSummary[] | null>(null);
  const openDownload = useCallback((slides: SlideSummary[]) => setDownloadSlides(slides), []);
  const closeDownload = useCallback(() => setDownloadSlides(null), []);

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
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { archiveDeck as archiveDeckApi, fetchAiAvailable, createPack as createPackApi, deletePack as deletePackApi, getMySettings, listLibrary, renamePack as renamePackApi, renameSlide as renameSlideApi, setMyRole, setPackStatus as setPackStatusApi, smartSearch } from '../client/api';
import { withDemoDetails } from '../client/demo-details';
import { useLocalPacks } from '../client/pack-store';
import { buildPacks, NO_PACKS, type Pack, type PacksIndex } from '../client/packs';
import { useActivity, useDrafts, useProfile, useSaved, type ActivityEntry, type Draft } from '../client/profile-store';
import { adoptServerRole, currentStoryRole, onRoleChange } from '../client/role-store';
import { demoTagsOn } from '../client/tag-store';
import { useSelection } from '../client/selection-store';
import { tourIsOpen } from '../client/tour-store';
import type { SlideSummary, SmartSearchResult, TitleEdit } from '../contracts/dto';
import type { RuntimeRequest, SlideVaultRuntime } from '../contracts/runtime';
import { USER_HEADER } from '../client/user-api';
import { groupDecks, NO_FILTERS, plural, type Deck, type Filters } from './library';

/* Pretend renames (?demotags=1) survive the library reloading, so the demo behaves like a server that kept the name. */
const demoTitles = new Map<string, string>();
const titleEdits = new Map<string, TitleEdit>();
const DEMO_NAMES = ['Priya Shah', 'Sam Lee', 'Maya Chen'];
/** Who last set this slide's title: this session's rename, else what the server says, else (demo) a pretend one, else the system. */
export function titleEditOf(slideId: string, fromServer?: TitleEdit): TitleEdit {
  const mine = titleEdits.get(slideId);
  if (mine) return mine;
  if (fromServer) return fromServer;
  if (demoTagsOn()) {
    const h = [...slideId].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 3);
    if (h % 5 === 0) return { kind: 'ai', at: new Date(Date.UTC(2026, 9, 27)).toISOString() };
    if (h % 3 === 0) return { kind: 'person', by: DEMO_NAMES[h % DEMO_NAMES.length], at: new Date(Date.UTC(2026, 9, 22 + (h % 7))).toISOString() };
  }
  return { kind: 'system' };
}
const withDemoTitle = (s: SlideSummary): SlideSummary => (demoTitles.has(s.id) ? { ...s, title: demoTitles.get(s.id)! } : s);

/** One section result the preview can move to: its cover and name, and its slides once they are known (the preview asks for them when it needs them). */
export type SectionRef = { key: string; name: string; dividerId: string; slides: SlideSummary[] | null };

export type LibraryState = { status: 'loading' } | { status: 'ready'; slides: SlideSummary[]; decks: Deck[] } | { status: 'error'; message: string };

export type SearchState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; result: SmartSearchResult } | { status: 'error'; message: string };

export type Toast = { id: number; message: string; action?: { label: string; run: () => void } };

export type ArchiveDialogState = { deck: { id: string; title: string; slideCount: number }; restore: boolean; /** Opened from a slide's page: say so, and leave the page when the deck is gone */ fromSlide?: string };

/** `section` is set for kind 'section': adding a whole deck section whose slides belong to packs that reach outside it (FD-80). `pack` is the first of those packs. */
export type PackDialogState = { kind: 'add' | 'remove' | 'ungroup' | 'section'; pack: Pack; slide?: SlideSummary; section?: { name: string; slides: SlideSummary[]; packs: Pack[] } };

/** Placeholder sign-in: one demo profile until M Moser's login plugs in (FD-01). */
export const DEMO_PROFILE = 'Person A';
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
  /** Slides hidden in their original deck are left out of search and the library unless this is on (FD-27) */
  includeHidden: boolean;
  setIncludeHidden: (on: boolean) => void;
  /** The deck sections the search asked for, read by the server (FD-80); none once the person turns the Section filter off for this search */
  sectionsFromSearch: string[];
  /** The one section the search asked for, treated as the Section filter being on, unless a section is picked by hand */
  autoSection: string | null;
  /** Turn the section the search asked for off, for this search only */
  dismissAutoSection: () => void;
  /** The server has an AI reader, so "Deeper AI search" is offered at all (FD-79) */
  aiAvailable: boolean;
  /** "Deeper AI search" is ticked: submitted sentences and questions are read by the AI. Off until the person turns it on; remembered on this device. */
  deeperAi: boolean;
  setDeeperAi: (on: boolean) => void;
  /** The person chose the AI for this short search too: re-reads it with the AI (FD-79) */
  askAiAnyway: () => void;
  /** Archived decks are left out of every list unless this is on (FD-50) */
  includeArchived: boolean;
  setIncludeArchived: (on: boolean) => void;
  /** The question asked before archiving or restoring a deck */
  archiveDialog: ArchiveDialogState | null;
  openArchiveDialog: (d: ArchiveDialogState) => void;
  closeArchiveDialog: () => void;
  /** Archive or restore a deck. false = the server could not (a message has been shown). */
  archiveDeck: (deck: { id: string; title: string }, archived: boolean) => Promise<boolean>;
  /** Rename a slide for everyone (FD-73). Throws with a message to show when the server can't. */
  renameSlide: (slideId: string, title: string) => Promise<void>;
  /** Slides that go together (FD-38): every pack, and which one a slide is in */
  packs: PacksIndex;
  /** The question asked before adding or removing one slide of a pack, or before ungrouping */
  packDialog: PackDialogState | null;
  openPackDialog: (d: PackDialogState) => void;
  closePackDialog: () => void;
  /** Add every slide of the pack that is not in the draft deck yet, in the pack's order */
  addPackToDraft: (pack: Pack) => void;
  removePackFromDraft: (pack: Pack) => void;
  /** Group slides (in the order given) into a pack. 'saved' = kept by the server, 'browser' = only in this browser for now */
  makePack: (slideIds: string[], label: string | null) => Promise<'saved' | 'browser'>;
  ungroupPack: (pack: Pack) => Promise<'saved' | 'browser'>;
  renamePack: (pack: Pack, label: string | null) => Promise<void>;
  /** Confirm a suggested pack, or move a confirmed one back to suggested. Anyone signed in can (MVP). */
  setPackStatus: (pack: Pack, status: 'suggested' | 'confirmed') => Promise<void>;
  query: string;
  setQuery: (q: string) => void;
  /** Enter or the Search button: lets the AI read the current request (once; repeats are cached) */
  submitSearch: () => void;
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
  draftTitle: string;
  setDraftTitle: (title: string) => void;
  /** Put slides from several decks into one .pptx instead of a zip (off until chosen). Only matters when the slides come from more than one deck. */
  combine: boolean;
  setCombine: (on: boolean) => void;
  toasts: Toast[];
  toast: (message: string, action?: { label: string; run: () => void }) => void;
  dismissToast: (id: number) => void;
  announcement: string;
  announce: (message: string) => void;
  /** Large preview over the page; `list` is what the arrows step through */
  preview: { list: SlideSummary[]; index: number; section?: string; sections?: SectionRef[]; sectionAt?: number } | null;
  /** `section` names the deck section when the list is one whole section: the preview then counts "1 of 8 in section" and outlines those slides in the film strip. `sections` are all the section results it came from (this one is `sectionAt`), so Previous / Next result move between them (FD-80) */
  openPreview: (list: SlideSummary[], index: number, opts?: { section?: string; sections?: SectionRef[]; sectionAt?: number }) => void;
  closePreview: () => void;
  movePreview: (delta: -1 | 1) => void;
  /** Jump to one place in the preview's list */
  goToPreview: (index: number) => void;
  /** Slides waiting in the download dialog, or null when it is closed */
  downloadSlides: SlideSummary[] | null;
  openDownload: (slides: SlideSummary[]) => void;
  closeDownload: () => void;
  /** The slide whose "Also in other decks" list is open, or null when it is closed */
  alsoFor: SlideSummary | null;
  openAlso: (slide: SlideSummary) => void;
  closeAlso: () => void;
  /** Placeholder sign-in (FD-01): who is signed in until M Moser's login replaces it. */
  profile: string | null;
  submitLogin: () => void;
  signOut: () => void;
  savedIds: ReadonlySet<string>;
  toggleSaved: (slide: SlideSummary) => void;
  activity: ActivityEntry[];
  logActivity: (kind: ActivityEntry['kind'], label: string, slideId?: string) => void;
  /** Whether this person has turned on activity tracking (FD-18); null while loading or without the server */
  activityOptedIn: boolean | null;
  /** Turn tracking on or off. Off deletes everything recorded for this person. */
  setActivityOptIn: (on: boolean) => Promise<void>;
  /** How long recorded activity is kept, as the server reports it; null until it has answered */
  activityRetentionDays: number | null;
  /** Working drafts: named sets of slides saved from the draft deck, kept under My decks. */
  drafts: Draft[];
  /** Save the draft deck as a new deck in My decks. Resolves to the saved deck's id. */
  saveDraft: (name: string, slides: SlideSummary[]) => Promise<string | null>;
  /** Re-save an older deck with the draft deck's slides (and a name). */
  replaceDraft: (id: string, name: string, slides: SlideSummary[]) => Promise<void>;
  /** The saved deck the draft deck came from (opened from My decks, or saved from here), while the draft deck has slides in it. */
  draftOrigin: Draft | null;
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
/** Where "Deeper AI search" being on is remembered, on this device only (FD-79). */
const DEEPER_AI_KEY = 'slidevault:deeper-ai';
const TOAST_MS = 5000;

/** A pretend-data switch turned on by ?name=1 in the address and kept for the browser tab. Off unless asked for. */
function useDemoFlag(name: string): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => {
      try {
        if (new RegExp(`[?&]${name}\\b`).test(window.location.search)) sessionStorage.setItem(`slidevault:${name}`, '1');
        return sessionStorage.getItem(`slidevault:${name}`) === '1';
      } catch {
        return false;
      }
    },
    () => false,
  );
}

export function WorkspaceProvider({ runtime: hostRuntime, children }: { runtime: SlideVaultRuntime; children: ReactNode }) {
  /* Every call to the server names the signed-in person (FD-18), not only the /me ones: archiving,
     packs, tags, uploads and feedback record who did it, and the server refuses archive, pack and tag
     changes without a name ("Sign in to archive", 31 Oct). The rest of the host's runtime is kept as is. */
  const signedInRef = useRef<string | null>(null);
  const runtime = useMemo<SlideVaultRuntime>(() => {
    const signed = Object.create(hostRuntime) as SlideVaultRuntime;
    signed.request = (input: RuntimeRequest) => {
      const user = signedInRef.current;
      return hostRuntime.request(user ? { ...input, headers: { [USER_HEADER]: encodeURIComponent(user), ...input.headers } } : input);
    };
    return signed;
  }, [hostRuntime]);
  const { request, onSessionExpired } = runtime;
  const transport = useMemo(() => ({ request, onSessionExpired }), [request, onSessionExpired]);

  /* The whole library: one request, then filtered and grouped in the browser. */
  const [library, setLibrary] = useState<LibraryState>({
    status: 'loading',
  });
  const [libraryTry, setLibraryTry] = useState(0);
  const demoDetails = useDemoFlag('demodetails');
  /* Off by default: slides hidden in the original deck stay out. The switch beside the search bar turns them on. */
  const [includeHidden, setIncludeHidden] = useState(false);
  /* "Deeper AI search" (FD-79): off until the person turns it on, then remembered on this device. */
  const [aiAvailable, setAiAvailable] = useState(false);
  const [deeperAi, setDeeperAiRaw] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(DEEPER_AI_KEY) === 'on') setDeeperAiRaw(true);
    } catch {
      /* storage blocked: it just starts off each visit */
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetchAiAvailable(transport, controller.signal).then((on) => !controller.signal.aborted && setAiAvailable(on));
    return () => controller.abort();
  }, [transport]);
  /* Archived decks stay out unless the switch in the filters' More panel is on (FD-50). */
  const [includeArchived, setIncludeArchived] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    listLibrary(transport, controller.signal, { includeHidden, includeArchived })
      .then((raw) => {
        const slides = (demoDetails ? raw.map(withDemoDetails) : raw).map(withDemoTitle);
        setLibrary({ status: 'ready', slides, decks: groupDecks(slides) });
      })
      .catch((e: Error) => e.name !== 'AbortError' && setLibrary({ status: 'error', message: e.message }));
    return () => controller.abort();
  }, [transport, libraryTry, includeHidden, includeArchived, demoDetails]);
  const reloadLibrary = useCallback(() => {
    setLibrary({ status: 'loading' });
    setLibraryTry((n) => n + 1);
  }, []);

  /* Search text lives in memory, not in the URL (docs/INTEGRATION_CONTRACT.md). */
  const [query, setQueryRaw] = useState('');
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const [searchTry, setSearchTry] = useState(0);
  /* The request the person submitted. Only that one may be read by the AI; typing uses the rules. */
  const [submitted, setSubmitted] = useState('');
  const submitSearch = useCallback(() => {
    setSubmitted(query.trim());
    setSearch({ status: 'loading' });
    setSearchTry((n) => n + 1);
  }, [query]);
  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setSearch(q.trim() ? { status: 'loading' } : { status: 'idle' });
  }, []);
  /* Turning it on with words already typed reads them now; turning it off shows the plain results again. */
  const setDeeperAi = useCallback(
    (on: boolean) => {
      setDeeperAiRaw(on);
      try {
        localStorage.setItem(DEEPER_AI_KEY, on ? 'on' : 'off');
      } catch {
        /* not remembered */
      }
      if (query.trim()) {
        if (on) setSubmitted(query.trim());
        setSearch({ status: 'loading' });
        setSearchTry((n) => n + 1);
      }
    },
    [query],
  );
  const aiOn = aiAvailable && deeperAi;
  /* A short search is left to the rules unless the person says "use AI anyway", and only for that search. */
  const [forceAiFor, setForceAiFor] = useState('');
  const askAiAnyway = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    setForceAiFor(q);
    setSubmitted(q);
    setSearch({ status: 'loading' });
    setSearchTry((n) => n + 1);
  }, [query]);
  const retrySearch = useCallback(() => {
    setSearch({ status: 'loading' });
    setSearchTry((n) => n + 1);
  }, []);
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      smartSearch(transport, q, q === submitted, controller.signal, { includeHidden, role: currentStoryRole(), ai: aiOn ? undefined : false, forceAi: aiOn && forceAiFor === q })
        .then((result) => {
          if (typeof result.aiAvailable === 'boolean') setAiAvailable(result.aiAvailable);
          setSearch({ status: 'ready', result: demoTitles.size ? { ...result, items: result.items.map((i) => ({ ...i, slide: withDemoTitle(i.slide) })) } : result });
        })
        .catch((e: Error) => e.name !== 'AbortError' && setSearch({ status: 'error', message: e.message }));
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [transport, query, submitted, searchTry, includeHidden, aiOn, forceAiFor]);

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  /* "bank case studies section" turns the Section filter on by itself, the way "2024" lights Year (FD-80). Taking it off
     lasts for that search only, so the next search that asks for a section turns it on again. */
  const [sectionOffFor, setSectionOffFor] = useState('');
  const sectionsFromSearch = useMemo(() => {
    if (!query.trim() || sectionOffFor === query.trim() || search.status !== 'ready') return [];
    const { sections = [], items } = search.result;
    // Only a section this search has slides in: an automatic filter must never hide every result (decks with no sections found).
    return sections.filter((kind) => items.some((i) => i.slide.section?.kind === kind));
  }, [query, sectionOffFor, search]);
  const autoSection = filters.section.length === 0 && sectionsFromSearch.length === 1 ? sectionsFromSearch[0] : null;
  const dismissAutoSection = useCallback(() => setSectionOffFor(query.trim()), [query]);
  const patchFilters = useCallback((patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch })), []);
  const clearFilters = useCallback(() => setFilters(NO_FILTERS), []);

  /* The cart is the saved selection; "excluded" is only for this visit. */
  const [selection, updateSelectionRaw] = useSelection(runtime.sessionScopeKey);
  /* Open from the start so a first-time visitor sees where slides collect. It only closes when the
     person closes it, and only opens again when they open it. The one exception: the first slide added
     to an empty draft deck opens it, so they see it land; later additions leave it as it is. */
  const [cartMin, setCartMin] = useState(false);
  const updateSelection = useCallback(
    (fn: (cur: SlideSummary[]) => SlideSummary[]) =>
      updateSelectionRaw((cur) => {
        const next = fn(cur);
        if (cur.length === 0 && next.length > 0 && !tourIsOpen()) setCartMin(false);
        return next;
      }),
    [updateSelectionRaw],
  );
  const [excludedList, setExcludedList] = useState<string[]>([]);
  const excluded = useMemo(() => new Set(excludedList), [excludedList]);
  const setIncluded = useCallback(
    (id: string, included: boolean) => setExcludedList((cur) => (included ? cur.filter((x) => x !== id) : cur.includes(id) ? cur : [...cur, id])),
    [],
  );

  /* The draft deck's name, edited at the top of the panel; it also fills the Save as draft box. */
  const [draftTitle, setDraftTitle] = useState('');
  /* On by default, every time: it turns back on when the download pop-up closes and when the draft deck is emptied. */
  const [combine, setCombine] = useState(true);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToast = useRef(1);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string, action?: { label: string; run: () => void }) => {
      const id = nextToast.current++;
      setToasts((t) => [...t, { id, message, action }]);
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
    section?: string;
    sections?: SectionRef[];
    sectionAt?: number;
  } | null>(null);
  const openPreview = useCallback(
    (list: SlideSummary[], index: number, opts?: { section?: string; sections?: SectionRef[]; sectionAt?: number }) =>
      setPreview({ list, index, section: opts?.section, sections: opts?.sections, sectionAt: opts?.sectionAt }),
    [],
  );
  const goToPreview = useCallback((index: number) => setPreview((p) => (p && index >= 0 && index < p.list.length ? { ...p, index } : p)), []);
  const closePreview = useCallback(() => setPreview(null), []);
  const movePreview = useCallback((delta: -1 | 1) => setPreview((p) => (p && p.list.length > 1 ? { ...p, index: (p.index + delta + p.list.length) % p.list.length } : p)), []);

  const [downloadSlides, setDownloadSlides] = useState<SlideSummary[] | null>(null);
  const openDownload = useCallback((slides: SlideSummary[]) => setDownloadSlides(slides), []);
  const closeDownload = useCallback(() => {
    setDownloadSlides(null);
    setCombine(true);
  }, []);

  const [alsoFor, setAlsoFor] = useState<SlideSummary | null>(null);
  const openAlso = useCallback((slide: SlideSummary) => setAlsoFor(slide), []);
  const closeAlso = useCallback(() => setAlsoFor(null), []);

  /* Fake sign-in (see below): the profile is needed earlier, for who confirmed a pack. */
  const { profile, signIn, signOut: signOutStore } = useProfile();
  useEffect(() => {
    signedInRef.current = profile;
  }, [profile]);

  /* The role is kept on the server too (FD-71), so Suggested for you can count by role. A change here saves
     it there; signing in brings the server's role into a browser that has none. Quiet when there's no database. */
  useEffect(() => {
    onRoleChange((role) => void setMyRole(transport, role).catch(() => undefined));
    return () => onRoleChange(null);
  }, [transport]);
  useEffect(() => {
    if (!profile) return;
    let live = true;
    getMySettings(transport)
      .then((s) => live && s && adoptServerRole(profile, s.role))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [profile, transport]);

  /* Packs (FD-38): slides that go together. They come from the server on each slide, plus any made in this
     browser while the server cannot store them. ?demopacks=1 in the address shows pretend ones. */
  const [localPacks, updateLocalPacks] = useLocalPacks(runtime.sessionScopeKey);
  const demoPacks = useDemoFlag('demopacks');
  const packs = useMemo(() => (library.status === 'ready' ? buildPacks(library.slides, localPacks, demoPacks) : NO_PACKS), [library, localPacks, demoPacks]);
  const slideById = useMemo(() => new Map((library.status === 'ready' ? library.slides : []).map((sl) => [sl.id, sl])), [library]);
  const [packDialog, setPackDialog] = useState<PackDialogState | null>(null);
  const openPackDialog = useCallback((d: PackDialogState) => setPackDialog(d), []);
  const closePackDialog = useCallback(() => setPackDialog(null), []);
  const addPackToDraft = useCallback(
    (pack: Pack) => {
      const slides = pack.slideIds.map((id) => slideById.get(id)).filter((sl): sl is SlideSummary => !!sl);
      const missing = slides.filter((sl) => !selection.some((x) => x.id === sl.id));
      if (!missing.length) return;
      updateSelection((cur) => [...cur, ...slides.filter((sl) => !cur.some((c) => c.id === sl.id))]);
      toast(`Added the pack${pack.label ? ` “${pack.label}”` : ''}: ${plural(missing.length, 'slide')}`);
      announce(`Added ${plural(missing.length, 'slide')} from the pack to the draft deck`);
    },
    [slideById, selection, updateSelection, toast, announce],
  );
  const removePackFromDraft = useCallback(
    (pack: Pack) => {
      updateSelection((cur) => cur.filter((x) => !pack.slideIds.includes(x.id)));
      announce('Removed the whole pack from the draft deck');
    },
    [updateSelection, announce],
  );
  const refreshLibrary = useCallback(() => setLibraryTry((n) => n + 1), []);

  /* Archive and restore decks (FD-50). Nothing is deleted. The server does the hiding, so without its route
     nothing changes and the person is told. */
  const [archiveDialog, setArchiveDialog] = useState<ArchiveDialogState | null>(null);
  const openArchiveDialog = useCallback((d: ArchiveDialogState) => setArchiveDialog(d), []);
  const closeArchiveDialog = useCallback(() => setArchiveDialog(null), []);
  const renameSlide = useCallback(
    async (slideId: string, title: string) => {
      let name = title;
      if (demoTagsOn()) demoTitles.set(slideId, title);
      else {
        const saved = await renameSlideApi(transport, slideId, title);
        if (saved === null) throw new Error("Renaming isn't available yet: this server can't change slide names.");
        name = saved;
      }
      titleEdits.set(slideId, { kind: 'person', by: profile ?? 'Someone', at: new Date().toISOString() });
      /* Every list on screen shows the new name at once, without waiting for a reload. */
      const rename = (s: SlideSummary) => (s.id === slideId ? { ...s, title: name } : s);
      setLibrary((l) => {
        if (l.status !== 'ready') return l;
        const slides = l.slides.map(rename);
        return { status: 'ready', slides, decks: groupDecks(slides) };
      });
      setSearch((s) => (s.status === 'ready' ? { status: 'ready', result: { ...s.result, items: s.result.items.map((i) => ({ ...i, slide: rename(i.slide) })) } } : s));
      announce(`Slide renamed to ${name}`);
    },
    [transport, announce, profile],
  );
  const archiveDeck = useCallback(
    async function run(deck: { id: string; title: string }, archived: boolean): Promise<boolean> {
      try {
        if (!(await archiveDeckApi(transport, deck.id, archived))) {
          toast('Archiving needs the server, which does not have it yet. Nothing was changed.');
          return false;
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not change the deck. Nothing was changed.');
        return false;
      }
      refreshLibrary();
      toast(archived ? `Archived “${deck.title}”. It is hidden, not deleted.` : `Restored “${deck.title}”`, archived ? { label: 'Undo', run: () => void run(deck, false) } : undefined);
      announce(archived ? `Archived ${deck.title}` : `Restored ${deck.title}`);
      return true;
    },
    [transport, refreshLibrary, toast, announce],
  );
  const makePack = useCallback(
    async (slideIds: string[], label: string | null) => {
      const clean = label?.trim() || null;
      const made = await createPackApi(transport, { slideIds, label: clean });
      if (made) {
        refreshLibrary();
        return 'saved' as const;
      }
      const deckId = slideById.get(slideIds[0] ?? '')?.provenance.sourceId ?? '';
      updateLocalPacks((cur) => ({ ...cur, packs: [...cur.packs, { id: `local-${Date.now().toString(36)}`, label: clean, deckId, slideIds }] }));
      return 'browser' as const;
    },
    [transport, refreshLibrary, slideById, updateLocalPacks],
  );
  const ungroupPack = useCallback(
    async (pack: Pack) => {
      /* Made here, or pretend: just forget it. Held by the server: ask it to ungroup, or hide it here if it cannot. */
      if (pack.local) {
        updateLocalPacks((cur) => ({ ...cur, packs: cur.packs.filter((p) => p.id !== pack.id), hidden: [...cur.hidden, pack.id] }));
        return 'browser' as const;
      }
      if (await deletePackApi(transport, pack.id)) {
        refreshLibrary();
        return 'saved' as const;
      }
      updateLocalPacks((cur) => ({ ...cur, hidden: [...cur.hidden, pack.id] }));
      return 'browser' as const;
    },
    [transport, refreshLibrary, updateLocalPacks],
  );
  const setPackStatus = useCallback(
    async (pack: Pack, status: 'suggested' | 'confirmed') => {
      /* Made here or pretend: remember it in this browser. Held by the server: ask it, who and when are its to record. */
      if (pack.local) {
        updateLocalPacks((cur) => ({ ...cur, status: { ...cur.status, [pack.id]: { status, by: status === 'confirmed' ? (profile ?? null) : null, at: status === 'confirmed' ? new Date().toISOString() : null } } }));
        return;
      }
      try {
        if (await setPackStatusApi(transport, pack.id, status)) refreshLibrary();
        else toast('Confirming a pack needs the server, which does not have it yet. Nothing was changed.');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not change the pack. Nothing was changed.');
      }
    },
    [transport, refreshLibrary, updateLocalPacks, toast, profile],
  );
  const renamePack = useCallback(
    async (pack: Pack, label: string | null) => {
      const clean = label?.trim() || null;
      if (pack.local) {
        updateLocalPacks((cur) => ({ ...cur, packs: cur.packs.map((p) => (p.id === pack.id ? { ...p, label: clean } : p)) }));
        return;
      }
      if (await renamePackApi(transport, pack.id, clean)) refreshLibrary();
      else toast('Renaming a pack needs the server, which does not have it yet.');
    },
    [transport, refreshLibrary, updateLocalPacks, toast],
  );

  /* Fake sign-in: no server, no password check. `profile` persists across reloads so a demo
     doesn't have to log in again; clearing localStorage (as the test suite does) logs out. */
  const submitLogin = useCallback(() => signIn(DEMO_PROFILE), [signIn]);
  const signOut = signOutStore;

  /* Saved slides and recent activity, scoped per demo profile so switching profiles actually
     shows a different person's stuff. */
  /* Kept on the server for the signed-in person when the database is set up (FD-18). */
  const { ids: savedIds, toggle: toggleSaved } = useSaved(profile, transport);
  const { entries: activity, log: logActivity, optedIn: activityOptedIn, setOptedIn: setActivityOptIn, retentionDays: activityRetentionDays } = useActivity(profile, transport);
  const { drafts, save: saveDraftStore, replace: replaceDraftStore, remove: deleteDraft } = useDrafts(profile, transport);
  /* Which saved deck the draft deck is "of", so saving again can ask: update that deck, or save a new one? It ends when the draft deck is emptied. */
  const [originId, setOriginId] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState(selection.length);
  if (selection.length !== lastCount) {
    setLastCount(selection.length);
    if (selection.length === 0 && originId !== null) setOriginId(null);
  if (selection.length === 0 && !combine) setCombine(true);
  }
  const draftOrigin = selection.length > 0 && originId ? (drafts.find((d) => d.id === originId) ?? null) : null;
  const saveDraft = useCallback(
    async (name: string, slides: SlideSummary[]) => {
      const id = await saveDraftStore(name, slides.map((s) => s.id));
      if (id) setOriginId(id);
      setDraftTitle(name);
      return id;
    },
    [saveDraftStore],
  );
  const replaceDraft = useCallback(
    async (id: string, name: string, slides: SlideSummary[]) => {
      setOriginId(await replaceDraftStore(id, name, slides.map((s) => s.id)));
      setDraftTitle(name);
    },
    [replaceDraftStore],
  );
  const loadDraft = useCallback(
    (draft: Draft) => {
      const all = library.status === 'ready' ? library.slides : [];
      const found = draft.slideIds.map((id) => all.find((s) => s.id === id)).filter((s): s is SlideSummary => s !== undefined);
      updateSelection(() => found);
      setOriginId(draft.id);
      setDraftTitle(draft.name);
      return found.length;
    },
    [library, updateSelection],
  );

  const value: Workspace = {
    runtime,
    library,
    reloadLibrary,
    includeArchived,
    setIncludeArchived,
    archiveDialog,
    openArchiveDialog,
    closeArchiveDialog,
    archiveDeck,
    renameSlide,
    packs,
    packDialog,
    openPackDialog,
    closePackDialog,
    addPackToDraft,
    removePackFromDraft,
    makePack,
    ungroupPack,
    renamePack,
    setPackStatus,
    includeHidden,
    setIncludeHidden,
    sectionsFromSearch,
    autoSection,
    dismissAutoSection,
    aiAvailable,
    deeperAi,
    setDeeperAi,
    askAiAnyway,
    query,
    setQuery,
    submitSearch,
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
    draftTitle,
    setDraftTitle,
    combine,
    setCombine,
    toasts,
    toast,
    dismissToast,
    announcement,
    announce,
    preview,
    openPreview,
    closePreview,
    movePreview,
    goToPreview,
    downloadSlides,
    openDownload,
    closeDownload,
    alsoFor,
    openAlso,
    closeAlso,
    profile,
    submitLogin,
    signOut,
    savedIds,
    toggleSaved,
    activity,
    logActivity,
    activityOptedIn,
    setActivityOptIn,
    activityRetentionDays,
    drafts,
    saveDraft,
    replaceDraft,
    draftOrigin,
    deleteDraft,
    loadDraft,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

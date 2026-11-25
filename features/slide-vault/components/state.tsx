'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { isBasicQuery } from '../domain/search-rules';
import { archiveDeck as archiveDeckApi, fetchAiAvailable, createPack as createPackApi, deletePack as deletePackApi, getMySettings, listLibrary, renamePack as renamePackApi, renameSlide as renameSlideApi, setMyRole, setPackStatus as setPackStatusApi, smartSearch } from '../client/api';
import { withDemoDetails } from '../client/demo-details';
import { useLocalPacks } from '../client/pack-store';
import { buildPacks, NO_PACKS, type Pack, type PacksIndex } from '../client/packs';
import { useActivity, useDrafts, useProfile, useSaved, type ActivityEntry, type Draft } from '../client/profile-store';
import { draftKey, expectedKey, slidesOutOfSight, type DraftAfter, type DraftSnapshot } from '../client/draft-status';
import { adoptServerRole, currentStoryRole, onRoleChange } from '../client/role-store';
import { demoTagsOn } from '../client/tag-store';
import { demoSwitchesAllowed } from '../client/demo-switches';
import { useSelection } from '../client/selection-store';
import { tourIsOpen } from '../client/tour-store';
import type { SlideSummary, SmartSearchChip, SmartSearchResult, TitleEdit } from '../contracts/dto';
import type { RuntimeRequest, SlideVaultRuntime } from '../contracts/runtime';
import { USER_HEADER } from '../client/user-api';
import { useIgnoredReadings, useSectionReading } from './use-search-reading';
import { filterCount, groupDecks, NO_FILTERS, plural, type Deck, type Filters } from './library';

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

export type ToastAction = { label: string; run: () => void };
export type Toast = { id: number; message: string; action?: ToastAction | ToastAction[] };

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
  /** The deck sections the words ask for, whether or not the person has turned them off (to tell when a picked section disagrees with the words) */
  sectionsInWords: string[];
  /** How many times search has been pressed: a new press reads the words afresh */
  searchRun: number;
  /** A search is on its way (after the first results): the screen shows it is updating */
  refreshing: boolean;
  /** Switch the reading of these typed words off (the words that asked for a section, say) */
  ignoreWords: (phrases: string[]) => void;
  /** The words' section reading was switched off for this search */
  sectionsOff: boolean;
  /** Switch a chip's reading off for this search: the typed words stay, the results follow (FD-107) */
  ignoreChip: (chip: SmartSearchChip, alsoCalled?: string) => boolean;
  /** The server has an AI reader, so "Deeper AI search" is offered at all (FD-79) */
  aiAvailable: boolean;
  /** "Deeper AI search" is ticked: submitted sentences and questions are read by the AI. Off until the person turns it on; remembered on this device. */
  deeperAi: boolean;
  setDeeperAi: (on: boolean) => void;
  /** The short search waiting for a yes or no before anything is searched with the AI (FD-79); null when none is waiting */
  aiAsk: string | null;
  /** 'short': the box is ticked and the search is short. 'long': the box is off and the search looks like it needs the AI. */
  aiAskKind: 'short' | 'long';
  /** Yes: the AI reads this short search. No: the regular search reads it. Either way the search runs now. */
  answerAiAsk: (useAi: boolean) => void;
  /** Close the question without answering: nothing is searched and nothing is changed (outside click, Escape). */
  dismissAiAsk: () => void;
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
  /** Put words in the search and run it now: a chip, a tag, a spoken request (searches, like Enter). */
  setQuery: (q: string) => void;
  /** What the person is typing: changes the box only; nothing is searched until Enter (Alina, 4 Nov; FD-89). */
  typeQuery: (q: string) => void;
  /** The search that was last run, which the results show (what's typed may have moved on). */
  searched: string;
  /** Enter or the Search button: lets the AI read the current request (once; repeats are cached) */
  /** Runs the search for what is typed, or for `text` when a chip or tag was clicked. Asks first when the AI choice applies (FD-79). */
  submitSearch: (text?: string) => void;
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
  toast: (message: string, action?: ToastAction | ToastAction[]) => void;
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
  /** Re-save a saved draft with new contents. Resolves to its id, which can be a new one (the server saves the new version, then removes the old). */
  replaceDraft: (id: string, name: string, slides: SlideSummary[]) => Promise<string>;
  /** The saved deck the draft deck came from (opened from My decks, or saved from here), while the draft deck has slides in it. */
  draftOrigin: Draft | null;
  deleteDraft: (id: string) => void;
  /** Replace the draft deck with a saved draft's slides. Returns how many slides were found. */
  loadDraft: (draft: Draft) => number;
  /** A saved draft's slides as the library knows them (ones no longer in the library are left out); null while the library is still loading. */
  slidesOfDraft: (draft: Draft) => SlideSummary[] | null;
  /** The draft deck as it is now, and a way to put it back (for an Undo). */
  snapshotDraft: () => DraftSnapshot;
  /** Put the draft deck back as it was. With `expect` (the draft deck as the action left it), it only does so while nothing has changed since: slides, name, saved deck or ticks. */
  restoreDraft: (snapshot: DraftSnapshot, expect?: DraftAfter) => boolean;
  /**
   * The Undo of an action that took slides out (removing one, clearing): put back just `ids` from the snapshot, each where it was.
   * Whatever was done since stays as it is. Only if the draft deck is still empty do its name, saved deck and ticks come back too.
   */
  putBackSlides: (snapshot: DraftSnapshot, ids: string[]) => void;
  /** The Undo of an action that added slides: take out just those. Whatever was done since stays as it is. */
  takeOutSlides: (ids: string[]) => void;
};

/*
 * The workspace state is published in small groups, one context each (Alina's FE note 1): a component reads only
 * the groups it uses, so ticking a slide no longer redraws the search box, and typing no longer redraws the draft deck.
 * Each group's value only changes when one of its own fields does. Notify holds the always-stable toast/announce
 * actions apart from the list of notes on screen, so the many components that only announce never redraw for a note.
 */
export type RuntimeGroup = Pick<Workspace, 'runtime'>;
export type LibraryGroup = Pick<Workspace, 'library' | 'reloadLibrary' | 'includeHidden' | 'setIncludeHidden' | 'includeArchived' | 'setIncludeArchived' | 'archiveDeck' | 'renameSlide' | 'packs' | 'makePack' | 'ungroupPack' | 'renamePack' | 'setPackStatus'>;
export type SearchGroup = Pick<Workspace, 'aiAvailable' | 'deeperAi' | 'setDeeperAi' | 'aiAsk' | 'aiAskKind' | 'answerAiAsk' | 'dismissAiAsk' | 'query' | 'setQuery' | 'typeQuery' | 'searched' | 'submitSearch' | 'retrySearch' | 'search' | 'filters' | 'patchFilters' | 'clearFilters' | 'sectionsFromSearch' | 'autoSection' | 'dismissAutoSection' | 'sectionsInWords' | 'ignoreChip' | 'ignoreWords' | 'sectionsOff' | 'refreshing' | 'searchRun'>;
export type DraftGroup = Pick<Workspace, 'selection' | 'updateSelection' | 'excluded' | 'setIncluded' | 'cartMin' | 'setCartMin' | 'draftTitle' | 'setDraftTitle' | 'combine' | 'setCombine' | 'addPackToDraft' | 'removePackFromDraft' | 'drafts' | 'saveDraft' | 'replaceDraft' | 'draftOrigin' | 'deleteDraft' | 'loadDraft' | 'slidesOfDraft' | 'snapshotDraft' | 'restoreDraft' | 'putBackSlides' | 'takeOutSlides'>;
export type OverlaysGroup = Pick<Workspace, 'preview' | 'openPreview' | 'closePreview' | 'movePreview' | 'goToPreview' | 'downloadSlides' | 'openDownload' | 'closeDownload' | 'alsoFor' | 'openAlso' | 'closeAlso' | 'archiveDialog' | 'openArchiveDialog' | 'closeArchiveDialog' | 'packDialog' | 'openPackDialog' | 'closePackDialog'>;
export type NotifyGroup = Pick<Workspace, 'toast' | 'dismissToast' | 'announce'>;
export type NoticesGroup = Pick<Workspace, 'toasts' | 'announcement'>;
export type AccountGroup = Pick<Workspace, 'profile' | 'submitLogin' | 'signOut' | 'savedIds' | 'toggleSaved' | 'activity' | 'logActivity' | 'activityOptedIn' | 'setActivityOptIn' | 'activityRetentionDays'>;

const RuntimeContext = createContext<RuntimeGroup | null>(null);
const LibraryContext = createContext<LibraryGroup | null>(null);
const SearchContext = createContext<SearchGroup | null>(null);
const DraftContext = createContext<DraftGroup | null>(null);
const OverlaysContext = createContext<OverlaysGroup | null>(null);
const NotifyContext = createContext<NotifyGroup | null>(null);
const NoticesContext = createContext<NoticesGroup | null>(null);
const AccountContext = createContext<AccountGroup | null>(null);

function need<T>(value: T | null, hook: string): T {
  if (!value) throw new Error(`${hook} must be used inside <WorkspaceProvider>`);
  return value;
}
export const useRuntime = (): RuntimeGroup => need(useContext(RuntimeContext), 'useRuntime');
export const useLibrary = (): LibraryGroup => need(useContext(LibraryContext), 'useLibrary');
export const useSearch = (): SearchGroup => need(useContext(SearchContext), 'useSearch');
export const useDraft = (): DraftGroup => need(useContext(DraftContext), 'useDraft');
export const useOverlays = (): OverlaysGroup => need(useContext(OverlaysContext), 'useOverlays');
export const useNotify = (): NotifyGroup => need(useContext(NotifyContext), 'useNotify');
export const useNotices = (): NoticesGroup => need(useContext(NoticesContext), 'useNotices');
export const useAccount = (): AccountGroup => need(useContext(AccountContext), 'useAccount');

/**
 * Everything at once. Kept only for the Storyboard files (StoryboardView, StoryLauncher, StoryRoleSetting), which
 * Schiffon owns and this restructure leaves untouched; they still redraw on any change, as before. New code uses the
 * group hooks above.
 * @deprecated Use the group hooks (useLibrary, useSearch, useDraft, …).
 */
export function useWorkspace(): Workspace {
  return { ...useRuntime(), ...useLibrary(), ...useSearch(), ...useDraft(), ...useOverlays(), ...useNotify(), ...useNotices(), ...useAccount() };
}

const SEARCH_DELAY_MS = 250;
/* Crossing out several chips in a row is one search: each click restarts this wait, so quick clicks are sent together. */
const CROSS_OUT_DELAY_MS = 500;
const TOAST_MS = 5000;

/** A pretend-data switch turned on by ?name=1 in the address and kept for the browser tab. Off unless asked for, and only where the demo switches are allowed (client/demo-switches.ts). */
function useDemoFlag(name: string): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => {
      if (!demoSwitchesAllowed) return false;
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
  /* "Deeper AI search" (FD-79): off on every reload and every new session; the person turns it on when they want it. Never remembered. */
  const [aiAvailable, setAiAvailable] = useState(false);
  const [deeperAi, setDeeperAiRaw] = useState(false);
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
  const [aiAsk, setAiAsk] = useState<string | null>(null);
  const [aiAskKind, setAiAskKind] = useState<'short' | 'long'>('short');
  const aiOnRef = useRef(false);
  const aiAvailableRef = useRef(false);
  const submitSearch = useCallback((text?: string) => {
    const q = (text ?? query).trim();
    /* A short search with "Search with AI" ticked asks first, in a card, and only searches once answered (FD-79). */
    if (aiOnRef.current && isBasicQuery(q)) {
      setAiAskKind('short');
      setAiAsk(q);
      return;
    }
    /* A long sentence or question with the box off, when the AI is set up: offer the AI in the same kind of card. Asked every time. */
    if (!aiOnRef.current && aiAvailableRef.current && q && !isBasicQuery(q)) {
      setAiAskKind('long');
      setAiAsk(q);
      return;
    }
    setSubmitted(q);
    setSearch({ status: 'loading' });
    setSearchTry((n) => n + 1);
  }, [query]);
  const setQuery = useCallback((q: string) => {
    setAiAsk(null);
    setQueryRaw(q);
    setSubmitted(q.trim());
    setSearch(q.trim() ? { status: 'loading' } : { status: 'idle' });
    setSearchTry((n) => n + 1);
  }, []);
  /* Typing sends nothing (FD-89): no request, no rate-limit count, no tokens until Enter. Emptying the box goes back home. */
  const typeQuery = useCallback((q: string) => {
    setQueryRaw(q);
    if (!q.trim()) {
      setSubmitted('');
      setSearch({ status: 'idle' });
    }
  }, []);
  /* Turning it on with words already typed reads them now; turning it off shows the plain results again. */
  const setDeeperAi = useCallback(
    (on: boolean) => {
      setDeeperAiRaw(on);
      /* Ticking it with a short search already typed asks first, the same card as pressing Enter. */
      if (on && query.trim() && isBasicQuery(query.trim())) {
        setAiAskKind('short');
        setAiAsk(query.trim());
        return;
      }
      setAiAsk(null);
      if (query.trim()) {
        setSubmitted(query.trim());
        setSearch({ status: 'loading' });
        setSearchTry((n) => n + 1);
      }
    },
    [query],
  );
  const aiOn = aiAvailable && deeperAi;
  aiOnRef.current = aiOn;
  aiAvailableRef.current = aiAvailable;
  /* A short search is left to the rules unless the person says yes in the card, and only for that search.
     "No" is remembered for that search so it reads with the rules. It asks again every time, on every short search. */
  const [forceAiFor, setForceAiFor] = useState('');
  const [declineAiFor, setDeclineAiFor] = useState('');
  const dismissAiAsk = useCallback(() => setAiAsk(null), []);
  const answerAiAsk = useCallback(
    (useAi: boolean) => {
      const q = aiAsk;
      setAiAsk(null);
      if (!q) return;
      if (aiAskKind === 'long') {
        /* Yes ticks the box and reads the sentence with the AI; No leaves the box off and runs the regular search. */
        if (useAi) setDeeperAiRaw(true);
        setForceAiFor('');
        setDeclineAiFor('');
      } else {
        setForceAiFor(useAi ? q : '');
        setDeclineAiFor(useAi ? '' : q);
        /* No also unticks "Search with AI": the person said they do not want it, so the regular search runs and the box shows it. */
        if (!useAi) setDeeperAiRaw(false);
      }
      setSubmitted(q);
      setSearch({ status: 'loading' });
      setSearchTry((n) => n + 1);
    },
    [aiAsk, aiAskKind],
  );
  const retrySearch = useCallback(() => {
    setSearch({ status: 'loading' });
    setSearchTry((n) => n + 1);
  }, []);
  /* Only a submitted search runs (FD-89), so the AI may read it when the person has ticked "Search with AI". */
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const { sectionsInWords, sectionsFromSearch, autoSection, dismissAutoSection, sectionsOff } = useSectionReading({ aiAsk: aiAsk !== null, query, search, pickedByHand: filters.section.length, run: searchTry });
  /* Chips crossed out for this search: their words stay in the box, the server is told not to read them (FD-107). */
  const { ignore, ignoreChip, ignoreWords } = useIgnoredReadings(submitted, searchTry);
  /* The filters ticked go to the server, which applies them over a larger pool of what the words found (FD-107). A section ticked by hand replaces the words' section reading. */
  const serverFilters = useMemo(() => (filterCount(filters) > 0 || filters.bestOnly ? filters : undefined), [filters]);
  const noSections = sectionsOff || filters.section.length > 0;
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const q = submitted;
    if (!q) {
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      smartSearch(transport, q, true, controller.signal, { includeHidden, role: currentStoryRole(), ai: aiOn && declineAiFor !== q ? undefined : false, forceAi: aiOn && forceAiFor === q, ignore, sectionsOff: noSections, filters: serverFilters })
        .then((result) => {
          if (typeof result.aiAvailable === 'boolean') setAiAvailable(result.aiAvailable);
          setRefreshing(false);
          setSearch({ status: 'ready', result: demoTitles.size ? { ...result, items: result.items.map((i) => ({ ...i, slide: withDemoTitle(i.slide) })) } : result });
        })
        .catch((e: Error) => {
          if (e.name === 'AbortError') return;
          setRefreshing(false);
          setSearch({ status: 'error', message: e.message });
        });
    }, ignore.length || serverFilters ? CROSS_OUT_DELAY_MS : SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [transport, submitted, searchTry, includeHidden, aiOn, forceAiFor, declineAiFor, ignore, noSections, serverFilters]);

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
    (message: string, action?: ToastAction | ToastAction[]) => {
      const id = nextToast.current++;
      /* A new note of the same kind ("Added. 3 slides ready" after "Added. 2 slides ready") replaces the old one instead of stacking up. */
      const kind = (m: string) => m.split(/[.:]/)[0];
      setToasts((t) => [...t.filter((x) => x.action || kind(x.message) !== kind(message)), { id, message, action }]);
      setTimeout(() => dismissToast(id), TOAST_MS);
    },
    [dismissToast],
  );

  /* Losing the connection is said once, and so is getting it back, so a failed save or a picture that will not load is not a mystery. */
  useEffect(() => {
    const off = () => toast("You're offline. Some things won't load or save until you reconnect.");
    const on = () => toast('Back online.');
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
    };
  }, [toast]);

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
          toast('Archiving is not available yet. Nothing was changed.');
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
        else toast('Confirming a pack is not available yet. Nothing was changed.');
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
  /* A different person (or nobody) is signed in now: the draft deck of the one before is not theirs, so it starts empty. */
  const [lastProfile, setLastProfile] = useState(profile);
  if (profile !== lastProfile) {
    setLastProfile(profile);
    updateSelectionRaw(() => []);
    setOriginId(null);
    setDraftTitle('');
    setExcludedList([]);
  }
  const [lastCount, setLastCount] = useState(selection.length);
  if (selection.length !== lastCount) {
    setLastCount(selection.length);
    if (selection.length === 0) {
      if (originId !== null) setOriginId(null);
      setDraftTitle(''); /* emptied: the name (a saved deck's, or one typed) goes too, so the next draft deck starts unnamed */
      if (excludedList.length > 0) setExcludedList([]); /* and the unticked slides: a slide added later starts ticked */
    }
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
      /* Slides of the saved deck that are hidden or gone from the library cannot be in the draft deck; they stay in the saved deck. */
      const known = library.status === 'ready' ? new Set(library.slides.map((s) => s.id)) : null;
      const inDeck = new Set(slides.map((s) => s.id));
      const kept = slidesOutOfSight(drafts.find((d) => d.id === id) ?? null, known, inDeck);
      const finalId = await replaceDraftStore(id, name, [...slides.map((s) => s.id), ...kept]);
      setOriginId(finalId);
      setDraftTitle(name);
      return finalId;
    },
    [replaceDraftStore, library, drafts],
  );
  const slidesOfDraft = useCallback(
    (draft: Draft): SlideSummary[] | null => {
      if (library.status !== 'ready') return null;
      const all = library.slides;
      return draft.slideIds.map((id) => all.find((s) => s.id === id)).filter((s): s is SlideSummary => s !== undefined);
    },
    [library],
  );
  const loadDraft = useCallback(
    (draft: Draft) => {
      const found = slidesOfDraft(draft) ?? [];
      updateSelection(() => found);
      setExcludedList([]); /* everything in the opened draft deck is ticked */
      setOriginId(draft.id);
      setDraftTitle(draft.name);
      return found.length;
    },
    [slidesOfDraft, updateSelection],
  );
  const snapshotDraft = useCallback((): DraftSnapshot => ({ slides: selection, title: draftTitle, originId, excluded: excludedList }), [selection, draftTitle, originId, excludedList]);
  /* The whole draft deck right now (slides, name, saved deck, ticks), for Undo to check against (a callback made earlier would see an old copy). */
  const nowDraft = useRef('');
  useEffect(() => {
    nowDraft.current = draftKey(selection.map((s) => s.id), draftTitle, originId, excludedList);
  });
  const restoreDraft = useCallback(
    (snap: DraftSnapshot, expect?: DraftAfter): boolean => {
      /* Undo only while the draft deck is still as the action left it; otherwise it would wipe out what was done since (a rename, a tick). */
      if (expect && nowDraft.current !== expectedKey(snap, expect)) {
        toast('The draft deck has changed since, so that can no longer be undone.');
        return false;
      }
      updateSelection(() => snap.slides);
      setExcludedList(snap.excluded ?? []);
      setOriginId(snap.originId);
      setDraftTitle(snap.title);
      return true;
    },
    [updateSelection, toast],
  );

  const putBackSlides = useCallback(
    (snap: DraftSnapshot, ids: string[]) => {
      const wasEmpty = nowDraft.current === draftKey([], '', null, []);
      updateSelection((cur) => {
        const next = [...cur];
        snap.slides.forEach((s, at) => {
          if (!ids.includes(s.id) || next.some((x) => x.id === s.id)) return;
          /* Back where it was: just before the nearest slide that came after it and is still there (so a slide taken out earlier,
             and put back since, stays ahead of it); with none of those, at the end. */
          const after = snap.slides.slice(at + 1).find((p) => next.some((x) => x.id === p.id));
          next.splice(after ? next.findIndex((x) => x.id === after.id) : next.length, 0, s);
        });
        return next;
      });
      if (wasEmpty) {
        setExcludedList(snap.excluded ?? []);
        setOriginId(snap.originId);
        setDraftTitle(snap.title);
      }
    },
    [updateSelection],
  );
  const takeOutSlides = useCallback((ids: string[]) => updateSelection((cur) => cur.filter((s) => !ids.includes(s.id))), [updateSelection]);

  /* While the AI question is waiting, the results show as loading. */
  const shownSearch = useMemo<SearchState>(() => (aiAsk ? { status: 'loading' } : search), [aiAsk, search]);
  const runtimeValue = useMemo<RuntimeGroup>(() => ({ runtime }), [runtime]);
  const libraryValue = useMemo<LibraryGroup>(() => ({ library, reloadLibrary, includeHidden, setIncludeHidden, includeArchived, setIncludeArchived, archiveDeck, renameSlide, packs, makePack, ungroupPack, renamePack, setPackStatus }), [library, reloadLibrary, includeHidden, setIncludeHidden, includeArchived, setIncludeArchived, archiveDeck, renameSlide, packs, makePack, ungroupPack, renamePack, setPackStatus]);
  const searchValue = useMemo<SearchGroup>(() => ({ aiAvailable, deeperAi, setDeeperAi, aiAsk, aiAskKind, answerAiAsk, dismissAiAsk, query, setQuery, typeQuery, searched: submitted, submitSearch, retrySearch, search: shownSearch, filters, patchFilters, clearFilters, sectionsFromSearch, autoSection, dismissAutoSection, sectionsInWords, ignoreChip, ignoreWords, sectionsOff, refreshing, searchRun: searchTry }), [aiAvailable, deeperAi, setDeeperAi, aiAsk, aiAskKind, answerAiAsk, dismissAiAsk, query, setQuery, typeQuery, submitted, submitSearch, retrySearch, shownSearch, filters, patchFilters, clearFilters, sectionsFromSearch, autoSection, dismissAutoSection, sectionsInWords, ignoreChip, ignoreWords, sectionsOff, refreshing, searchTry]);
  const draftValue = useMemo<DraftGroup>(() => ({ selection, updateSelection, excluded, setIncluded, cartMin, setCartMin, draftTitle, setDraftTitle, combine, setCombine, addPackToDraft, removePackFromDraft, drafts, saveDraft, replaceDraft, draftOrigin, deleteDraft, loadDraft, slidesOfDraft, snapshotDraft, restoreDraft, putBackSlides, takeOutSlides }), [selection, updateSelection, excluded, setIncluded, cartMin, setCartMin, draftTitle, setDraftTitle, combine, setCombine, addPackToDraft, removePackFromDraft, drafts, saveDraft, replaceDraft, draftOrigin, deleteDraft, loadDraft, slidesOfDraft, snapshotDraft, restoreDraft, putBackSlides, takeOutSlides]);
  const overlaysValue = useMemo<OverlaysGroup>(() => ({ preview, openPreview, closePreview, movePreview, goToPreview, downloadSlides, openDownload, closeDownload, alsoFor, openAlso, closeAlso, archiveDialog, openArchiveDialog, closeArchiveDialog, packDialog, openPackDialog, closePackDialog }), [preview, openPreview, closePreview, movePreview, goToPreview, downloadSlides, openDownload, closeDownload, alsoFor, openAlso, closeAlso, archiveDialog, openArchiveDialog, closeArchiveDialog, packDialog, openPackDialog, closePackDialog]);
  const notifyValue = useMemo<NotifyGroup>(() => ({ toast, dismissToast, announce }), [toast, dismissToast, announce]);
  const noticesValue = useMemo<NoticesGroup>(() => ({ toasts, announcement }), [toasts, announcement]);
  const accountValue = useMemo<AccountGroup>(() => ({ profile, submitLogin, signOut, savedIds, toggleSaved, activity, logActivity, activityOptedIn, setActivityOptIn, activityRetentionDays }), [profile, submitLogin, signOut, savedIds, toggleSaved, activity, logActivity, activityOptedIn, setActivityOptIn, activityRetentionDays]);
  return (
    <RuntimeContext.Provider value={runtimeValue}>
      <LibraryContext.Provider value={libraryValue}>
        <SearchContext.Provider value={searchValue}>
          <DraftContext.Provider value={draftValue}>
            <OverlaysContext.Provider value={overlaysValue}>
              <NotifyContext.Provider value={notifyValue}>
                <NoticesContext.Provider value={noticesValue}>
                  <AccountContext.Provider value={accountValue}>
                    {children}
                  </AccountContext.Provider>
                </NoticesContext.Provider>
              </NotifyContext.Provider>
            </OverlaysContext.Provider>
          </DraftContext.Provider>
        </SearchContext.Provider>
      </LibraryContext.Provider>
    </RuntimeContext.Provider>
  );
}

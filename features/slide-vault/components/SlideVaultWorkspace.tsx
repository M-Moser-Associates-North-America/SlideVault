'use client';

import { startNudges, stopNudge } from '../client/draft-nudge';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SlideVaultWorkspaceProps } from '../contracts/runtime';
import { Cart, CartPill, focusDraftOpener } from './Cart';
import { AlsoDialog, DownloadDialog, Lightbox } from './Dialogs';
import { hideTip, installLongPressTips } from './fixed-tip';
import { installTapFeedback } from './tap-feedback';
import { Icon, type IconName } from './icons';
import { browseTitle } from './library';
import { Crumbs, Link, type Crumb } from './parts';
import { CompactSearch } from './CompactSearch';
import { WorkspaceProvider, useAccount, useDraft, useLibrary, useNotices, useNotify, useOverlays, useRuntime, useSearch } from './state';
import { LoginView } from './AuthView';
import { ActivityOptInAsk } from './ActivityOptIn';
import { ProfileView } from './ProfileView';
import { SettingsView } from './SettingsView';
import { RootContext } from './root';
import { useWorkspaceSize } from './size';
import { ArchiveDialog } from './ArchiveDialog';
import { ArchiveView } from './ArchiveView';
import { PackDialog } from './Packs';
import { Tour } from './Tour';
import { HistoryButtons } from './HistoryButtons';
import { LeaveUploadDialog } from './LeaveUploadDialog';
import { AiAskDialog } from './AiAskDialog';
import { UploadView } from './UploadView';
import { BrowseView, CreateView, DeckView, HomeView, SlideView } from './views';
import { StoryboardView } from './StoryboardView';
import './slidevault.css';
import './slidevault-extras.css';
import './styles/search-toggles.css';
import './styles/sticky-search.css';
import './styles/filter-bar.css';
import './styles/section-conflict.css';
import './styles/draft-deck.css';
import './styles/preview.css';
import './styles/tags.css';
import './styles/cards.css';
import './styles/home.css';
import './styles/header.css';
import './styles/results.css';
import './styles/deck-page.css';
import './styles/slide-page.css';
import './styles/upload.css';
import './styles/archive.css';
import './styles/profile.css';
import './styles/auth.css';
import './styles/tour.css';
import './styles/packs.css';
import './styles/create.css';
import './styles/ai-ask.css';
import './styles/fold-panel.css';

/**
 * The SlideVault workspace: renders inside whatever space its host gives it and talks to the
 * outside world only through `runtime` (docs/INTEGRATION_CONTRACT.md). Layout and look follow the
 * approved v3 prototype (mockup/SlideVault-v3.html): filters and search on the left, content in the
 * middle, a collapsible cart on the right.
 */
export function SlideVaultWorkspace({ runtime, header }: SlideVaultWorkspaceProps) {
  return (
    <WorkspaceProvider runtime={runtime}>
      <Workspace header={header} />
    </WorkspaceProvider>
  );
}

const TABS: {
  view: 'pages' | 'create' | 'upload';
  label: string;
  icon: IconName;
  tip: string;
}[] = [
  {
    view: 'pages',
    label: 'Home',
    icon: 'library',
    tip: 'Browse and search every slide',
  },
  {
    view: 'create',
    label: 'Create',
    icon: 'sparkle',
    tip: 'Storyboard with AI, or build manually',
  },
  {
    view: 'upload',
    label: 'Upload',
    icon: 'upload',
    tip: 'Add decks to the library',
  },
];

function Workspace({ header }: { header?: ReactNode }) {
  const { runtime } = useRuntime();
  const { library } = useLibrary();
  const { searched } = useSearch();
  const { cartMin, selection, setCartMin } = useDraft();
  const { preview } = useOverlays();
  const { dismissToast, announce } = useNotify();
  const { toasts, announcement } = useNotices();
  const { profile } = useAccount();
  const appRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const root = useMemo(() => ({ app: appRef, scroll: scrollRef }), []);
  /* The draft deck starts open when there is room beside the page (desktop, a tablet on its side) and closed
     when it would cover the page (phone, a tablet held upright). Turning a tablet upright closes it. */
  useWorkspaceSize(appRef, !!profile, (size, previous, tl, previousTl) => {
    if (size !== 'wide' && (previous === null || previous === 'wide')) setCartMin(true);
    /* A tablet on its side starts with the draft deck put away too: open, it would squeeze the page to two-thirds. */
    else if (size === 'wide' && tl && previousTl !== true) setCartMin(true);
  });
  const loc = runtime.location;
  const view = loc.view === 'home' || loc.view === 'library' ? 'pages' : loc.view;
  const deep = view === 'deck' || view === 'slide';
  /* Home (browsing or searching) uses the reference HTML's hero search (views/home.tsx HomeHeader)
     instead of a side rail; it stays mounted across that transition so typing never loses focus. */
  const noRail = true; // the search bar and filter row now sit at the top of Home and the browse lists
  const narrow = view === 'create' || view === 'upload' || view === 'profile' || view === 'settings' || view === 'archive';

  /* New page: scroll to the top and move focus to its heading, like a page load would. */
  const key = `${view}/${loc.id ?? ''}`;
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  const previousView = useRef(view);
  const [uploadSeen, setUploadSeen] = useState(false);
  /* Toasts sit in the browser's top layer, so they show in front of the preview and other dialogs. Showing
     the popover again whenever a toast arrives (or a dialog opens) moves it back to the front. */
  const toastHost = useRef<HTMLDivElement>(null);
  /* Touch screens: a long press on anything with a hover note shows the note. */
  useEffect(() => installLongPressTips(), []);
  /* A new page never keeps the last page's hover note. */
  useEffect(() => hideTip(), [key]);
  /* Whatever is pressed (touch or keyboard) shows its pressed look straight away and keeps it until the page answers. */
  useEffect(() => installTapFeedback(), []);
  /* A button that is really a link answers the moment it is pressed (a small spinner), before the next page has loaded. */
  useEffect(() => {
    const press = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('.slidevault a.btn');
      if (!a || e.defaultPrevented || a.hasAttribute('aria-disabled')) return;
      a.classList.add('is-pending');
      a.setAttribute('aria-busy', 'true');
      window.setTimeout(() => {
        a.classList.remove('is-pending');
        a.removeAttribute('aria-busy');
      }, 4000);
    };
    document.addEventListener('click', press);
    return () => document.removeEventListener('click', press);
  }, []);
  const latestToast = toasts.length ? toasts[toasts.length - 1] : null;
  const latestToastId = latestToast?.id;
  const previewOpen = !!preview;
  useEffect(() => {
    const el = toastHost.current;
    if (!el || typeof el.showPopover !== 'function') return;
    if (toasts.length === 0) {
      if (el.matches(':popover-open')) el.hidePopover();
      return;
    }
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover();
  }, [toasts.length, latestToastId, previewOpen]);
  /* A popover isn't a reliable live region while it appears, so the words are also read out here. */
  useEffect(() => {
    if (latestToast) announce(latestToast.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestToastId]);
  /* Where each page was scrolled to, so going back can return there. */
  const scrollMemory = useRef(new Map<string, number>());
  const memoryKey = useRef(key);
  const keyChangedAt = useRef(0);
  useEffect(() => {
    memoryKey.current = key;
    keyChangedAt.current = performance.now();
  }, [key]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const on = () => {
      /* Right after a page change the browser may nudge the scroll position; that isn't the person scrolling. */
      if (performance.now() - keyChangedAt.current > 300) scrollMemory.current.set(memoryKey.current, el.scrollTop);
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, [scrollRef, profile]);
  if (view === 'upload' && !uploadSeen) setUploadSeen(true);
  useEffect(() => {
    const was = previousView.current;
    previousView.current = view;
    /* Every arrival on Home starts the orange ring around the Draft deck button again. */
    if (view === 'pages' && (first.current || was !== 'pages')) startNudges();
    if (first.current) {
      first.current = false;
      return;
    }
    /* Stepping through a deck slide by slide keeps the page where it is; the slide itself slides. */
    if (was === 'slide' && view === 'slide') return;
    /* Going back up (a slide to its deck or to the results, a deck to the results): the page goes back to where it was.
       The content may still be loading, so it is tried a few times. */
    const rank = (v: string) => (v === 'slide' ? 2 : v === 'deck' ? 1 : 0);
    const saved = scrollMemory.current.get(key) ?? 0;
    if (saved > 0 && rank(view) < rank(was)) {
      [0, 150, 400, 800].forEach((ms) =>
        setTimeout(() => {
          const el = scrollRef.current;
          if (el && Math.abs(el.scrollTop - saved) > 2 && el.scrollHeight >= saved) el.scrollTo(0, saved);
        }, ms),
      );
    } else scrollRef.current?.scrollTo(0, 0);
    /* The first heading that is showing: a hidden, kept-alive Upload page has one too. */
    Array.from(mainRef.current?.querySelectorAll<HTMLElement>('h1') ?? [])
      .find((h) => !h.closest('[hidden]'))
      ?.focus({ preventScroll: true });
  }, [key, view]);


  const crumbs: Crumb[] = [];
  if (view === 'browse') crumbs.push({ label: 'Home', to: { view: 'pages' } }, { label: browseTitle(loc.id ?? '') });
  if (view === 'deck' || view === 'slide') {
    const deckId = view === 'deck' ? loc.id : library.status === 'ready' ? library.slides.find((s) => s.id === loc.id)?.provenance.sourceId : undefined;
    const deck = library.status === 'ready' ? library.decks.find((d) => d.id === deckId) : undefined;
    const slide = view === 'slide' && library.status === 'ready' ? library.slides.find((s) => s.id === loc.id) : undefined;
    crumbs.push({ label: 'Home', to: { view: 'pages' } });
    if (view === 'deck') crumbs.push({ label: deck?.title ?? 'Deck' });
    else
      crumbs.push(
        {
          label: deck?.title ?? 'Deck',
          to: deck ? { view: 'deck', id: deck.id } : undefined,
        },
        { label: slide ? `Slide ${slide.provenance.slideNumber}` : 'Slide' },
      );
  }
  const showBack = deep && searched !== '';


  if (!profile) return <LoginView />;

  return (
    <RootContext.Provider value={root}>
    <div className="sv-app" ref={appRef} data-nav="bottom" data-view={view}>
      <div className="sv-scroll" ref={scrollRef}>
      {header}
      <div className="sv-top">
        <div className="sv-wrap">
          <div className="sv-brandrow">
            <nav className="sv-nav" aria-label="Main">
              <ul>
                {TABS.map((t) => {
                  /* Upload stays visible for everyone; without permission it is greyed and says why. */
                  const locked = t.view === 'upload' && !runtime.capabilities.has('source.upload');
                  return (
                    <li key={t.view}>
                      <Link
                        to={{ view: t.view }}
                        aria-current={view === t.view || (t.view === 'pages' && (view === 'browse' || deep)) ? 'page' : undefined}
                        className={locked ? 'is-locked' : undefined}
                        {...(locked ? { 'data-tip': 'Only contributors can upload.', 'data-tip-pos': 'start' } : { title: t.tip })}
                      >
                        <Icon name={locked ? 'lock' : t.icon} />
                        {t.label}
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <Link to={{ view: 'profile' }} aria-current={view === 'profile' ? 'page' : undefined} title="Your saved slides and working drafts">
                    <Icon name="folder" />
                    My decks
                  </Link>
                </li>
              </ul>
            </nav>
            <div className="sv-brandrow-end" role="region" aria-label="Back, forward and search">
              {(view === 'pages' || view === 'browse') && <CompactSearch />}
              <HistoryButtons />
            </div>
          </div>
        </div>
      </div>
      <div className={`sv-shell${cartMin ? ' cart-min' : ''}${noRail ? ' no-rail' : ''}${narrow ? ' narrow' : ''}`}>
        <div className="center">
          {(crumbs.length > 0 || showBack) && (
            <div className="sv-wrap navrow">
              <div className="navgroup">
                {crumbs.length > 0 && <Crumbs items={crumbs} />}
                {showBack && (
                  <Link className="back-results btn-link" to={{ view: 'pages' }}>
                    <Icon name="back" className="ic-sm" />
                    <span className="lbl-long">Back to results</span>
                    <span className="lbl-short" aria-label="Back to results">Results</span>
                  </Link>
                )}
              </div>
            </div>
          )}
          <main className="sv-main" id="sv-main" tabIndex={-1} ref={mainRef}>
            {view === 'pages' && <HomeView />}
            {view === 'browse' && <BrowseView id={loc.id ?? ''} />}
            {view === 'deck' && <DeckView id={loc.id ?? ''} />}
            {view === 'slide' && <SlideView id={loc.id ?? ''} />}
            {view === 'story' && <StoryboardView />}
            {view === 'create' && <CreateView />}
            {/* Upload stays mounted (hidden) once opened, so a half-filled form, its slide pictures and tags survive a trip to another tab. */}
            {(view === 'upload' || uploadSeen) && (
              <div hidden={view !== 'upload'}>
                <UploadView />
              </div>
            )}
            {view === 'profile' && <ProfileView />}
            {view === 'settings' && <SettingsView />}
            {view === 'archive' && <ArchiveView />}
          </main>
        </div>
        <aside className="cart-col" aria-label="Draft deck">
          <Cart />
        </aside>
      </div>
      </div>
      <CartPill />
      <BottomBar view={view} deep={deep} />
      {!cartMin && (
        <button
          type="button"
          className="cart-scrim"
          aria-label="Close draft deck"
          tabIndex={-1}
          onClick={() => {
            setCartMin(true);
            focusDraftOpener();
          }}
        />
      )}
      <div ref={toastHost} popover="manual" className={`toasts${selection.length ? ' lift' : ''}`}>
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span className="msg">{t.message}</span>
            {t.action &&
              (Array.isArray(t.action) ? t.action : [t.action]).map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className="btn-link toast-act"
                  onClick={() => {
                    a.run();
                    dismissToast(t.id);
                  }}
                >
                  {a.label}
                </button>
              ))}
            <button type="button" className="x" aria-label="Dismiss message" onClick={() => dismissToast(t.id)}>
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
      <Tour />
      <ActivityOptInAsk />
      <Lightbox />
      <DownloadDialog />
      <AlsoDialog />
      <PackDialog />
      <ArchiveDialog />
      <LeaveUploadDialog />
      <AiAskDialog />
    </div>
    </RootContext.Provider>
  );
}


/**
 * The main tabs as a bar along the bottom of a phone, with the draft deck as the fifth item. It is shown
 * instead of the top tabs when the workspace is narrow (the tabs always sit at the bottom on a phone).
 */
function BottomBar({ view, deep }: { view: string; deep: boolean }) {
  const { runtime } = useRuntime();
  const { selection, cartMin, setCartMin } = useDraft();
  const n = selection.length;
  return (
    <nav className="sv-bottombar" aria-label="Main">
      <ul>
        {TABS.map((t) => {
          const locked = t.view === 'upload' && !runtime.capabilities.has('source.upload');
          return (
            <li key={t.view}>
              <Link to={{ view: t.view }} aria-current={view === t.view || (t.view === 'pages' && (view === 'browse' || deep)) ? 'page' : undefined} className={locked ? 'is-locked' : undefined}>
                <Icon name={locked ? 'lock' : t.icon} />
                <span>{t.label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link to={{ view: 'profile' }} aria-current={view === 'profile' ? 'page' : undefined}>
            <Icon name="folder" />
            <span>My decks</span>
          </Link>
        </li>
        <li>
          <button
            type="button"
            className="bb-deck"
            aria-expanded={!cartMin}
            aria-label={n ? `Draft deck, ${n} ${n === 1 ? 'slide' : 'slides'}` : 'Draft deck'}
            onClick={() => {
              stopNudge('draft');
              setCartMin(!cartMin);
              if (cartMin) requestAnimationFrame(() => document.querySelector<HTMLElement>('.slidevault .cart .cart-tg')?.focus());
              else focusDraftOpener();
            }}
          >
            <Icon name="layers" />
            <span>Draft deck</span>
            <span className={`bb-n${n === 0 ? ' is-zero' : ''}`} key={n} aria-hidden="true">
              {n}
            </span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

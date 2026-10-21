'use client';

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { SlideVaultWorkspaceProps } from '../contracts/runtime';
import { Cart, CartPill } from './Cart';
import { AlsoDialog, DownloadDialog, Lightbox } from './Dialogs';
import { Icon, type IconName } from './icons';
import { browseTitle } from './library';
import { Crumbs, Link, type Crumb } from './parts';
import { CompactSearch } from './CompactSearch';
import { SearchForm } from './Rail';
import { WorkspaceProvider, useWorkspace } from './state';
import { LoginView } from './AuthView';
import { ActivityOptInAsk } from './ActivityOptIn';
import { ProfileView } from './ProfileView';
import { SettingsView } from './SettingsView';
import { RootContext } from './root';
import { useWorkspaceSize } from './size';
import { Tour } from './Tour';
import { UploadView } from './UploadView';
import { BrowseView, CreateView, DeckView, HomeView, SlideView } from './Views';
import './slidevault.css';
import './slidevault-extras.css';

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
    icon: 'pencil',
    tip: 'Build a new deck from your slides (coming later)',
  },
  {
    view: 'upload',
    label: 'Upload',
    icon: 'upload',
    tip: 'Add decks to the library',
  },
];

function Workspace({ header }: { header?: ReactNode }) {
  const { runtime, library, query, cartMin, selection, toasts, dismissToast, announcement, profile, setCartMin } = useWorkspace();
  const appRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const root = useMemo(() => ({ app: appRef, scroll: scrollRef }), []);
  /* The draft deck starts open when there is room beside the page (desktop, a tablet on its side) and closed
     when it would cover the page (phone, a tablet held upright). Turning a tablet upright closes it. */
  useWorkspaceSize(appRef, !!profile, (size, previous) => {
    if (size !== 'wide' && (previous === null || previous === 'wide')) setCartMin(true);
  });
  const loc = runtime.location;
  const view = loc.view === 'home' || loc.view === 'library' ? 'pages' : loc.view;
  const deep = view === 'deck' || view === 'slide';
  /* Local design prototype: the whole Home/pages view (browsing or searching) drops the rail in
     favor of the original reference HTML's hero search (Views.tsx HomeHeader), which stays
     mounted across that transition so typing never loses focus mid-word. Browse is untouched
     until reviewed separately. Not pushed, not changing Khushali's build. */
  const noRail = true; // the search bar and filter row now sit at the top of Home and the browse lists
  const narrow = view === 'create' || view === 'upload' || view === 'profile' || view === 'settings';

  /* New page: scroll to the top and move focus to its heading, like a page load would. */
  const key = `${view}/${loc.id ?? ''}`;
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    scrollRef.current?.scrollTo(0, 0);
    mainRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [key]);

  const toHome = () => runtime.navigate({ view: 'pages' });

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
  const showBack = deep && query.trim() !== '';


  if (!profile) return <LoginView />;

  return (
    <RootContext.Provider value={root}>
    <div className="sv-app" ref={appRef}>
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
            {(view === 'pages' || view === 'browse') && <CompactSearch />}
          </div>
        </div>
      </div>
      <div className={`sv-shell${cartMin ? ' cart-min' : ''}${noRail ? ' no-rail' : ''}${narrow ? ' narrow' : ''}`}>
        <div className="center">
          {deep && (
            <div className="deep-search">
              <SearchForm onSubmit={toHome} />
            </div>
          )}
          {(crumbs.length > 0 || showBack) && (
            <div className="sv-wrap navrow">
              <div className="navgroup">
                {crumbs.length > 0 && <Crumbs items={crumbs} />}
                {showBack && (
                  <Link className="back-results btn-link" to={{ view: 'pages' }}>
                    <Icon name="back" className="ic-sm" />
                    Back to results
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
            {view === 'create' && <CreateView />}
            {view === 'upload' && <UploadView />}
            {view === 'profile' && <ProfileView />}
            {view === 'settings' && <SettingsView />}
          </main>
        </div>
        <aside className="cart-col" aria-label="Draft deck">
          <Cart />
        </aside>
      </div>
      </div>
      <CartPill />
      {!cartMin && (
        <button
          type="button"
          className="cart-scrim"
          aria-label="Close draft deck"
          tabIndex={-1}
          onClick={() => {
            setCartMin(true);
            requestAnimationFrame(() => document.querySelector<HTMLElement>('.slidevault .cart-pill')?.focus());
          }}
        />
      )}
      <div className={`toasts${selection.length ? ' lift' : ''}`} aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span className="msg">{t.message}</span>
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
    </div>
    </RootContext.Provider>
  );
}

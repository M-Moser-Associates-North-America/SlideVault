'use client';

import { useEffect, useRef } from 'react';
import type { SlideVaultWorkspaceProps } from '../contracts/runtime';
import { Cart } from './Cart';
import { AlsoDialog, DownloadDialog, Lightbox } from './Dialogs';
import { Icon, type IconName } from './icons';
import { browseTitle } from './library';
import { Crumbs, Link, type Crumb } from './parts';
import { FilterPanel, SearchForm, TryAsking } from './Rail';
import { WorkspaceProvider, useWorkspace } from './state';
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
export function SlideVaultWorkspace({ runtime }: SlideVaultWorkspaceProps) {
  return (
    <WorkspaceProvider runtime={runtime}>
      <Workspace />
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
    icon: 'layers',
    tip: 'Build and My decks will live here later',
  },
  {
    view: 'upload',
    label: 'Upload',
    icon: 'upload',
    tip: 'Add decks to the library',
  },
];

function Workspace() {
  const { runtime, library, query, cartMin, selection, toasts, dismissToast, announcement } = useWorkspace();
  const loc = runtime.location;
  const view = loc.view === 'home' || loc.view === 'library' ? 'pages' : loc.view;
  const deep = view === 'deck' || view === 'slide';
  const noRail = view !== 'pages' && view !== 'browse';
  const narrow = view === 'create' || view === 'upload';

  /* New page: scroll to the top and move focus to its heading, like a page load would. */
  const key = `${view}/${loc.id ?? ''}`;
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
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

  const slidesAll = library.status === 'ready' ? library.slides : [];
  const decksAll = library.status === 'ready' ? library.decks : [];

  return (
    <div className="sv-app">
      <div className="sv-top">
        <div className="sv-wrap">
          <div className="sv-brandrow">
            <nav className="sv-nav" aria-label="Main">
              <ul>
                {TABS.filter((t) => t.view !== 'upload' || runtime.capabilities.has('source.upload')).map((t) => (
                  <li key={t.view}>
                    <Link to={{ view: t.view }} aria-current={view === t.view || (t.view === 'pages' && (view === 'browse' || deep)) ? 'page' : undefined} title={t.tip}>
                      <Icon name={t.icon} />
                      {t.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      </div>
      <div className={`sv-shell${cartMin ? ' cart-min' : ''}${noRail ? ' no-rail' : ''}${narrow ? ' narrow' : ''}`}>
        {!noRail && (
          <aside className="rail" aria-label="Search and filters">
            <SearchForm onSubmit={toHome} />
            <div>
              <TryAsking />
              <FilterPanel decks={decksAll} slidesAll={slidesAll} />
            </div>
          </aside>
        )}
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
          </main>
        </div>
        <aside className="cart-col" aria-label="Cart">
          <Cart />
        </aside>
      </div>
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
      <Lightbox />
      <DownloadDialog />
      <AlsoDialog />
    </div>
  );
}

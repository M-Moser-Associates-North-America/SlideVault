'use client';

import { SlideTitle } from './RenameSlide';
import { SlideEngagement, useShareSlide } from './SlideActions';
import { SectionBrowse, SectionCards } from './SectionCards';
import { DeckTags, SlideLabelsPanel, SlideTagsPanel } from './TagBits';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { getSlide } from '../client/api';
import type { SlideDetail, SlideSummary, SmartSearchItem, SmartSearchResult } from '../contracts/dto';
import { Icon, type IconName } from './icons';
import {
  browseSlides,
  browseTitle,
  categoryOf,
  clientOf,
  countBy,
  dateLabel,
  hiddenGap,
  deckMatches,
  downloadedNote,
  downloadsOf,
  filterCount,
  folderLabel,
  removeHint,
  plural,
  SECTION_LABEL,
  slideMatches,
  UNKNOWN_CLIENT,
  yearOf,
  type Deck,
} from './library';
import { findDecks } from './deck-finder';
import { GroupTool, PackPanel } from './Packs';
import { DeckCard, Link, SkeletonGrid, SkeletonRows, SlideCard, StateBlock, Thumb, useCartToggle, useSavedToggle } from './parts';
import { FoldPanel } from './fold-panel';
import { MicButton } from './MicButton';
import { TRY_QUERIES } from './Rail';
import { FilterBar } from './FilterBar';
import { setHeroOut } from '../client/hero-visibility';
import { setResultsSummary } from '../client/results-summary';
import { useEdgeFade } from './edge-fade';
import { ScrollRow } from './scroll-row';
import { PreviewTags } from './TagBits';
import { NumberJump } from './Dialogs';
import { useWorkspaceCompact, useWorkspaceFiltersRolled, useWorkspacePhoneLike } from './size';
import { useTipSeen } from '../client/tip-store';
import { HiddenToggle } from './HiddenToggle';
import { shownInFilterRow, withoutChip } from './search-reading';
import { useRoot } from './root';
import { useWorkspace } from './state';
import { StoryLauncher } from './StoryLauncher';

const ROW_LIMIT = 12;

/** The browse tiles (client, year, category): scroll sideways like the card rows. */
function TileRow({ children }: { children: ReactNode }) {
  return <div className="tiles">{children}</div>;
}

/** One horizontally scrolling row of cards, with "See all". */
function Row({ id, title, sub, seeAll, total, children }: { id: string; title: string; sub?: string; seeAll?: string; total?: number; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const scroll = (dir: -1 | 1) =>
    ref.current?.scrollBy({
      left: dir * ref.current.clientWidth * 0.85,
      behavior: 'smooth',
    });
  return (
    <section className="row" aria-labelledby={`row-${id}`}>
      <div className="row-head">
        <div className="row-title">
          <h2 id={`row-${id}`}>{title}</h2>
          {sub && (
            <button
              type="button"
              className="row-info"
              data-tip={sub}
              data-tip-pos="start"
              aria-label={`About ${title}`}
            >
              <Icon name="info" />
            </button>
          )}
        </div>
        <div className="acts">
          {seeAll && (
            <Link className="btn-link" to={{ view: 'browse', id: seeAll }}>
              See all {total}
            </Link>
          )}
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Scroll ${title} left`} onClick={() => scroll(-1)}>
            <Icon name="left" />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Scroll ${title} right`} onClick={() => scroll(1)}>
            <Icon name="right" />
          </button>
        </div>
      </div>
      <ul ref={ref} className="row-scroller">
        {children}
      </ul>
    </section>
  );
}

/**
 * "Top 10"-style row with big outlined rank numbers, rather than the small corner ribbon the
 * rest of the app uses.
 */
function TopTenRow({ slides, sub }: { slides: SlideSummary[]; sub: string }) {
  const top = slides.slice(0, 10);
  if (top.length === 0) return null;
  return (
    <Row id="top10" title="Your Top 10" sub={sub}>
      {top.map((s, i) => (
        <li key={s.id} className="top10-item">
          <span className="top10-num" aria-hidden="true">
            {i + 1}
          </span>
          <SlideCard slide={s} list={top} />
        </li>
      ))}
    </Row>
  );
}

/** The library is loading, failed, or empty: the screens below only run once it is ready. */
function useReadyLibrary(): { slides: SlideSummary[]; decks: Deck[] } | { blocker: ReactNode } {
  const { library, reloadLibrary } = useWorkspace();
  if (library.status === 'loading') {
    return {
      blocker: (
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading the library…</span>
          <SkeletonRows />
        </div>
      ),
    };
  }
  if (library.status === 'error') {
    return {
      blocker: (
        <StateBlock error icon="alert" title="The library could not be loaded" text={library.message}>
          <button type="button" className="btn" onClick={reloadLibrary}>
            Try again
          </button>
        </StateBlock>
      ),
    };
  }
  if (library.slides.length === 0) {
    return {
      blocker: (
        <StateBlock icon="library" title="Your library is empty" text="No decks have been added yet. Upload a deck to see its slides here.">
          <Link className="btn" to={{ view: 'upload' }}>
            Go to Upload
          </Link>
        </StateBlock>
      ),
    };
  }
  return { slides: library.slides, decks: library.decks };
}

/* ------------------------------------------------------------------ Home */

/**
 * The original reference HTML's typewriter headline, timing copied exactly from reference/SlideVault.html
 * (85ms per typed character, 45ms per deleted character, 1500ms pause on a complete phrase),
 * reimplemented as a hook instead of the reference's class-component state. Honors
 * prefers-reduced-motion by showing the first phrase complete and static, no animation.
 */
const TYPEWRITER_PHRASES = ['proposals', 'case studies', 'pricing decks'];

function useTypewriter(phrases: string[], active: boolean): string {
  const [text, setText] = useState('');
  const reduceMotion = useRef(false);
  useEffect(() => {
    if (!active) return;
    reduceMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion.current) {
      setText(phrases[0]);
      return;
    }
    let idx = 0;
    let deleting = false;
    let current = '';
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const target = phrases[idx % phrases.length];
      if (!deleting && current === target) {
        timer = setTimeout(() => {
          deleting = true;
          tick();
        }, 1500);
        return;
      }
      if (deleting && current === '') {
        deleting = false;
        idx += 1;
        tick();
        return;
      }
      current = deleting ? target.slice(0, current.length - 1) : target.slice(0, current.length + 1);
      setText(current);
      timer = setTimeout(tick, deleting ? 45 : 85);
    };
    tick();
    return () => clearTimeout(timer);
  }, [phrases, active]);
  return text;
}

/** The "Try" example searches, shown under the search and filter card. */
function HomeTry() {
  const { query, typeQuery, submitSearch, runtime, searched, filters } = useWorkspace();
  const search = (q: string) => {
    typeQuery(q);
    submitSearch(q);
    if (runtime.location.view !== 'pages') runtime.navigate({ view: 'pages' });
  };
  const tryRef = useRef<HTMLUListElement>(null);
  useEdgeFade(tryRef);
  return (
    <div className={`home-try${searched !== '' || runtime.location.view === 'browse' || filterCount(filters) > 0 ? ' in-results' : ''}`}>
      <div className="home-hero-try">
        <span>Try</span>
        <ul ref={tryRef}>
          {TRY_QUERIES.map((q) => (
            <li key={q}>
              <button type="button" className="try-chip" aria-current={query.trim() === q ? 'true' : undefined} onClick={() => search(q)}>
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The original reference HTML's hero search, styled to match it exactly, wired to real search. */
/* Once the person has clicked into the search box, the typing animation stays off for the rest of the visit. */
let heroTouched = false;

function HomeHeader() {
  const { query, setQuery, typeQuery, submitSearch, runtime, searched } = useWorkspace();
  const compact = useWorkspaceFiltersRolled();
  const [touched, setTouched] = useState(heroTouched);
  /* The typing animation is for Home itself: once a results page is up (a search, a row's See all, a tile) the box just shows its plain hint. */
  const onResults = searched !== '' || runtime.location.view === 'browse';
  const showHint = query === '' && !touched && !onResults;
  const tw = useTypewriter(TYPEWRITER_PHRASES, showHint);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) submitSearch();
  };
  /* Talking replaces what is in the bar and searches straight away, as Enter would. */
  const spoken = useRef(false);
  useEffect(() => {
    if (spoken.current && query.trim()) {
      spoken.current = false;
      submitSearch();
    }
  }, [query, submitSearch]);
  /* Tell the header when this bar has scrolled up out of sight, so it can show a slim search shortcut. */
  const formRef = useRef<HTMLFormElement>(null);
  const { scroll } = useRoot();
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    /* Out only once the whole bar is under the pinned tabs row, so the two search bars are never on screen together. */
    let io: IntersectionObserver | undefined;
    const watch = () => {
      io?.disconnect();
      const tabs = document.querySelector<HTMLElement>('.slidevault .sv-top')?.offsetHeight ?? 47;
      io = new IntersectionObserver(([entry]) => setHeroOut(!entry.isIntersecting), { root: scroll.current, rootMargin: `-${tabs}px 0px 0px 0px` });
      io.observe(el);
    };
    watch();
    window.addEventListener('resize', watch);
    return () => {
      window.removeEventListener('resize', watch);
      io?.disconnect();
      setHeroOut(false);
    };
  }, [scroll]);
  /* Start typing anywhere on Home and the letters go into the search box. Only plain characters when nothing
     else is using the keyboard, so shortcuts, menus, dialogs and screen reader keys keep working. */
  useEffect(() => {
    const busy = 'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="menuitem"], [role="tab"], [role="dialog"], [role="slider"], [role="spinbutton"], [role="checkbox"], [role="switch"], dialog';
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.key.length !== 1 || e.key === ' ') return;
      if ((e.target as Element | null)?.closest?.(busy)) return;
      if (document.querySelector('dialog[open], .tour-pop')) return;
      (document.getElementById('sv-fb-q') ?? document.getElementById('sv-hero-q'))?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className={`home-hero${searched !== '' || runtime.location.view === 'browse' ? ' has-results' : ''}`}>
      <form className="home-hero-search" role="search" onSubmit={submit} ref={formRef}>
        <label htmlFor="sv-hero-q" className="home-hero-prefix">
          I&rsquo;m looking for
          <span className="sr-only"> (search slides)</span>
        </label>
        <span className="home-hero-field">
          {showHint && (
            <span className="home-hero-anim" aria-hidden="true">
              {tw}
              <span className="home-hero-caret" />
            </span>
          )}
          <input id="sv-hero-q" type="search" autoComplete="off" enterKeyHint="search" value={query}
            onChange={(e) => {
              typeQuery(e.target.value);
              /* Typing on a page that can't show results (a client or year list) takes you to Home's results. */
              if (e.target.value && runtime.location.view !== 'pages') runtime.navigate({ view: 'pages' });
            }} placeholder={touched || onResults ? 'Slides, clients or topics' : undefined} onFocus={() => {
              heroTouched = true;
              setTouched(true);
            }} />
          <button
            type="button"
            className="home-hero-clear"
            aria-label="Clear search"
            hidden={!query}
            onClick={() => {
              setQuery('');
              /* Home swaps its layout once the search is empty, so the box is a new element a moment later. */
              setTimeout(() => document.getElementById('sv-hero-q')?.focus(), 0);
            }}
          >
            <Icon name="x" />
          </button>
          <MicButton className="home-hero-mic" showWhenOff onText={(t) => {
            spoken.current = true;
            typeQuery(t);
          }} />
          <button type="submit" className="home-hero-btn" aria-label="Search">
            <Icon name="search" />
          </button>
        </span>
        {!compact && <HiddenToggle />}
      </form>
      {/* On a phone the eye and the Storyboard button sit in the row under the search bar (FilterBar); only the brief hint stays here. */}
      <StoryLauncher part={compact ? 'hint' : 'all'} />
    </div>
  );
}

/** The search bar, filter row and example searches: the top of Home and of the browse lists. */
function SearchHeader() {
  return (
    <>
      <HomeHeader />
      <FilterBar />
      <HomeTry />
    </>
  );
}

export function HomeView() {
  const { searched, filters } = useWorkspace();
  /* Results show once a search has run (Enter), not while the words are being typed (FD-89). */
  const searching = searched !== '';
  return (
    <>
      {!searching && (
        <h1 className="sr-only" tabIndex={-1}>
          Home
        </h1>
      )}
      <SearchHeader />
      {searching ? <ResultsView /> : filters.section.length > 0 ? <SectionBrowse kind={filters.section[0]} /> : <LibraryView />}
    </>
  );
}

function LibraryView() {
  const { filters, clearFilters, savedIds, activity } = useWorkspace();
  const lib = useReadyLibrary();
  const ready = 'slides' in lib;
  const slides = useMemo(() => (ready ? lib.slides.filter((s) => slideMatches(s, filters)) : []), [ready, lib, filters]);
  const decks = useMemo(() => (ready ? lib.decks.filter((d) => deckMatches(d, filters)) : []), [ready, lib, filters]);

  const best = browseSlides('best', slides);
  const recent = browseSlides('recent', slides);
  const popular = browseSlides('popular', slides);

  /* Top 10: how often this person has opened each slide (their own opt-in activity, FD-18), so two
     people in the same area still get their own row. With no history yet the row is left out rather
     than filled with something that isn't their ranking (Alina, 2026-10-19). */
  const usageRanked = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of activity) {
      if (a.kind === 'viewed' && a.slideId) counts.set(a.slideId, (counts.get(a.slideId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => slides.find((s) => s.id === id))
      .filter((s): s is SlideSummary => s !== undefined)
      .slice(0, 10);
  }, [activity, slides]);
  const top10 = usageRanked;
  const top10Sub = 'The slides you open most.';

  const firstSaved = slides.find((s) => savedIds.has(s.id));
  const becauseCategory = firstSaved ? categoryOf(firstSaved) : null;
  const because = firstSaved && becauseCategory ? slides.filter((s) => s.id !== firstSaved.id && categoryOf(s) === becauseCategory) : [];
  /* "Suggested for you": slides in the same category as one this person saved. Left out until they save one. */
  const forYou = because;
  const forYouSub = firstSaved ? `Because you saved “${firstSaved.title}”.` : '';
  const tileCounts = (pick: (s: SlideSummary) => string | number | null) => {
    const slideN = countBy(slides, pick);
    const deckN = new Map<string, Set<string>>();
    for (const s of slides) {
      const v = pick(s);
      if (v === null || v === '') continue;
      const k = String(v);
      deckN.set(k, (deckN.get(k) ?? new Set()).add(s.provenance.sourceId));
    }
    return { slideN, deckN };
  };
  const clients = tileCounts(clientOf);
  const years = tileCounts(yearOf);
  const cats = tileCounts(categoryOf);
  const tiles = (kind: string, t: ReturnType<typeof tileCounts>, order: (a: string, b: string) => number) =>
    [...t.slideN.keys()].sort(order).map((v) => (
      <Link key={v} className="tile" to={{ view: 'browse', id: `${kind}:${v}` }}>
        <b title={v}>{v}</b>
        <span className="tile-n">{plural(t.deckN.get(v)?.size ?? 0, 'deck')}</span>
        <span className="meta">{plural(t.slideN.get(v) ?? 0, 'slide')}</span>
      </Link>
    ));

  return (
    <div className="sv-wrap">
      {/* No page-head h1 here: HomeView's hero search provides the page's real (sr-only when
          searching) h1 so there's exactly one, not a duplicate "Home" heading. */}
      {!ready ? (
        <div style={{ marginTop: 20 }}>{lib.blocker}</div>
      ) : (
        <>
          {best.length > 0 && (
            <Row id="best" title="Best of the Best" sub="Hand-picked slides." seeAll="best" total={best.length}>
              {best.slice(0, ROW_LIMIT).map((s) => (
                <li key={s.id}>
                  <SlideCard slide={s} list={best.slice(0, ROW_LIMIT)} />
                </li>
              ))}
            </Row>
          )}
          <TopTenRow slides={top10} sub={top10Sub} />
          {forYou.length > 0 && (
            <Row id="foryou" title="Suggested for you" sub={forYouSub}>
              {forYou.slice(0, ROW_LIMIT).map((s) => (
                <li key={s.id}>
                  <SlideCard slide={s} list={forYou.slice(0, ROW_LIMIT)} />
                </li>
              ))}
            </Row>
          )}
          {recent.length > 0 && recent.some((s) => yearOf(s) !== null) && (
            <Row id="recent" title="Newest decks" sub="Most recent year first." seeAll="recent" total={recent.length}>
              {recent.slice(0, ROW_LIMIT).map((s) => (
                <li key={s.id}>
                  <SlideCard slide={s} list={recent.slice(0, ROW_LIMIT)} />
                </li>
              ))}
            </Row>
          )}
          {popular.length > 0 && (
            <Row id="popular" title="Most downloaded" sub="The slides people download most often." seeAll="popular" total={popular.length}>
              {popular.slice(0, ROW_LIMIT).map((s) => (
                <li key={s.id}>
                  <SlideCard slide={s} list={popular.slice(0, ROW_LIMIT)} note={downloadedNote(s)} />
                </li>
              ))}
            </Row>
          )}
          {decks.length > 0 && (
            <Row id="decks" title="Decks" sub="Arranged by client and year. Folder names TBD.">
              {decks.slice(0, 24).map((d) => (
                <li key={d.id}>
                  <DeckCard deck={d} />
                </li>
              ))}
            </Row>
          )}
          {clients.slideN.size > 0 && (
            <section className="row" aria-labelledby="row-clients">
              <div className="row-head">
                <div>
                  <h2 id="row-clients">Browse by client</h2>
                  <div className="sub">Straight from folder names.</div>
                </div>
              </div>
              <TileRow>{tiles('client', clients, (a, b) => a.localeCompare(b))}</TileRow>
            </section>
          )}
          {years.slideN.size > 0 && (
            <section className="row" aria-labelledby="row-years">
              <div className="row-head">
                <div>
                  <h2 id="row-years">Browse by year</h2>
                </div>
              </div>
              <TileRow>{tiles('year', years, (a, b) => Number(b) - Number(a))}</TileRow>
            </section>
          )}
          {cats.slideN.size > 0 && (
            <section className="row" aria-labelledby="row-categories">
              <div className="row-head">
                <div>
                  <h2 id="row-categories">Browse by category</h2>
                </div>
              </div>
              <TileRow>{tiles('category', cats, (a, b) => a.localeCompare(b))}</TileRow>
            </section>
          )}
          {slides.length === 0 && (
            <StateBlock icon="search" title="No slides match" text={removeHint(filters) || 'Try a different filter.'}>
              <button type="button" className="btn" onClick={clearFilters}>
                Clear all filters
              </button>
            </StateBlock>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Browse */

export function BrowseView({ id }: { id: string }) {
  return (
    <>
      <SearchHeader />
      {id === 'decks' ? <BrowsePage id={id} /> : <ResultsView browse={id} />}
    </>
  );
}

function BrowsePage({ id }: { id: string }) {
  const { filters } = useWorkspace();
  const lib = useReadyLibrary();
  const title = browseTitle(id);
  return (
    <div className="sv-wrap">
      <div className="page-head">
        <div>
          <h1 className="h1" tabIndex={-1}>
            {title}
          </h1>
        </div>
      </div>
      {'blocker' in lib ? (
        <div style={{ marginTop: 20 }}>{lib.blocker}</div>
      ) : (
        <BrowseBody id={id} slides={lib.slides.filter((s) => slideMatches(s, filters))} decks={lib.decks.filter((d) => deckMatches(d, filters))} />
      )}
    </div>
  );
}

function SelectAll({ slides }: { slides: SlideSummary[] }) {
  const { selection, updateSelection, announce } = useWorkspace();
  const all = slides.length > 0 && slides.every((s) => selection.some((x) => x.id === s.id));
  const click = () => {
    updateSelection((cur) => (all ? cur.filter((c) => !slides.some((s) => s.id === c.id)) : [...cur, ...slides.filter((s) => !cur.some((c) => c.id === s.id))]));
    announce(all ? 'Removed from draft deck' : `${plural(slides.length, 'slide')} added to draft deck`);
  };
  return (
    <button type="button" className="btn btn-sm" onClick={click} aria-label={all ? 'Remove all from draft deck' : `Add all ${slides.length} to draft deck`}>
      <Icon name="check" />
      <span className="lbl-long" aria-hidden="true">{all ? 'Remove all from draft deck' : `Add all ${slides.length} to draft deck`}</span>
      <span className="lbl-short" aria-hidden="true">{all ? 'Remove all' : `Add all ${slides.length}`}</span>
    </button>
  );
}

function BrowseBody({ id, slides, decks }: { id: string; slides: SlideSummary[]; decks: Deck[] }) {
  if (id === 'decks') {
    return (
      <div className="grid" style={{ marginTop: 16 }}>
        {decks.map((d) => (
          <DeckCard key={d.id} deck={d} />
        ))}
      </div>
    );
  }
  const ids = browseSlides(id, slides);
  if (!ids.length) {
    return (
      <StateBlock icon="search" title="No slides in this row yet" text="Nothing here matches your filters. Try removing one, or head back to Home.">
        <Link className="btn" to={{ view: 'pages' }}>
          Back to Home
        </Link>
      </StateBlock>
    );
  }
  return (
    <>
      <p className="lede" style={{ marginTop: 4 }}>
        {plural(ids.length, 'slide')}.
      </p>
      <div className="refine">
        <span className="spacer" />
        <SelectAll slides={ids} />
      </div>
      <div className="grid" style={{ marginTop: 8 }}>
        {ids.map((s) => (
          <SlideCard key={s.id} slide={s} list={ids} note={id === 'popular' ? downloadedNote(s) : undefined} />
        ))}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- Search */

/**
 * The results page. With `browse` set (a Home row's "See all", or a client / year / category tile) it shows the same page
 * for a list that no search produced: same heading, filter pills, sort, section pills and cards, just without the "why it fits" lines.
 */
export function ResultsView({ browse }: { browse?: string } = {}) {
  const { searched, search, filters, patchFilters, clearFilters, retrySearch, setQuery, aiAsk, autoSection, sectionsFromSearch, dismissAutoSection } = useWorkspace();
  const [sort, setSort] = useState<'best' | 'popular' | 'newest'>(browse?.startsWith('popular') ? 'popular' : browse?.startsWith('recent') ? 'newest' : 'best');
  const browseKind = browse?.split(':')[0];
  const browseValue = browse ? browse.split(':').slice(1).join(':') : '';
  const tileKind = browseKind === 'client' || browseKind === 'year' || browseKind === 'category';
  /* A tile turns its client / year / category into a filter, so the pill shows and can be taken off; the rows' lists are not filters. */
  const [applied, setApplied] = useState(!(browse && tileKind));
  useEffect(() => {
    if (!browse) return;
    if (searched) setQuery('');
    if (!tileKind) return;
    clearFilters();
    if (browseKind === 'client') patchFilters({ client: [browseValue] });
    else if (browseKind === 'year') patchFilters({ yfrom: Number(browseValue), yto: Number(browseValue) });
    else patchFilters({ category: [browseValue] });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the filters are in place before the list shows
    setApplied(true);
    return () => clearFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browse]);
  const compact = useWorkspacePhoneLike();
  /* Two slides across or one, remembered on this device (phone only). */
  const [dense, setDenseState] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('sv-results-dense') === '1';
    } catch {
      return false;
    }
  });
  const setDense = (d: boolean) => {
    setDenseState(d);
    try {
      window.localStorage.setItem('sv-results-dense', d ? '1' : '0');
    } catch {
      /* the choice just isn't kept */
    }
  };
  /* The results are for the search that ran, not the words still being typed (FD-89). */
  const q = browse ? '' : searched;
  /* The "your search is short for the AI" note, put away for this search only. */

  /* Real search (FD-16, FD-17): the server reads the request, finds slides and says why each fits.
     The filter row narrows the results further here; sorting is a view choice. */
  /* While the card asks whether to use the AI, nothing is shown as found: the slide cards wait, loading, for the answer. */
  const waitingForAi = !browse && !!aiAsk;
  /* Premade decks the request names (FD-31): "Barlow's proposal 2025", "all proposals from 2025".
     Found from the library's own deck facts, at once, before and beside the slide search. */
  const lib = useReadyLibrary();
  const browseResult = useMemo((): SmartSearchResult | null => {
    if (!browse || !applied || !('slides' in lib)) return null;
    const base = tileKind ? lib.slides : browseSlides(browse, lib.slides);
    const items: SmartSearchItem[] = base.map((slide) => ({ slide, why: '', matched: [] }));
    return { query: '', reader: 'stand-in', readerNote: null, chips: [], relaxed: false, items };
  }, [browse, applied, lib, tileKind]);
  const result = browse ? browseResult : !waitingForAi && search.status === 'ready' ? search.result : null;
  const found = useMemo(
    () => (!browse && 'decks' in lib ? findDecks(q, lib.decks.map((d) => ({ ...d, versionId: d.slides[0]?.provenance.sourceVersionId }))) : null),
    [lib, q, browse],
  );
  const shown = useMemo(() => {
    if (!result) return [];
    const kept = result.items.filter((i) => slideMatches(i.slide, filters));
    return sort === 'popular'
      ? [...kept].sort((a, b) => downloadsOf(b.slide) - downloadsOf(a.slide))
      : sort === 'newest'
        ? [...kept].sort((a, b) => (yearOf(b.slide) ?? -1) - (yearOf(a.slide) ?? -1))
        : kept;
  }, [result, filters, sort]);
  /* By section (FD-57; Alina, 28 Oct: "searching for the slides in that particular section… between
     different decks"): each result knows its deck section, so the results can be narrowed to one kind. */
  const pickedSection = filters.section[0] ?? autoSection ?? null;
  /* Back to all sections: a section picked by hand is cleared, and the one the search asked for is turned off for this search. */
  const clearSection = () => {
    patchFilters({ section: [] });
    dismissAutoSection();
  };
  const sectionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of shown) {
      const k = i.slide.section?.kind;
      if (k && SECTION_LABEL[k]) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [shown]);
  const visible = pickedSection ? shown.filter((i) => i.slide.section?.kind === pickedSection) : shown;
  const slides = visible.map((i) => i.slide);
  const deckCount = new Set(slides.map((s) => s.provenance.sourceId)).size;
  useEffect(() => {
    setResultsSummary({ count: slides.length, sort, setSort });
    return () => setResultsSummary(null);
  }, [slides.length, sort]);
  /* Only what the search itself asked for brings in the Sections block; tapping a section pill just narrows the slides, so nothing above them moves. */
  const sectionMode = !!autoSection || sectionsFromSearch.length > 0;
  /* Client, year and slide type already light up in the filter row above. */
  const extraChips = result ? result.chips.filter((c) => !shownInFilterRow(c)) : [];

  const secPills =
    shown.length > 0 && sectionCounts.length > 1 ? (
                <ScrollRow className="sec-pills" role="group" aria-label="Narrow to one section">
                  <span className="meta">By section:</span>
                  {sectionCounts.map(([kind, n]) => (
                    <button key={kind} type="button" className="chip-x" aria-pressed={pickedSection === kind} onClick={() => (pickedSection === kind ? clearSection() : patchFilters({ section: [kind] }))}>
                      {SECTION_LABEL[kind]} <span className="n">{n}</span>
                    </button>
                  ))}
                </ScrollRow>
    ) : null;
  return (
    <div className={`sv-wrap res-wrap${browse ? ' res-browse' : ''}`}>
      <div className="page-head">
        <h1 className="h1 res-title" tabIndex={-1}>
          <span className="res-q">{browse ? (tileKind ? 'Results' : browseTitle(browse)) : `Results for “${q}”`}</span>
          {result && shown.length > 0 && <span className="res-n"> · {plural(visible.length, 'slide')}</span>}
</h1>
      </div>
      {/* Honest misses (FD-34): a name or year asked for that no deck goes by */}
      {found && !found.decks.length && (found.missing.name || found.missing.years.length > 0) && (
        <p className="meta" role="status">
          {found.missing.name ? `No ${found.missing.name} deck in the library.` : `No decks from ${found.missing.years.join(' or ')} in the library.`}
          {result && result.items.length > 0 ? ' The slides below mention it.' : ''}
        </p>
      )}
      {found && found.decks.length > 0 && (
        <Row
          id="found-decks"
          title={found.decks.length === 1 ? 'Deck' : 'Decks'}
          sub={
            found.yearMissing
              ? `No ${found.clients.join(', ')} deck from ${found.years.join(', ')}. Here is what there is.`
              : found.places.length
                ? `Decks for clients in ${found.places.join(' or ')}, as saved. Open one to see every slide.`
                : `The original ${found.decks.length === 1 ? 'deck' : 'decks'}, as saved. Open one to see every slide.`
          }
        >
          {found.decks.map((d) => (
            <li key={d.id}>
              <DeckCard deck={d} />
            </li>
          ))}
        </Row>
      )}
      {!browse && !waitingForAi && search.status === 'error' && (
        <StateBlock error icon="alert" title="Search did not work" text={search.message}>
          <button type="button" className="btn" onClick={retrySearch}>
            Try again
          </button>
        </StateBlock>
      )}
      {browse && !result && 'blocker' in lib && <div style={{ marginTop: 20 }}>{lib.blocker}</div>}
      {browse && !result && !('blocker' in lib) && <SkeletonGrid count={4} />}
      {!browse && (waitingForAi || search.status === 'loading' || search.status === 'idle') && (
        <div role="status" aria-live="polite">
          <p className="thinking">
            <Icon name="spinner" className="spin" />
            {waitingForAi ? 'Waiting for your choice…' : 'Searching…'}
          </p>
          <SkeletonGrid count={4} />
        </div>
      )}
      {result && (
        <>
          {result.reader === 'model' && !result.readerNote && (
            <p className="meta">
              <Icon name="sparkle" className="ic-sm" /> Read by AI.
            </p>
          )}
          {result.readerNote && (
            <p className="meta" role="status">
              <Icon name="alert" className="ic-sm" /> {result.readerNote}
            </p>
          )}
          {extraChips.length > 0 && (
            <div className="interp">
              <span className="meta">
                <Icon name="sparkle" className="ic-sm" />
                We read this as:
              </span>
              {extraChips.map((c) =>
                c.kind === 'Topic' || c.kind === 'Label' ? (
                  <span key={`${c.kind}:${c.label}`} className="chip-x">
                    <span className="k">{c.kind}:</span> {c.label}
                  </span>
                ) : (
                  <button key={`${c.kind}:${c.label}`} type="button" className="chip-x" aria-label={`Remove ${c.kind}: ${c.label}`} onClick={() => setQuery(withoutChip(q, c))}>
                    <span className="k">{c.kind}:</span> {c.label}
                    <Icon name="x" />
                  </button>
                ),
              )}
            </div>
          )}
          {result.relaxed && <p className="meta">Nothing matched every filter, so client, year and category are left out.</p>}
          {/* Results in groups, each with its own heading and room: Decks, then Sections (when asked for), then Slides. */}
          {sectionMode && <SectionCards heading="Sections" results={shown.map((i) => i.slide)} only={autoSection ? [autoSection] : sectionsFromSearch} />}
          {shown.length > 0 && (sectionMode || (found && found.decks.length > 0)) && <h2 className="h2 res-h">Slides</h2>}
          <div className="res-controls">
          <div className="refine">
            {!(browse && (browseKind === 'recent' || browseKind === 'popular')) && (
            <label>
              <span className="refine-lbl">Sort</span>
              <select className="select select-sm" value={sort} onChange={(e) => setSort(e.target.value as 'best' | 'popular' | 'newest')}>
                <option value="best">Best match</option>
                <option value="popular">Most downloaded</option>
                <option value="newest">Newest first</option>
              </select>
            </label>
            )}
            <span className="spacer" />
        {compact && <ColumnsToggle dense={dense} setDense={setDense} />}
          </div>
          {secPills}
          </div>
          {shown.length === 0 && found && found.decks.length > 0 && filterCount(filters) === 0 ? null : shown.length === 0 ? (
            <StateBlock
              icon="search"
              title={browse ? 'No slides here' : `No slides found matching “${q}”`}
              text={
                filterCount(filters) > 0
                  ? `${found && found.decks.length > 0 ? 'The deck above matches your search, but none of its slides fit the filters. ' : ''}${removeHint(filters)}`
                  : browse
                    ? 'Nothing is in this list yet.'
                    : 'Try fewer words, or say it a different way. For example, “team intro” instead of “introduction to our team”.'
              }
            >
              {filterCount(filters) > 0 && (
                <button type="button" className="btn" onClick={clearFilters}>
                  Clear all filters
                </button>
              )}
              {!browse && (
                <button type="button" className="btn" onClick={() => setQuery('')}>
                  Clear search
                </button>
              )}
            </StateBlock>
          ) : (
            <>
              <div className="summary-row">
                <p className="summary" aria-live="polite">
                <strong>{plural(visible.length, 'slide')}</strong> from {plural(deckCount, 'deck')}
              </p>
              </div>
              <div className={`grid${dense ? ' is-dense' : ''}`}>
                {visible.map((i) => (
                  <SlideCard key={i.slide.id} slide={i.slide} list={slides} why={i.why} aiRead={i.aiRead} note={sort === 'popular' ? downloadedNote(i.slide) : undefined} />
                ))}
              </div>
            </>
          )}
          {!browse && <details className="how">
            <summary>How does this search work?</summary>
            <ol>
              <li>Short searches are read by simple rules. A longer question can be read once by an AI model and turned into search words and filters.</li>
              <li>Best matches come first, each with why it fits. Near-identical slides are grouped, never deleted.</li>
            </ol>
          </details>}
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Deck */

/** Where "File created by" comes from, so nobody reads it as the person who made the pitch. */
const FILE_CREATED_TIP = "From the PowerPoint file's own details. For a deck made from a template this can be the template's author and date.";

/** One button that flips between one and two slides across; the icon shows what a tap will switch to. Used wherever slides are in a grid on a phone. */
function ColumnsToggle({ dense, setDense }: { dense: boolean; setDense: (d: boolean) => void }) {
  return (
    <button type="button" className="btn btn-sm btn-icon cols-toggle" aria-label={dense ? 'Show larger cards' : 'Show smaller cards'} onClick={() => setDense(!dense)}>
      <Icon name={dense ? 'expand' : 'columns'} />
    </button>
  );
}

/** A "⋯" button that opens a small list of less-used actions. Closes on a tap outside, on Escape, and after a choice. */
function MoreMenu({ label, items }: { label: string; items: { label: string; icon: IconName; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        wrap.current?.querySelector<HTMLElement>('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="more-menu" ref={wrap}>
      <button type="button" className="btn btn-sm btn-icon" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="more-menu-list" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="more-menu-item"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <Icon name={it.icon} />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The slide numbers a typed range means: both ends kept inside the deck, in order. */
function rangeBounds(count: number, from: string, to: string): [number, number] {
  const a = Math.min(count, Math.max(1, Math.round(Number(from)) || 1));
  const b = Math.min(count, Math.max(1, Math.round(Number(to)) || count));
  return [Math.min(a, b), Math.max(a, b)];
}

/** Selects the number and, a moment later (when an on-screen keyboard has opened), scrolls the box to the middle of what is left of the screen. */
function keepInView(e: React.FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  el.select();
  window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
}

/** "Add slides [10] to [20]": a stretch of the deck into the draft deck at once. The deck page shows only that stretch while this is open. */
function RangeAdd({ slides, from, to, setFrom, setTo, onDone }: { slides: SlideSummary[]; from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; onDone: () => void }) {
  const { updateSelection, toast, announce } = useWorkspace();
  const [lo, hi] = rangeBounds(slides.length, from, to);
  /* Up and down step a number; it stays between 1 and the last slide. */
  const step = (e: React.KeyboardEvent<HTMLInputElement>, text: string, set: (v: string) => void) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const now = Math.round(Number(text)) || 1;
    set(String(Math.min(slides.length, Math.max(1, now + (e.key === 'ArrowUp' ? 1 : -1)))));
  };
  const add = () => {
    const picked = slides.slice(lo - 1, hi);
    updateSelection((cur) => [...cur, ...picked.filter((s) => !cur.some((c) => c.id === s.id))]);
    toast(`Added slides ${lo} to ${hi}`);
    announce(`${plural(picked.length, 'slide')} added to draft deck`);
    onDone();
  };
  return (
    <form
      className="range-add"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <span>Add slides</span>
      <input className="num-jump" inputMode="numeric" pattern="[0-9]*" maxLength={String(slides.length).length} enterKeyHint="next" autoComplete="off" aria-label={`From slide, a number from 1 to ${slides.length}`} value={from} onFocus={keepInView} onBlur={() => setFrom(String(Math.min(slides.length, Math.max(1, Math.round(Number(from)) || 1))))} onChange={(e) => setFrom(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => step(e, from, setFrom)} />
      <span>to</span>
      <input className="num-jump" inputMode="numeric" pattern="[0-9]*" maxLength={String(slides.length).length} enterKeyHint="go" autoComplete="off" aria-label={`To slide, a number from 1 to ${slides.length}`} value={to} onFocus={keepInView} onBlur={() => setTo(String(Math.min(slides.length, Math.max(1, Math.round(Number(to)) || slides.length))))} onChange={(e) => setTo(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => step(e, to, setTo)} />
      <button type="submit" className="btn btn-sm btn-primary">
        Add {hi - lo + 1}
      </button>
      <button type="button" className="btn btn-sm btn-ghost btn-icon range-close" aria-label="Close, and show the whole deck" onClick={onDone}>
        <Icon name="x" />
      </button>
    </form>
  );
}

/**
 * Phone deck page: "Go to slide [n] of N" and the one / two across choice. Once you scroll past it, the same
 * thing stays at the top of the screen with the number following the slide you are looking at, and a button
 * that takes you back to the top.
 */
function DeckJump({ slides, dense, setDense }: { slides: SlideSummary[]; dense: boolean; setDense: (d: boolean) => void }) {
  const { scroll } = useRoot();
  const row = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(1);
  const [stuck, setStuck] = useState(false);
  const go = (index: number) => {
    setAt(index + 1);
    const card = [...document.querySelectorAll<HTMLElement>('[data-card]')].find((c) => c.getAttribute('data-card') === slides[index]?.id);
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  /* Which slide is at the top of the screen, and whether the row has scrolled out of sight. */
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setStuck((row.current?.getBoundingClientRect().bottom ?? 1) < 0);
      const cards = document.querySelectorAll<HTMLElement>('.grid > [data-card]');
      for (let k = 0; k < cards.length; k++) {
        if (cards[k].getBoundingClientRect().bottom > 72) {
          setAt(k + 1);
          break;
        }
      }
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener('scroll', on, { passive: true });
    return () => {
      el.removeEventListener('scroll', on);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scroll]);
  const goBox = <NumberJump value={at} max={slides.length} label="Go to a slide in this deck" onGo={go} always />;
  const toggle = <ColumnsToggle dense={dense} setDense={setDense} />;
  return (
    <>
      <div className="deck-jump" ref={row}>
        <span className="deck-jump-go">
          Go to slide {!stuck && goBox} of {slides.length}
        </span>
        {toggle}
      </div>
      {stuck && (
        <div className="deck-sticky">
          <button type="button" className="btn btn-sm btn-icon" aria-label="Back to the top" onClick={() => scroll.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
            <Icon name="up" />
          </button>
          <span className="deck-jump-go">
            Slide {goBox} of {slides.length}
          </span>
          {toggle}
        </div>
      )}
    </>
  );
}

export function DeckView({ id }: { id: string }) {
  const { library, openDownload, openArchiveDialog, setIncludeHidden } = useWorkspace();
  const compact = useWorkspacePhoneLike();
  const onPhone = useWorkspaceCompact();
  const tablet = compact && !onPhone; /* upright tablet: room to show "Add a range" as a button */
  const [grouping, setGrouping] = useState(false);
  /* One or two across is remembered on this device. */
  const [dense, setDenseState] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('sv-deck-dense') === '1';
    } catch {
      return false; /* storage can be off; the choice just isn't kept */
    }
  });
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeFrom, setRangeFrom] = useState('1');
  const [rangeTo, setRangeTo] = useState('');
  const setDense = (d: boolean) => {
    setDenseState(d);
    try {
      window.localStorage.setItem('sv-deck-dense', d ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  const lib = useReadyLibrary();
  const deck = library.status === 'ready' ? library.decks.find((d) => d.id === id) : undefined;
  if ('blocker' in lib) return <div className="sv-wrap">{lib.blocker}</div>;
  if (!deck) {
    return (
      <div className="sv-wrap">
        <StateBlock icon="search" title="Deck not found" text="It may have been removed.">
          <Link className="btn" to={{ view: 'pages' }}>
            Back to Home
          </Link>
        </StateBlock>
      </div>
    );
  }
  const openRange = () => {
    setRangeFrom('1');
    setRangeTo(String(deck.slides.length));
    setRangeOpen(true);
  };
  /* While the range box is open, only those slides are shown below it; they keep their numbers from the deck. */
  const [rangeLo, rangeHi] = rangeOpen ? rangeBounds(deck.slides.length, rangeFrom, rangeTo) : [1, deck.slides.length];
  const shown = rangeOpen ? deck.slides.slice(rangeLo - 1, rangeHi) : deck.slides;
  return (
    <div className="sv-wrap">
      <div className="page-head deck-head">
        <div>
          <h1 className="h1" tabIndex={-1}>
            {deck.title.split('_').map((part, k, all) => (
              <span key={k}>
                {part}
                {k < all.length - 1 && (
                  <>
                    _<wbr />
                  </>
                )}
              </span>
            ))}
          </h1>
          <ScrollRow className="badges deck-badges">
            {deck.archived && <span className="badge badge-archived">Archived</span>}
            {deck.category && <span className="badge">{deck.category}</span>}
            {deck.year && <span className="badge">{deck.year}</span>}
            <span className="badge">
              <Icon name="folder" />
              {folderLabel(deck)}
            </span>
          </ScrollRow>
          {/* One line (it wraps to a second if it must): how many slides, who made the file, who uploaded it. */}
          <p className="lede deck-meta">
            <span className="dm">
              {plural(deck.slides.length, 'slide')}
              {hiddenGap(deck.slides) > 0 && (
                <>
                  {' · '}
                  {hiddenGap(deck.slides)} hidden{' '}
                  <button type="button" className="btn-link" aria-label={`Show ${plural(hiddenGap(deck.slides), 'hidden slide')}`} onClick={() => setIncludeHidden(true)}>
                    Show
                  </button>
                </>
              )}
            </span>
            {deck.createdBy && (
              <span className="dm" title={FILE_CREATED_TIP}>
                Created by {deck.createdBy}
                {dateLabel(deck.createdAt) ? `, ${dateLabel(deck.createdAt)}` : ''}
              </span>
            )}
            {deck.uploadedBy && (
              <span className="dm">
                Uploaded by {deck.uploadedBy}
                {dateLabel(deck.uploadedAt) ? `, ${dateLabel(deck.uploadedAt)}` : ''}
              </span>
            )}
          </p>
        </div>
        {compact ? (
          <div className="row-flex deck-actions">
            <SelectAll slides={deck.slides} />
            {tablet && (
              <button type="button" className="btn btn-sm" aria-pressed={rangeOpen} onClick={() => (rangeOpen ? setRangeOpen(false) : openRange())}>
                <Icon name="plus" />
                <span>Add a range of slides</span>
              </button>
            )}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => openDownload(deck.slides)} aria-label="Download whole deck">
              <Icon name="download" />
              <span>Download</span>
            </button>
            <MoreMenu
              label="More deck actions"
              items={[
                ...(tablet ? [] : [{ label: 'Add a range of slides', icon: 'plus' as const, onClick: openRange }]),
                { label: deck.archived ? 'Restore deck' : 'Archive deck', icon: 'archive', onClick: () => openArchiveDialog({ deck: { id: deck.id, title: deck.title, slideCount: deck.slides.length }, restore: !!deck.archived }) },
                { label: grouping ? 'Stop grouping' : 'Group slides into a pack', icon: 'layers', onClick: () => setGrouping((g) => !g) },
              ]}
            />
            {/* A phone on its side: the deck's tags sit in this row, after a thin divider (hidden elsewhere). */}
            <span className="deck-sep" aria-hidden="true" />
            <div className="deck-tags-inline">
              <DeckTags deck={deck} />
            </div>
          </div>
        ) : (
          <div className="row-flex deck-actions-row">
            <SelectAll slides={deck.slides} />
            <button type="button" className="btn btn-sm" aria-pressed={rangeOpen} onClick={() => (rangeOpen ? setRangeOpen(false) : openRange())}>
              <Icon name="plus" />
              <span>Add a range of slides</span>
            </button>
            <button type="button" className="btn btn-sm" onClick={() => openArchiveDialog({ deck: { id: deck.id, title: deck.title, slideCount: deck.slides.length }, restore: !!deck.archived })}>
              <Icon name="archive" />
              <span>{deck.archived ? 'Restore deck' : 'Archive deck'}</span>
            </button>
            <button type="button" className="btn btn-sm" aria-pressed={grouping} onClick={() => setGrouping((g) => !g)}>
              <Icon name="layers" />
              <span>{grouping ? 'Stop grouping' : 'Group slides into a pack'}</span>
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => openDownload(deck.slides)}>
              <Icon name="download" />
              <span>Download whole deck</span>
            </button>
          </div>
        )}
      </div>
      {rangeOpen && <RangeAdd slides={deck.slides} from={rangeFrom} to={rangeTo} setFrom={setRangeFrom} setTo={setRangeTo} onDone={() => setRangeOpen(false)} />}
      {/* One wrapper so a phone on its side can put "Go to slide" and the tags on the same row (it adds no box on a portrait phone). */}
      <div className="deck-tagbar">
        <div className="deck-tags-main">
          <DeckTags deck={deck} />
        </div>
        {compact && !grouping && <DeckJump slides={shown} dense={dense} setDense={setDense} />}
      </div>
      {grouping ? (
        <GroupTool deckSlides={deck.slides} onDone={() => setGrouping(false)} />
      ) : (
        <div className={`grid${dense ? ' is-dense' : ''}`} style={{ marginTop: 16 }}>
          {shown.map((s, k) => (
            <SlideCard key={s.id} slide={s} list={shown} num={rangeLo + k} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Slide */

function Unknown() {
  return <span className="unknown">Unknown</span>;
}

function FromFolder() {
  return (
    <span className="src" title="This came from the folder name, so it is reliable.">
      <Icon name="folder" />
      From folder
    </span>
  );
}

export function SlideView({ id }: { id: string }) {
  const { runtime, library, openPreview, openDownload, logActivity, packs, selection, addPackToDraft, openArchiveDialog, setIncludeHidden, openAlso } = useWorkspace();
  const compact = useWorkspacePhoneLike();
  const onPhoneNow = useWorkspaceCompact();
  const upright = compact && !onPhoneNow; /* an upright tablet: the cards start opened */
  const shareSlide = useShareSlide(id);
  const { isSaved, toggle: toggleSave } = useSavedToggle();
  const touch = useRef<{ x: number; y: number } | null>(null);
  const { isSelected, setOne } = useCartToggle();
  const lib = useReadyLibrary();
  const slide = library.status === 'ready' ? library.slides.find((s) => s.id === id) : undefined;
  const deck = library.status === 'ready' && slide ? library.decks.find((d) => d.id === slide.provenance.sourceId) : undefined;

  /* Remember the slide we came from so it can slide out while the new one slides in. */
  const [step, setStep] = useState<{ id: string; from: SlideSummary | null; dir: 'next' | 'prev' | null }>({ id, from: null, dir: null });
  if (step.id !== id) {
    const sibsNow = library.status === 'ready' ? library.decks.find((d) => d.slides.some((s) => s.id === id))?.slides : undefined;
    const fromSlide = sibsNow?.find((s) => s.id === step.id) ?? null;
    const dir = fromSlide && sibsNow ? (sibsNow.indexOf(fromSlide) < sibsNow.findIndex((s) => s.id === id) ? 'next' : 'prev') : null;
    setStep({ id, from: fromSlide, dir });
  }
  const [detail, setDetail] = useState<{ id: string; slide: SlideDetail } | { id: string; error: string } | null>(null);
  const { request, onSessionExpired } = runtime;
  useEffect(() => {
    const controller = new AbortController();
    getSlide({ request, onSessionExpired }, id, controller.signal)
      .then((s) => setDetail({ id, slide: s }))
      .catch((e: Error) => e.name !== 'AbortError' && setDetail({ id, error: e.message }));
    return () => controller.abort();
  }, [request, onSessionExpired, id]);
  /* Record a visit to this slide in the signed-in person's activity (kept only after they opt in,
     FD-18). TopTenRow counts these per slide, so two people in the same area still get their own
     ranking. */
  useEffect(() => {
    if (slide) logActivity('viewed', slide.title, slide.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if ('blocker' in lib) return <div className="sv-wrap">{lib.blocker}</div>;
  if (!slide || !deck) {
    return (
      <div className="sv-wrap">
        <StateBlock icon="search" title="Slide not found" text="It may have been removed.">
          <Link className="btn" to={{ view: 'pages' }}>
            Back to Home
          </Link>
        </StateBlock>
      </div>
    );
  }

  const sibs = deck.slides;
  const i = sibs.findIndex((s) => s.id === id);
  const sel = isSelected(id);
  const slidePack = packs.of(id);
  const p = slide.provenance;
  const text = detail && detail.id === id ? ('slide' in detail ? detail.slide.text : null) : undefined;
  const textError = detail && detail.id === id && 'error' in detail ? detail.error : null;
  const more = (library.status === 'ready' ? library.slides : [])
    .filter((s) => s.id !== id && s.provenance.sourceId !== p.sourceId && clientOf(s) === clientOf(slide) && clientOf(s) !== UNKNOWN_CLIENT)
    .slice(0, 10);

  const textBody = (
    <>
      {text === undefined && !textError && <div className="skel" style={{ height: 64 }} aria-hidden="true" />}
      {textError && (
        <p className="err" role="alert">
          {textError}
        </p>
      )}
      {text !== undefined && text !== null && <p className="slide-text">{text || 'This slide has no text.'}</p>}
      <p className="meta" style={{ marginTop: 8 }}>
        Search reads this.
      </p>
    </>
  );
  /* "Also in N other decks": in the row with the actions on a portrait phone; at the left end of the tag row on a phone on its side. */
  const alsoChip =
    slide.alsoIn ? (
      <button type="button" className="btn btn-ghost btn-sm lb-also-chip" aria-label={`Also in ${plural(slide.alsoIn.otherDeckCount, 'other deck')}`} data-tip={`Also in ${plural(slide.alsoIn.otherDeckCount, 'other deck')}`} onClick={() => openAlso(slide)}>
        <Icon name="folders" />
        <span aria-hidden="true">{slide.alsoIn.otherDeckCount}</span>
      </button>
    ) : undefined;
  return (
    <div className="sv-wrap">
      <div className="slide-detail">
        <div>
          <SlideTitle slide={slide} loaded={detail && detail.id === id && 'slide' in detail ? detail.slide : null} />
          {/* The picture and what goes with it; a phone on its side starts the right-hand cards level with the top of this. */}
          <div className="slide-main">
          <div
            className={compact ? 'hero-wrap' : undefined}
            onTouchStart={(e) => {
              if (compact) touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }}
            onTouchEnd={(e) => {
              const t = touch.current;
              touch.current = null;
              if (!compact || !t) return;
              const dx = e.changedTouches[0].clientX - t.x;
              const dy = e.changedTouches[0].clientY - t.y;
              if (Math.abs(dx) > 50 && Math.abs(dy) < 40) {
                const to = sibs[i + (dx < 0 ? 1 : -1)];
                if (to) runtime.navigate({ view: 'slide', id: to.id });
              }
            }}
          >
          <button
            type="button"
            className="big-preview"
            style={{
              display: 'block',
              width: '100%',
              padding: 0,
              cursor: 'pointer',
              background: 'none',
            }}
            aria-label="Open a larger preview"
            onClick={() => openPreview(sibs, i)}
          >
            <div className="slide-stage" style={{ aspectRatio: '16 / 9' }}>
              {step.from && step.dir && (
                <div key={`out-${step.from.id}`} className={`slide-layer slide-out-${step.dir}`} aria-hidden="true">
                  <Thumb slide={step.from} />
                </div>
              )}
              <div key={slide.id} className={`slide-layer${step.dir ? ` slide-in-${step.dir}` : ''}`}>
                <Thumb slide={slide} />
              </div>
            </div>
          </button>
          {compact && (
            <>
              <button type="button" className="hero-btn hero-add" aria-pressed={sel} aria-label={sel ? 'Remove from draft deck' : 'Add to draft deck'} onClick={() => setOne(slide, !sel)}>
                <Icon name="check" />
              </button>
              <span className="hero-corner">
                <button type="button" className={`hero-btn${isSaved(id) ? ' is-saved' : ''}`} aria-pressed={isSaved(id)} aria-label={isSaved(id) ? 'Remove from saved' : 'Save'} onClick={() => toggleSave(slide)}>
                  <Icon name="heart" />
                </button>
              </span>
              <span className="hero-zoom" aria-hidden="true">
                <Icon name="expand" />
              </span>
            </>
          )}
          </div>
          <div className="row-flex slide-stepper" style={{ marginTop: 12, justifyContent: 'center', gap: 14 }}>
            {i > 0 ? (
              <Link className="btn btn-sm btn-icon" to={{ view: 'slide', id: sibs[i - 1].id }} aria-label="Previous slide in this deck" title="Previous slide">
                <Icon name="left" />
              </Link>
            ) : (
              <span className="btn btn-sm btn-icon is-off" aria-hidden="true">
                <Icon name="left" />
              </span>
            )}
            <span className="meta slide-stepper-text">
              <NumberJump value={i + 1} max={sibs.length} label="Go to a slide in this deck" onGo={(k) => runtime.navigate({ view: 'slide', id: sibs[k].id })} />
              /{sibs.length} in deck
              {hiddenGap(sibs) > 0 && (
                <>
                  {' · '}
                  {hiddenGap(sibs)} hidden{' '}
                  <button type="button" className="btn-link" aria-label={`Show ${plural(hiddenGap(sibs), 'hidden slide')}`} onClick={() => setIncludeHidden(true)}>
                    Show
                  </button>
                </>
              )}
            </span>
            {i < sibs.length - 1 ? (
              <Link className="btn btn-sm btn-icon" to={{ view: 'slide', id: sibs[i + 1].id }} aria-label="Next slide in this deck" title="Next slide">
                <Icon name="right" />
              </Link>
            ) : (
              <span className="btn btn-sm btn-icon is-off" aria-hidden="true">
                <Icon name="right" />
              </span>
            )}
          </div>
          {/* Phone: the tags are a scrolling row of pills here, in place of the Tags card (the Add tag pill and the suggestions in a second row). */}
          {compact && <PreviewTags slide={slide} onNavigate={() => undefined} lead={alsoChip && <span className="tag-lead">{alsoChip}</span>} />}
          <SlideEngagement key={slide.id} slide={slide} loaded={detail && detail.id === id && 'slide' in detail ? detail.slide : null} />
          {!compact && (
            <section className="panel slide-text-panel" style={{ marginTop: 16 }}>
              <h2>Text found on the slide</h2>
              {textBody}
            </section>
          )}
          </div>
        </div>
        <div className="stack-panels">
          <section className="panel panel-use">
            <h2>Use this slide</h2>
            <div className="row-flex">
              <button type="button" className="btn btn-sm" aria-pressed={sel} onClick={() => setOne(slide, !sel)}>
                <Icon name="check" />
                <span>{sel ? 'In draft deck' : 'Add to draft deck'}</span>
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void shareSlide()} data-tip="Copy link">
                <Icon name="share" />
                <span>Share</span>
              </button>
              {slidePack && (
                <button type="button" className="btn btn-sm" disabled={slidePack.slideIds.every((pid) => selection.some((x) => x.id === pid))} onClick={() => addPackToDraft(slidePack)}>
                  <Icon name="plus" />
                  <span>Add whole pack ({slidePack.slideIds.length})</span>
                </button>
              )}
              <button type="button" className="btn btn-sm btn-primary" onClick={() => openDownload([slide])}>
                <Icon name="download" />
                <span>Download slide</span>
              </button>
              <Link className="btn btn-sm" to={{ view: 'deck', id: deck.id }}>
                <Icon name="deck" />
                <span>Open deck</span>
              </Link>
            </div>
          </section>
          {slidePack && <PackPanel slide={slide} pack={slidePack} />}
          {!compact && <SlideTagsPanel also={slide.alsoIn ? (
            <button type="button" className="btn btn-ghost btn-sm also-words" onClick={() => openAlso(slide)}>
              <Icon name="folders" />
              <span>Also in {plural(slide.alsoIn.otherDeckCount, 'other deck')}</span>
            </button>
          ) : undefined} slide={slide} loaded={detail && detail.id === id && 'slide' in detail ? detail.slide : null} />}
          <SlideLabelsPanel fold={compact} open={upright} story={(detail && detail.id === id && 'slide' in detail ? detail.slide.story : undefined) ?? slide.story} />
          {compact ? (
            <FoldPanel className="panel-details" open={upright} title="Details" hint={p.sourceTitle}>
              <dl className="trust">

              <dt>Deck</dt>
              <dd className="break-name">
                {p.sourceTitle}
                <button type="button" className="btn-link arch-link" onClick={() => openArchiveDialog({ deck: { id: deck.id, title: deck.title, slideCount: deck.slides.length }, restore: !!deck.archived, fromSlide: slide.title })}>
                  <Icon name="archive" className="ic-sm" />
                  <span className="arch-text">
                    <span className="arch-l">{deck.archived ? 'Restore this deck' : 'Archive this deck'}</span> <span className="arch-n">({deck.slides.length} slides)</span>
                  </span>
                </button>
              </dd>
              <dt>File</dt>
              <dd className="break-name">{p.sourceFileName}</dd>
              </dl>
              <details className="more-det">
                <summary>More</summary>
                <dl className="trust">
              {p.createdBy && (
                <>
                  <dt title={FILE_CREATED_TIP}>File created by</dt>
                  <dd>
                    {p.createdBy}
                    {dateLabel(p.createdAt) ? `, ${dateLabel(p.createdAt)}` : ''}
                  </dd>
                </>
              )}
              {p.uploadedBy && (
                <>
                  <dt>Uploaded by</dt>
                  <dd>
                    {p.uploadedBy}
                    {dateLabel(p.uploadedAt) ? `, ${dateLabel(p.uploadedAt)}` : ''}
                  </dd>
                </>
              )}
              <dt>Client</dt>
              <dd>
                {p.clientName ?? <Unknown />}
                {p.clientName && <FromFolder />}
              </dd>
              <dt>Year</dt>
              <dd>
                {p.deckYear ?? <Unknown />}
                {p.deckYear && <FromFolder />}
              </dd>
              <dt>Category</dt>
              <dd>
                {p.category ?? <Unknown />}
                {p.category && <FromFolder />}
              </dd>
              <dt>Position</dt>
              <dd>
                Slide {p.slideNumber}
                {slide.hiddenInSource ? ', hidden in the source deck' : ''}
              </dd>
                            </dl>
              </details>
            </FoldPanel>
          ) : (
          <section className="panel panel-details">
            <h2>Details</h2>
            <dl className="trust">
              <dt>Deck</dt>
              <dd className="break-name">
                {p.sourceTitle}
                <button type="button" className="btn-link arch-link" onClick={() => openArchiveDialog({ deck: { id: deck.id, title: deck.title, slideCount: deck.slides.length }, restore: !!deck.archived, fromSlide: slide.title })}>
                  <Icon name="archive" className="ic-sm" />
                  <span className="arch-text">
                    <span className="arch-l">{deck.archived ? 'Restore this deck' : 'Archive this deck'}</span> <span className="arch-n">({deck.slides.length} slides)</span>
                  </span>
                </button>
              </dd>
              <dt>File</dt>
              <dd className="break-name">{p.sourceFileName}</dd>
              {p.createdBy && (
                <>
                  <dt title={FILE_CREATED_TIP}>File created by</dt>
                  <dd>
                    {p.createdBy}
                    {dateLabel(p.createdAt) ? `, ${dateLabel(p.createdAt)}` : ''}
                  </dd>
                </>
              )}
              {p.uploadedBy && (
                <>
                  <dt>Uploaded by</dt>
                  <dd>
                    {p.uploadedBy}
                    {dateLabel(p.uploadedAt) ? `, ${dateLabel(p.uploadedAt)}` : ''}
                  </dd>
                </>
              )}
              <dt>Client</dt>
              <dd>
                {p.clientName ?? <Unknown />}
                {p.clientName && <FromFolder />}
              </dd>
              <dt>Year</dt>
              <dd>
                {p.deckYear ?? <Unknown />}
                {p.deckYear && <FromFolder />}
              </dd>
              <dt>Category</dt>
              <dd>
                {p.category ?? <Unknown />}
                {p.category && <FromFolder />}
              </dd>
              <dt>Position</dt>
              <dd>
                Slide {p.slideNumber}
                {slide.hiddenInSource ? ', hidden in the source deck' : ''}
              </dd>
            </dl>
          </section>
          )}
          {compact && (
            <FoldPanel className="slide-text-panel" open={upright} title="Slide text" hint={text ? text.slice(0, 70) : text === null ? undefined : text === '' ? 'No text' : undefined}>
              {textBody}
            </FoldPanel>
          )}
        </div>
      </div>
      {more.length > 0 && (
        <Row id="more" title={`More from ${clientOf(slide)}`}>
          {more.map((s) => (
            <li key={s.id}>
              <SlideCard slide={s} list={more} />
            </li>
          ))}
        </Row>
      )}
    </div>
  );
}

/* ------------------------------------------------------- Create, Upload */

export function CreateView() {
  const { runtime } = useWorkspace();
  const opened = useTipSeen('storyboard-opened');
  return (
    <div className="sv-wrap create-wrap">
      <h1 className="h1" tabIndex={-1}>
        Create
      </h1>
      <p className="lede muted" style={{ marginTop: 4, maxWidth: '60ch' }}>
        Two ways to put a deck together.
      </p>
      <div className="create-cards">
        <button
          type="button"
          className="card create-card create-card-ai"
          onClick={() => {
            opened.dismiss();
            runtime.navigate({ view: 'story' });
          }}
        >
          <Icon name="sparkle" className="ic-big" />
          <h2 className="h2">Build with AI</h2>
          <p className="meta">Describe the client and SlideVault pulls a story from your slides.</p>
          <span className="create-go">
            Open the Storyboard
            <Icon name="right" className="ic-sm" />
          </span>
        </button>
        <div className="card create-card create-card-planned">
          <Icon name="plus" className="ic-big" />
          <h2 className="h2">Build it yourself</h2>
          <p className="meta">
            For now, build it from{' '}
            <Link to={{ view: 'pages' }} className="create-home">
              Home
            </Link>
            .
          </p>
          <span className="badge" style={{ alignSelf: 'flex-start' }}>
            Planned
          </span>
        </div>
      </div>
    </div>
  );
}

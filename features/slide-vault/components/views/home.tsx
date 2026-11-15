'use client';

import { Button } from '../ui/Button';
import { SectionBrowse } from '../SectionCards';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { SlideSummary } from '../../contracts/dto';
import { Icon } from '../icons';
import { browseSlides, categoryOf, clientOf, countBy, deckMatches, downloadedNote, filterCount, removeHint, plural, slideMatches, yearOf } from '../library';
import { DeckCard, Link, SlideCard, StateBlock } from '../parts';
import { MicButton } from '../MicButton';
import { TRY_QUERIES } from '../Rail';
import { FilterBar } from '../FilterBar';
import { setHeroOut } from '../../client/hero-visibility';
import { useEdgeFade } from '../edge-fade';
import { useWorkspaceFiltersRolled } from '../size';
import { HiddenToggle } from '../HiddenToggle';
import { useRoot } from '../root';
import { useAccount, useRuntime, useSearch } from '../state';
import { StoryLauncher } from '../StoryLauncher';
import { ROW_LIMIT, TileRow, Row, TopTenRow, useReadyLibrary } from './shared';
import { ResultsView } from './results';

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
  const { runtime } = useRuntime();
  const { query, typeQuery, submitSearch, searched, filters } = useSearch();
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
  const { runtime } = useRuntime();
  const { query, setQuery, typeQuery, submitSearch, searched } = useSearch();
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
      /* Only a pinned tabs row covers the top of the page; on desktop the header scrolls away, so nothing is subtracted. */
      const top = document.querySelector<HTMLElement>('.slidevault .sv-top');
      const pinned = !!top && /sticky|fixed/.test(getComputedStyle(top).position);
      const tabs = pinned ? top.offsetHeight : 0;
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
        {!compact && <HiddenToggle place="hero" />}
      </form>
      {/* On a phone the eye and the Storyboard button sit in the row under the search bar (FilterBar); only the brief hint stays here. */}
      <StoryLauncher part={compact ? 'hint' : 'all'} />
    </div>
  );
}

/** The search bar, filter row and example searches: the top of Home and of the browse lists. */
export function SearchHeader() {
  return (
    <>
      <HomeHeader />
      <FilterBar />
      <HomeTry />
    </>
  );
}

export function HomeView() {
  const { searched, filters } = useSearch();
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
  const { filters, clearFilters } = useSearch();
  const { savedIds, activity } = useAccount();
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
              <Button  onClick={clearFilters}>
                Clear all filters
              </Button>
            </StateBlock>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Browse */

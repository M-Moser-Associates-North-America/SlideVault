'use client';

import { SlideTitle } from './RenameSlide';
import { SlideEngagement, useShareSlide } from './SlideActions';
import { SectionBrowse, SectionCards } from './SectionCards';
import { DeckTags, SlideLabelsPanel, SlideTagsPanel } from './TagBits';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { getSlide } from '../client/api';
import type { SlideDetail, SlideSummary } from '../contracts/dto';
import { Icon } from './icons';
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
import { DeckCard, Link, SkeletonGrid, SkeletonRows, SlideCard, StateBlock, Thumb, useCartToggle } from './parts';
import { MicButton } from './MicButton';
import { TRY_QUERIES } from './Rail';
import { FilterBar } from './FilterBar';
import { setHeroOut } from '../client/hero-visibility';
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
  const { query, setQuery, runtime } = useWorkspace();
  const search = (q: string) => {
    setQuery(q);
    if (runtime.location.view !== 'pages') runtime.navigate({ view: 'pages' });
  };
  return (
    <div className="home-try">
      <div className="home-hero-try">
        <span>Try</span>
        <ul>
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
  const { query, setQuery, submitSearch, runtime } = useWorkspace();
  const [touched, setTouched] = useState(heroTouched);
  const showHint = query === '' && !touched;
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
    <div className="home-hero">
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
              setQuery(e.target.value);
              /* Typing on a page that can't show results (a client or year list) takes you to Home's results. */
              if (e.target.value && runtime.location.view !== 'pages') runtime.navigate({ view: 'pages' });
            }} placeholder={touched ? 'Slides, clients or topics' : undefined} onFocus={() => {
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
            setQuery(t);
          }} />
          <button type="submit" className="home-hero-btn" aria-label="Search">
            <Icon name="search" />
          </button>
        </span>
        <HiddenToggle />
      </form>
      <StoryLauncher />
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
  const { query, filters } = useWorkspace();
  const searching = query.trim() !== '';
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
        <b>{v}</b>
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
            <Row id="best" title="Best of the Best" sub="Hand-picked slides. Row names TBD." seeAll="best" total={best.length}>
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
      <BrowsePage id={id} />
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
    <button type="button" className="btn btn-sm" onClick={click}>
      <Icon name="check" />
      <span>{all ? 'Remove all from draft deck' : `Add all ${slides.length} to draft deck`}</span>
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

export function ResultsView() {
  const { query, search, filters, patchFilters, clearFilters, retrySearch, setQuery, askAiAnyway, autoSection, sectionsFromSearch, dismissAutoSection } = useWorkspace();
  const [sort, setSort] = useState<'best' | 'popular' | 'newest'>('best');
  const q = query.trim();
  /* The "your search is short for the AI" note, put away for this search only. */
  const [dismissedShort, setDismissedShort] = useState('');

  /* Real search (FD-16, FD-17): the server reads the request, finds slides and says why each fits.
     The filter row narrows the results further here; sorting is a view choice. */
  const result = search.status === 'ready' ? search.result : null;
  /* Premade decks the request names (FD-31): "Barlow's proposal 2025", "all proposals from 2025".
     Found from the library's own deck facts, at once, before and beside the slide search. */
  const lib = useReadyLibrary();
  const found = useMemo(
    () => ('decks' in lib ? findDecks(q, lib.decks.map((d) => ({ ...d, versionId: d.slides[0]?.provenance.sourceVersionId }))) : null),
    [lib, q],
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
  const grouped = shown.filter((i) => i.slide.alsoIn).length;
  const sectionMode = !!pickedSection || sectionsFromSearch.length > 0;
  /* Client, year and slide type already light up in the filter row above. */
  const extraChips = result ? result.chips.filter((c) => !shownInFilterRow(c)) : [];

  return (
    <div className="sv-wrap">
      <div className="page-head">
        <h1 className="h1" tabIndex={-1}>
          Results for “{q}”
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
      {search.status === 'error' && (
        <StateBlock error icon="alert" title="Search did not work" text={search.message}>
          <button type="button" className="btn" onClick={retrySearch}>
            Try again
          </button>
        </StateBlock>
      )}
      {(search.status === 'loading' || search.status === 'idle') && (
        <div role="status" aria-live="polite">
          <p className="thinking">
            <Icon name="spinner" className="spin" />
            Reading your request, matching slides, checking why each one fits…
          </p>
          <SkeletonGrid count={4} />
        </div>
      )}
      {result && (
        <>
          {result.aiSkipped === 'short' && dismissedShort !== q && (
            <div className="ai-note" role="status">
              <Icon name="alert" className="ic-sm" />
              <span>This is a short search, and a regular search usually handles those well. Do you still want the AI to read it?</span>
              <button type="button" className="btn" onClick={askAiAnyway}>
                Yes, use AI
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setDismissedShort(q)}>
                No, keep these results
              </button>
            </div>
          )}
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
          {result.relaxed && <p className="meta">Nothing matched every detail, so these results leave out the client, year or category filter.</p>}
          {/* Results in groups, each with its own heading and room: Decks, then Sections (when asked for), then Slides. */}
          {sectionMode && <SectionCards heading="Sections" results={pickedSection ? slides : shown.map((i) => i.slide)} only={pickedSection ? [pickedSection] : sectionsFromSearch} />}
          {shown.length > 0 && (sectionMode || (found && found.decks.length > 0)) && <h2 className="h2 res-h">Slides</h2>}
          <div className="refine">
            <label>
              Sort
              <select className="select select-sm" value={sort} onChange={(e) => setSort(e.target.value as 'best' | 'popular' | 'newest')}>
                <option value="best">Best match</option>
                <option value="popular">Most downloaded</option>
                <option value="newest">Newest first</option>
              </select>
            </label>
            <span className="spacer" />
            {slides.length > 0 && <SelectAll slides={slides} />}
          </div>
          {shown.length === 0 && found && found.decks.length > 0 && filterCount(filters) === 0 ? null : shown.length === 0 ? (
            <StateBlock
              icon="search"
              title={`No slides found matching “${q}”`}
              text={
                filterCount(filters) > 0
                  ? `${found && found.decks.length > 0 ? 'The deck above matches your search, but none of its slides fit the filters. ' : ''}${removeHint(filters)}`
                  : 'Try fewer words, or say it a different way. For example, “team intro” instead of “introduction to our team”.'
              }
            >
              {filterCount(filters) > 0 && (
                <button type="button" className="btn" onClick={clearFilters}>
                  Clear all filters
                </button>
              )}
              <button type="button" className="btn" onClick={() => setQuery('')}>
                Clear search
              </button>
            </StateBlock>
          ) : (
            <>
              <p className="summary" aria-live="polite">
                <strong>{plural(visible.length, 'slide')}</strong> from {plural(deckCount, 'deck')}
                <span className="helpdot" tabIndex={0} role="img" aria-label={`Best matches first.${grouped > 0 ? ' Near-identical copies are grouped under “Also in…”.' : ''}`} data-tip={`Best matches first.${grouped > 0 ? ' Near-identical copies are grouped under “Also in…”.' : ''}`}>
                  <Icon name="info" />
                </span>
              </p>
              {pickedSection && shown.length - visible.length > 0 && (
                <p className="meta sec-hidden-note">
                  {shown.length - visible.length} more matching {shown.length - visible.length === 1 ? 'slide is' : 'slides are'} outside this section.{' '}
                  <button type="button" className="btn-link" onClick={clearSection}>
                    Show {shown.length - visible.length === 1 ? 'it' : 'them'}
                  </button>
                </p>
              )}
              {sectionCounts.length > 1 && (
                <div className="sec-pills" role="group" aria-label="Narrow to one section">
                  <span className="meta">By section:</span>
                  <button type="button" className="chip-x" aria-pressed={!pickedSection} onClick={clearSection}>
                    All <span className="n">{shown.length}</span>
                  </button>
                  {sectionCounts.map(([kind, n]) => (
                    <button key={kind} type="button" className="chip-x" aria-pressed={pickedSection === kind} onClick={() => (pickedSection === kind ? clearSection() : patchFilters({ section: [kind] }))}>
                      {SECTION_LABEL[kind]} <span className="n">{n}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="grid">
                {visible.map((i) => (
                  <SlideCard key={i.slide.id} slide={i.slide} list={slides} why={i.why} note={sort === 'popular' ? downloadedNote(i.slide) : undefined} />
                ))}
              </div>
            </>
          )}
          <details className="how">
            <summary>How does this search work?</summary>
            <ol>
              <li>Short searches like “team” or “Kestrel Law 2024” are read by simple rules, instantly.</li>
              <li>When you press Enter on a question or a sentence, an AI model reads it once and turns it into search words and filters. Filters you didn’t ask for are dropped.</li>
              <li>Slides are matched on those words and filters, best match first, and each result says why it fits from what is actually on the slide. Near-identical slides are grouped, never deleted.</li>
            </ol>
          </details>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Deck */

/** Where "File created by" comes from, so nobody reads it as the person who made the pitch. */
const FILE_CREATED_TIP = "From the PowerPoint file's own details. For a deck made from a template this can be the template's author and date.";

export function DeckView({ id }: { id: string }) {
  const { library, openDownload, openArchiveDialog, setIncludeHidden } = useWorkspace();
  const [grouping, setGrouping] = useState(false);
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
  return (
    <div className="sv-wrap">
      <div className="page-head">
        <div>
          <h1 className="h1" tabIndex={-1}>
            {deck.title}
          </h1>
          <div className="badges" style={{ marginTop: 8 }}>
            {deck.archived && <span className="badge badge-archived">Archived</span>}
            {deck.category && <span className="badge">{deck.category}</span>}
            {deck.year && <span className="badge">{deck.year}</span>}
            <span className="badge">
              <Icon name="folder" />
              {folderLabel(deck)}
            </span>
          </div>
          <p className="lede">
            {plural(deck.slides.length, 'slide')} in this deck.
            {hiddenGap(deck.slides) > 0 && (
              <>
                {' '}
                {plural(hiddenGap(deck.slides), 'hidden slide')} not shown.{' '}
                <button type="button" className="btn-link" onClick={() => setIncludeHidden(true)}>
                  Show {hiddenGap(deck.slides) === 1 ? 'it' : 'them'}
                </button>
              </>
            )}
          </p>
          {(deck.createdBy || deck.uploadedBy) && (
            <p className="meta deck-who">
              {deck.createdBy && <span title={FILE_CREATED_TIP}>File created by {deck.createdBy}{dateLabel(deck.createdAt) ? ` · ${dateLabel(deck.createdAt)}` : ''}</span>}
              {deck.uploadedBy && <span>Uploaded by {deck.uploadedBy}{dateLabel(deck.uploadedAt) ? ` · ${dateLabel(deck.uploadedAt)}` : ''}</span>}
            </p>
          )}
        </div>
        <div className="row-flex">
          <SelectAll slides={deck.slides} />
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
      </div>
      <DeckTags deck={deck} />
      {grouping ? (
        <GroupTool deckSlides={deck.slides} onDone={() => setGrouping(false)} />
      ) : (
        <div className="grid" style={{ marginTop: 16 }}>
          {deck.slides.map((s) => (
            <SlideCard key={s.id} slide={s} list={deck.slides} />
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
  const { runtime, library, openPreview, openDownload, logActivity, packs, selection, addPackToDraft, openArchiveDialog, setIncludeHidden } = useWorkspace();
  const shareSlide = useShareSlide(id);
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

  return (
    <div className="sv-wrap">
      <div className="slide-detail">
        <div>
          <SlideTitle slide={slide} loaded={detail && detail.id === id && 'slide' in detail ? detail.slide : null} />
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
          <div className="row-flex" style={{ marginTop: 12, justifyContent: 'center', gap: 14 }}>
            {i > 0 ? (
              <Link className="btn btn-sm btn-icon" to={{ view: 'slide', id: sibs[i - 1].id }} aria-label="Previous slide in this deck" title="Previous slide">
                <Icon name="left" />
              </Link>
            ) : (
              <span className="btn-icon" style={{ width: 36 }} />
            )}
            <span className="meta">
              Slide {p.slideNumber} of {sibs.length + hiddenGap(sibs)} in this deck
              {hiddenGap(sibs) > 0 && (
                <>
                  {' · '}
                  {plural(hiddenGap(sibs), 'hidden slide')} not shown.{' '}
                  <button type="button" className="btn-link" onClick={() => setIncludeHidden(true)}>
                    Show {hiddenGap(sibs) === 1 ? 'it' : 'them'}
                  </button>
                </>
              )}
            </span>
            {i < sibs.length - 1 ? (
              <Link className="btn btn-sm btn-icon" to={{ view: 'slide', id: sibs[i + 1].id }} aria-label="Next slide in this deck" title="Next slide">
                <Icon name="right" />
              </Link>
            ) : (
              <span className="btn-icon" style={{ width: 36 }} />
            )}
          </div>
          <SlideEngagement key={slide.id} slide={slide} loaded={detail && detail.id === id && 'slide' in detail ? detail.slide : null} />
          <section className="panel" style={{ marginTop: 16 }}>
            <h2>Text found on the slide</h2>
            {text === undefined && !textError && <div className="skel" style={{ height: 64 }} aria-hidden="true" />}
            {textError && (
              <p className="err" role="alert">
                {textError}
              </p>
            )}
            {text !== undefined && text !== null && <p className="slide-text">{text || 'This slide has no text.'}</p>}
            <p className="meta" style={{ marginTop: 8 }}>
              Search reads this text.
            </p>
          </section>
        </div>
        <div className="stack-panels">
          <section className="panel">
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
          <SlideTagsPanel slide={slide} loaded={detail && detail.id === id && 'slide' in detail ? detail.slide : null} />
          <SlideLabelsPanel story={(detail && detail.id === id && 'slide' in detail ? detail.slide.story : undefined) ?? slide.story} />
          <section className="panel">
            <h2>Details</h2>
            <dl className="trust">
              <dt>Deck</dt>
              <dd>
                {p.sourceTitle}
                <button type="button" className="btn-link arch-link" onClick={() => openArchiveDialog({ deck: { id: deck.id, title: deck.title, slideCount: deck.slides.length }, restore: !!deck.archived, fromSlide: slide.title })}>
                  <Icon name="archive" className="ic-sm" />
                  {deck.archived ? `Restore this deck (${deck.slides.length} slides)` : `Archive this deck (${deck.slides.length} slides)`}
                </button>
              </dd>
              <dt>File</dt>
              <dd>{p.sourceFileName}</dd>
              {p.createdBy && (
                <>
                  <dt title={FILE_CREATED_TIP}>File created by</dt>
                  <dd>
                    {p.createdBy}
                    {dateLabel(p.createdAt) ? ` · ${dateLabel(p.createdAt)}` : ''}
                  </dd>
                </>
              )}
              {p.uploadedBy && (
                <>
                  <dt>Uploaded by</dt>
                  <dd>
                    {p.uploadedBy}
                    {dateLabel(p.uploadedAt) ? ` · ${dateLabel(p.uploadedAt)}` : ''}
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
          {slide.alsoIn && (
            <section className="panel">
              <h2>Also in {plural(slide.alsoIn.otherDeckCount, 'other deck')}</h2>
              <p className="meta">{slide.alsoIn.match === 'near' ? 'Nearly identical slides' : 'The same slide'} appear in other decks. Nothing is deleted.</p>
            </section>
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
    <div className="sv-wrap">
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
            Step by step, from a blank deck. For now,{' '}
            <Link to={{ view: 'pages' }} className="create-home">
              go to Home
            </Link>{' '}
            and build.
          </p>
          <span className="badge" style={{ alignSelf: 'flex-start' }}>
            Planned
          </span>
        </div>
      </div>
    </div>
  );
}

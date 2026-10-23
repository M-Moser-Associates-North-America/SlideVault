'use client';

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
  deckMatches,
  downloadedNote,
  downloadsOf,
  filterCount,
  folderLabel,
  removeHint,
  plural,
  slideMatches,
  UNKNOWN_CLIENT,
  yearOf,
  type Deck,
} from './library';
import { DeckCard, Link, SkeletonGrid, SkeletonRows, SlideCard, StateBlock, Thumb, useCartToggle } from './parts';
import { TRY_QUERIES } from './Rail';
import { FilterBar } from './FilterBar';
import { setHeroOut } from '../client/hero-visibility';
import { shownInFilterRow, withoutChip } from './search-reading';
import { useRoot } from './root';
import { useWorkspace } from './state';

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
  /* Tell the header when this bar has scrolled up out of sight, so it can show a slim search shortcut. */
  const formRef = useRef<HTMLFormElement>(null);
  const { scroll } = useRoot();
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setHeroOut(!entry.isIntersecting), { root: scroll.current, rootMargin: '-110px 0px 0px 0px' });
    io.observe(el);
    return () => {
      io.disconnect();
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
      document.getElementById('sv-hero-q')?.focus();
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
          <button type="submit" className="home-hero-btn" aria-label="Search">
            <Icon name="search" />
          </button>
        </span>
      </form>
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
  const { query } = useWorkspace();
  const searching = query.trim() !== '';
  return (
    <>
      {!searching && (
        <h1 className="sr-only" tabIndex={-1}>
          Home
        </h1>
      )}
      <SearchHeader />
      {searching ? <ResultsView /> : <LibraryView />}
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
  const { query, search, filters, clearFilters, retrySearch, setQuery } = useWorkspace();
  const [sort, setSort] = useState<'best' | 'popular' | 'newest'>('best');
  const q = query.trim();

  /* Real search (FD-16, FD-17): the server reads the request, finds slides and says why each fits.
     The filter row narrows the results further here; sorting is a view choice. */
  const result = search.status === 'ready' ? search.result : null;
  const shown = useMemo(() => {
    if (!result) return [];
    const kept = result.items.filter((i) => slideMatches(i.slide, filters));
    return sort === 'popular'
      ? [...kept].sort((a, b) => downloadsOf(b.slide) - downloadsOf(a.slide))
      : sort === 'newest'
        ? [...kept].sort((a, b) => (yearOf(b.slide) ?? -1) - (yearOf(a.slide) ?? -1))
        : kept;
  }, [result, filters, sort]);
  const slides = shown.map((i) => i.slide);
  const deckCount = new Set(slides.map((s) => s.provenance.sourceId)).size;
  const grouped = shown.filter((i) => i.slide.alsoIn).length;
  /* Client, year and slide type already light up in the filter row above. */
  const extraChips = result ? result.chips.filter((c) => !shownInFilterRow(c)) : [];

  return (
    <div className="sv-wrap">
      <div className="page-head">
        <h1 className="h1" tabIndex={-1}>
          Results for “{q}”
        </h1>
      </div>
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
                c.kind === 'Topic' ? (
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
          {shown.length === 0 ? (
            <StateBlock
              icon="search"
              title={`No slides match “${q}”`}
              text={filterCount(filters) > 0 ? removeHint(filters) : 'Try fewer words, or say it a different way. For example, “team intro” instead of “introduction to our team”.'}
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
                <strong>{plural(shown.length, 'slide')}</strong> from {plural(deckCount, 'deck')}. Best matches first.
                {grouped > 0 ? ` Near-identical copies are grouped under “Also in…”.` : ''}
              </p>
              <div className="grid">
                {shown.map((i) => (
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

export function DeckView({ id }: { id: string }) {
  const { library, openDownload } = useWorkspace();
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
            {deck.category && <span className="badge">{deck.category}</span>}
            {deck.year && <span className="badge">{deck.year}</span>}
            <span className="badge">
              <Icon name="folder" />
              {folderLabel(deck)}
            </span>
          </div>
          <p className="lede">{plural(deck.slides.length, 'slide')} in this deck.</p>
        </div>
        <div className="row-flex">
          <SelectAll slides={deck.slides} />
          <button type="button" className="btn btn-sm btn-primary" onClick={() => openDownload(deck.slides)}>
            <Icon name="download" />
            <span>Download whole deck</span>
          </button>
        </div>
      </div>
      <div className="grid" style={{ marginTop: 16 }}>
        {deck.slides.map((s) => (
          <SlideCard key={s.id} slide={s} list={deck.slides} />
        ))}
      </div>
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
  const { runtime, library, openPreview, openDownload, logActivity } = useWorkspace();
  const { isSelected, set } = useCartToggle();
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
          <h1 className="h1" tabIndex={-1} style={{ marginBottom: 12 }}>
            {slide.title}
          </h1>
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
              Slide {p.slideNumber} of {sibs.length} in this deck
            </span>
            {i < sibs.length - 1 ? (
              <Link className="btn btn-sm btn-icon" to={{ view: 'slide', id: sibs[i + 1].id }} aria-label="Next slide in this deck" title="Next slide">
                <Icon name="right" />
              </Link>
            ) : (
              <span className="btn-icon" style={{ width: 36 }} />
            )}
          </div>
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
              <button type="button" className="btn btn-sm" aria-pressed={sel} onClick={() => set(slide, !sel)}>
                <Icon name="check" />
                <span>{sel ? 'Selected' : 'Select'}</span>
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => openDownload([slide])}>
                <Icon name="download" />
                <span>Download only this slide</span>
              </button>
              <Link className="btn btn-sm" to={{ view: 'deck', id: deck.id }}>
                Open deck
              </Link>
            </div>
          </section>
          <section className="panel">
            <h2>Details</h2>
            <dl className="trust">
              <dt>Deck</dt>
              <dd>{p.sourceTitle}</dd>
              <dt>File</dt>
              <dd>{p.sourceFileName}</dd>
              <dt>Folder</dt>
              <dd>
                {folderLabel(deck)}
                <FromFolder />
              </dd>
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
  return (
    <div className="sv-wrap">
      <h1 className="h1" tabIndex={-1}>
        Create
      </h1>
      <p className="lede muted" style={{ marginTop: 4, maxWidth: '60ch' }}>
        Planned feature. Deck building will be added in the next phase.
      </p>
      <div className="ph-cards">
        <div className="card">
          <Icon name="plus" className="ic-big" />
          <h2 className="h2">Build</h2>
          <p className="meta">Start a new deck and fill it with slides from Home.</p>
          <span className="badge" style={{ alignSelf: 'flex-start' }}>
            Planned
          </span>
        </div>
      </div>
      <div className="notice info" style={{ marginTop: 20 }}>
        <Icon name="info" />
        <span>For now, select slides on Home and download them. Slides from one deck come as one file. Slides from several decks come as a zip.</span>
      </div>
    </div>
  );
}

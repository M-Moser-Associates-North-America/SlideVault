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
  filterCount,
  folderLabel,
  removeHint,
  plural,
  slideMatches,
  sortNewest,
  UNKNOWN_CLIENT,
  yearOf,
  type Deck,
} from './library';
import { DeckCard, Link, SimFlag, SkeletonGrid, SkeletonRows, SlideCard, StateBlock, StatusBadge, Thumb, useCartToggle } from './parts';
import { TRY_QUERIES } from './Rail';
import { FilterBar } from './FilterBar';
import { useTipSeen } from '../client/tip-store';
import { setHeroOut } from '../client/hero-visibility';
import { chipShownInFilterRow, simParse, simSearch, simTags, simTier, simUsed, stripFromQuery, TIER_TEXT } from './simulation';
import { useWorkspace } from './state';

const ROW_LIMIT = 12;

/** Small, deterministic string hash -- picks the same "lane" for the same profile every time. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

/** One horizontally scrolling row of cards, with "See all". */
function Row({ id, title, sub, seeAll, total, sim, children }: { id: string; title: string; sub?: string; seeAll?: string; total?: number; sim?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const measure = () => {
    const el = ref.current;
    if (el) setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 6);
  };
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });
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
          {(sub || sim) && (
            <button
              type="button"
              className="row-info"
              data-tip={[sub, sim ? 'Simulated for now: not connected to real data yet.' : ''].filter(Boolean).join(' ')}
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
      <ul ref={ref} className={`row-scroller${atEnd ? ' at-end' : ''}`} onScroll={measure}>
        {children}
      </ul>
    </section>
  );
}

/**
 * Local design prototype: "Today's Top 10"-style row, with the big outlined rank numbers from
 * the Netflix reference video, rather than the small corner ribbon the rest of the app uses
 * (not pushed, not part of Khushali's approved build).
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

function FilterNote() {
  const { filters, clearFilters } = useWorkspace();
  if (!filterCount(filters)) return null;
  return (
    <p className="f-note">
      <Icon name="check" className="ic-sm" />
      Filters on: only matching slides are shown.
      <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
        Clear filters
      </button>
    </p>
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
 * Local-only design prototype (not pushed, not touching Khushali's build): the original
 * reference HTML's typewriter headline, timing copied exactly from reference/SlideVault.html
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

/** One-line first-visit hint. Goes away when dismissed, or as soon as the person adds a slide. */
function FirstVisitTip() {
  const { seen, dismiss } = useTipSeen('select');
  const { selection } = useWorkspace();
  const added = selection.length > 0;
  useEffect(() => {
    if (added) dismiss();
  }, [added, dismiss]);
  if (seen || added) return null;
  return (
    <p className="first-tip" role="note">
      <Icon name="info" className="ic-sm" />
      <span>Tick slides, then download them together.</span>
      <button type="button" className="btn-link" onClick={dismiss}>
        Got it
      </button>
    </p>
  );
}

/** The "Try" example searches, shown under the search and filter card. */
function HomeTry() {
  const { query, setQuery } = useWorkspace();
  return (
    <div className="home-try">
      <div className="home-hero-try">
        <span>Try</span>
        <ul>
          {TRY_QUERIES.map((q) => (
            <li key={q}>
              <button type="button" className="try-chip" aria-current={query.trim() === q ? 'true' : undefined} onClick={() => setQuery(q)}>
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <FirstVisitTip />
    </div>
  );
}

/** The original reference HTML's hero search, styled to match it exactly, wired to real search. */
/* Once the person has clicked into the search box, the typing animation stays off for the rest of the visit. */
let heroTouched = false;

function HomeHeader() {
  const { query, setQuery } = useWorkspace();
  const [touched, setTouched] = useState(heroTouched);
  const showHint = query === '' && !touched;
  const tw = useTypewriter(TYPEWRITER_PHRASES, showHint);
  const submit = (e: FormEvent) => {
    e.preventDefault();
  };
  /* Tell the header when this bar has scrolled up out of sight, so it can show a slim search shortcut. */
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setHeroOut(!entry.isIntersecting), { rootMargin: '-110px 0px 0px 0px' });
    io.observe(el);
    return () => {
      io.disconnect();
      setHeroOut(false);
    };
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
          <input id="sv-hero-q" type="search" autoComplete="off" enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={touched ? 'Slides, clients or topics' : undefined} onFocus={() => {
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
      <HomeHeader />
      <FilterBar />
      <HomeTry />
      {searching ? <ResultsView /> : <LibraryView />}
    </>
  );
}

function LibraryView() {
  const { filters, clearFilters, profile, savedIds, activity } = useWorkspace();
  const lib = useReadyLibrary();
  const ready = 'slides' in lib;
  const slides = useMemo(() => (ready ? lib.slides.filter((s) => slideMatches(s, filters)) : []), [ready, lib, filters]);
  const decks = useMemo(() => (ready ? lib.decks.filter((d) => deckMatches(d, filters)) : []), [ready, lib, filters]);

  const best = browseSlides('best', slides);
  const recent = browseSlides('recent', slides);
  const popular = browseSlides('popular', slides);
  const suggested = browseSlides('suggested', slides);
  const retired = browseSlides('retired', slides);

  /* Local design prototype: a personalized row (profile -> one real category, deterministically
     so the same profile always sees the same lane) and a "because you saved" row keyed off the
     first saved slide's category -- the right-sized stand-in for real recommendations discussed
     with Schiffon, not real ML (not pushed, not part of Khushali's approved build). */
  const categoryList = useMemo(() => [...new Set(slides.map(categoryOf).filter((c): c is string => c !== null))].sort(), [slides]);
  const pickedCategory = profile && categoryList.length > 0 ? categoryList[Math.abs(hashString(profile)) % categoryList.length] : null;
  const picked = pickedCategory ? slides.filter((s) => categoryOf(s) === pickedCategory) : [];

  /* Top 10: actual per-profile usage frequency (how often this profile has opened each slide),
     not category membership -- two people can share a category and still rely on very different
     individual slides, per Schiffon. Falls back to the category lane, then to the site-wide best,
     only so a freshly-reset demo profile with no view history isn't left with an empty row. */
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
  const top10 = usageRanked.length > 0 ? usageRanked : picked.length > 0 ? [...picked].reverse() : best;
  const top10Sub =
    usageRanked.length > 0
      ? `The slides ${profile} opens most.`
      : picked.length > 0
        ? `Based on what ${profile} looks at most.`
        : 'Most added to a slide selection.';

  const firstSaved = slides.find((s) => savedIds.has(s.id));
  const becauseCategory = firstSaved ? categoryOf(firstSaved) : null;
  const because = firstSaved && becauseCategory ? slides.filter((s) => s.id !== firstSaved.id && categoryOf(s) === becauseCategory) : [];
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
          <FilterNote />
          {picked.length > 0 && (
            <Row id="picked" title={`Picked for ${profile}`} sub="Based on what this profile looks at most.">
              {picked.slice(0, ROW_LIMIT).map((s) => (
                <li key={s.id}>
                  <SlideCard slide={s} list={picked.slice(0, ROW_LIMIT)} />
                </li>
              ))}
            </Row>
          )}
          <TopTenRow slides={top10} sub={top10Sub} />
          {best.length > 0 && (
            <Row id="best" title="Best of the Best" sub="Hand-picked slides. Row names TBD." seeAll="best" total={best.length}>
              {best.slice(0, ROW_LIMIT).map((s) => (
                <li key={s.id}>
                  <SlideCard slide={s} list={best.slice(0, ROW_LIMIT)} />
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
            <Row id="popular" title="Most downloaded" sub="Sample counts for now." seeAll="popular" total={popular.length} sim>
              {popular.slice(0, ROW_LIMIT).map((s) => (
                <li key={s.id}>
                  <SlideCard slide={s} list={popular.slice(0, ROW_LIMIT)} note={`Downloaded ${simUsed(s)} times (sample)`} />
                </li>
              ))}
            </Row>
          )}
          {suggested.length > 0 && (
            <Row id="suggested" title="Suggested for review" sub="Added or labelled by AI. A person has not checked them yet." seeAll="suggested" total={suggested.length} sim>
              {suggested.slice(0, ROW_LIMIT).map((s) => (
                <li key={s.id}>
                  <SlideCard slide={s} list={suggested.slice(0, ROW_LIMIT)} />
                </li>
              ))}
            </Row>
          )}
          {because.length > 0 && firstSaved && (
            <Row id="because" title={`Because you saved ${firstSaved.title}`} sub="Same category, more to look at.">
              {because.slice(0, ROW_LIMIT).map((s) => (
                <li key={s.id}>
                  <SlideCard slide={s} list={because.slice(0, ROW_LIMIT)} />
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
          {retired.length > 0 && (
            <Row id="retired" title="Retired" sub="Kept for records. Curators only. Can’t be downloaded." seeAll="retired" total={retired.length} sim>
              {retired.slice(0, ROW_LIMIT).map((s) => (
                <li key={s.id}>
                  <SlideCard slide={s} list={retired.slice(0, ROW_LIMIT)} />
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
              <div className="tiles">{tiles('client', clients, (a, b) => a.localeCompare(b))}</div>
            </section>
          )}
          {years.slideN.size > 0 && (
            <section className="row" aria-labelledby="row-years">
              <div className="row-head">
                <div>
                  <h2 id="row-years">Browse by year</h2>
                </div>
              </div>
              <div className="tiles">{tiles('year', years, (a, b) => Number(b) - Number(a))}</div>
            </section>
          )}
          {cats.slideN.size > 0 && (
            <section className="row" aria-labelledby="row-categories">
              <div className="row-head">
                <div>
                  <h2 id="row-categories">Browse by category</h2>
                </div>
              </div>
              <div className="tiles">{tiles('category', cats, (a, b) => a.localeCompare(b))}</div>
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

function SelectAll({ slides: every }: { slides: SlideSummary[] }) {
  const { selection, updateSelection, announce } = useWorkspace();
  const slides = every.filter((s) => simTier(s) !== 'Retired'); // retired slides can't be downloaded
  const all = slides.length > 0 && slides.every((s) => selection.some((x) => x.id === s.id));
  const click = () => {
    updateSelection((cur) => (all ? cur.filter((c) => !slides.some((s) => s.id === c.id)) : [...cur, ...slides.filter((s) => !cur.some((c) => c.id === s.id))]));
    announce(all ? 'Selection cleared' : `${plural(slides.length, 'slide')} added to slide selection`);
  };
  return (
    <button type="button" className="btn btn-sm" onClick={click}>
      <Icon name="check" />
      <span>{all ? 'Clear selection' : `Select all ${slides.length}`}</span>
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
      <FilterNote />
      <div className="grid" style={{ marginTop: 8 }}>
        {ids.map((s) => (
          <SlideCard key={s.id} slide={s} list={ids} note={id === 'popular' ? `Downloaded ${simUsed(s)} times (sample)` : undefined} />
        ))}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- Search */

export function ResultsView() {
  const { query, search, library, filters, clearFilters, retrySearch, setQuery } = useWorkspace();
  const [sort, setSort] = useState<'best' | 'popular' | 'newest'>('best');
  const q = query.trim();

  /* Simulated smart search (FD-14): reads the sentence, scores every slide, and says why it fits.
     Real keyword hits from the server count for extra, so plain words still behave as before. */
  const smart = useMemo(() => {
    if (search.status !== 'ready' || library.status !== 'ready') return null;
    const clients = [...new Set(library.slides.map((s) => s.provenance.clientName).filter((c): c is string => !!c))];
    const parsed = simParse(q, clients);
    const real = new Set(search.slides.map((s) => s.id));
    const scored = simSearch(parsed, library.slides, real).filter((r) => slideMatches(r.slide, filters));
    const seen = new Set<string>();
    const ranked = scored.sort((a, b) => b.score - a.score);
    const shown = ranked.filter((r) => {
      const g = r.slide.alsoIn?.groupId;
      if (!g) return true;
      if (seen.has(g)) return false;
      seen.add(g);
      return true;
    });
    const sorted =
      sort === 'popular'
        ? [...shown].sort((a, b) => simUsed(b.slide) - simUsed(a.slide))
        : sort === 'newest'
          ? [...shown].sort((a, b) => (yearOf(b.slide) ?? -1) - (yearOf(a.slide) ?? -1) || b.score - a.score)
          : shown;
    return { parsed, shown: sorted, hidden: scored.length - shown.length };
  }, [search, library, filters, q, sort]);

  const shown = smart?.shown ?? [];
  const slides = shown.map((r) => r.slide);
  const deckCount = new Set(slides.map((s) => s.provenance.sourceId)).size;

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
      {(search.status === 'loading' || search.status === 'idle' || (search.status === 'ready' && !smart)) && (
        <div role="status" aria-live="polite">
          <p className="thinking">
            <Icon name="spinner" className="spin" />
            Reading your request, matching slides, checking why each one fits…
          </p>
          <SkeletonGrid count={4} />
        </div>
      )}
      {smart && (
        <>
          <div className="interp" hidden={smart.parsed.chips.length > 0 && smart.parsed.chips.every((c) => chipShownInFilterRow(smart.parsed, c)) && smart.parsed.tokens.length === 0}>
            <span className="meta" title="Simulated for now. The real build uses an AI model.">
              <Icon name="sparkle" className="ic-sm" />
              We read this as:
              <SimFlag />
            </span>
            {smart.parsed.chips
              .filter((c) => !chipShownInFilterRow(smart.parsed, c))
              .map((c) => (
                <button key={c.key} type="button" className="chip-x" aria-label={`Remove ${c.kind}: ${c.label}`} onClick={() => setQuery(stripFromQuery(q, c))}>
                  <span className="k">{c.kind}:</span> {c.label}
                  <Icon name="x" />
                </button>
              ))}
            {smart.parsed.tokens.length > 0 && <span className="meta">{smart.parsed.chips.some((c) => !chipShownInFilterRow(smart.parsed, c)) ? 'and the words' : 'the words'} {smart.parsed.tokens.map((t) => `“${t}”`).join(', ')}</span>}
            {!smart.parsed.chips.length && !smart.parsed.tokens.length && <span className="meta">no specific topic, showing what fits your filters</span>}
          </div>
          <div className="refine">
            <label>
              Sort
              <select className="select select-sm" value={sort} onChange={(e) => setSort(e.target.value as 'best' | 'popular' | 'newest')}>
                <option value="best">Best match</option>
                <option value="popular">Most downloaded (sample)</option>
                <option value="newest">Newest first</option>
              </select>
            </label>
            <span className="spacer" />
            {slides.length > 0 && <SelectAll slides={slides} />}
          </div>
          <FilterNote />
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
                {smart.hidden > 0 ? ` ${plural(smart.hidden, 'near-identical copy', 'near-identical copies')} grouped under “Also in…”.` : ''}
              </p>
              <div className="grid">
                {shown.map((r) => (
                  <SlideCard key={r.slide.id} slide={r.slide} list={slides} why={r.why} note={sort === 'popular' ? `Downloaded ${simUsed(r.slide)} times (sample)` : undefined} />
                ))}
              </div>
            </>
          )}
          <details className="how">
            <summary>
              How does this search work? <SimFlag />
            </summary>
            <ol>
              <li>Your request is read and turned into filters (client, year) and topics.</li>
              <li>Slides are matched on those filters, then on meaning. The real build uses text search plus embeddings in Postgres.</li>
              <li>Each result says why it fits. Near-identical slides are grouped, never deleted.</li>
            </ol>
            <p className="meta" style={{ marginTop: 8 }}>
              Steps 1 and 2 are simulated here. The words you type are also checked against the real slide text.
            </p>
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
          <button type="button" className="btn btn-sm btn-primary" onClick={() => openDownload(deck.slides.filter((s) => simTier(s) !== 'Retired'))}>
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

  const [detail, setDetail] = useState<{ id: string; slide: SlideDetail } | { id: string; error: string } | null>(null);
  const { request, onSessionExpired } = runtime;
  useEffect(() => {
    const controller = new AbortController();
    getSlide({ request, onSessionExpired }, id, controller.signal)
      .then((s) => setDetail({ id, slide: s }))
      .catch((e: Error) => e.name !== 'AbortError' && setDetail({ id, error: e.message }));
    return () => controller.abort();
  }, [request, onSessionExpired, id]);
  /* Local design prototype: record a visit to this slide on the signed-in profile's activity log.
     Views.tsx's TopTenRow counts these per slide to rank "what this profile actually uses most,"
     per Schiffon: two people in the same category can still have very different real usage. */
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
  const tier = simTier(slide);
  const tags = simTags(slide);
  const retired = tier === 'Retired';
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
          {tier !== 'Approved' && (
            <div className="badges" style={{ marginBottom: 12 }}>
              <StatusBadge tier={tier} />
            </div>
          )}
          <button
            type="button"
            className="big-preview"
            style={{
              display: 'block',
              width: '100%',
              padding: 0,
              cursor: 'zoom-in',
              background: 'none',
            }}
            aria-label="Open a larger preview"
            onClick={() => openPreview(sibs, i)}
          >
            <div style={{ aspectRatio: '16 / 9' }}>
              <Thumb slide={slide} />
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
              <button type="button" className="btn btn-sm" aria-pressed={sel} disabled={retired} onClick={() => set(slide, !sel)}>
                <Icon name="check" />
                <span>{sel ? 'Selected' : 'Select'}</span>
              </button>
              <button type="button" className="btn btn-sm btn-primary" disabled={retired} onClick={() => openDownload([slide])}>
                <Icon name="download" />
                <span>Download only this slide</span>
              </button>
              <Link className="btn btn-sm" to={{ view: 'deck', id: deck.id }}>
                Open deck
              </Link>
            </div>
            {retired && (
              <p className="meta" style={{ marginTop: 8 }}>
                {TIER_TEXT.Retired}
              </p>
            )}
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
          <section className="panel sim-panel">
            <h2>
              Status and labels <SimFlag />
            </h2>
            <div className="badges">
              <StatusBadge tier={tier} />
            </div>
            <p className="meta" style={{ marginTop: 8 }}>
              {TIER_TEXT[tier]}
            </p>
            <h3 className="h3" style={{ marginTop: 12 }}>
              Labels suggested by AI
            </h3>
            {tags.length ? (
              <div className="tags" style={{ marginTop: 6 }}>
                {tags.map((t) => (
                  <span key={t} className="tag sim">
                    <Icon name="sparkle" className="ic-sm" />
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <p className="meta">No labels suggested for this slide.</p>
            )}
            <p className="meta" style={{ marginTop: 8 }}>
              Simulated: worked out from the slide title and deck name. The real build reads the whole slide and a person checks the labels before they count.
            </p>
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
        <div className="card">
          <Icon name="layers" className="ic-big" />
          <h2 className="h2">My decks</h2>
          <p className="meta">Your saved drafts, to arrange and export.</p>
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

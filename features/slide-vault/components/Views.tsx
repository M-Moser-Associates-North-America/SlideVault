'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  plural,
  slideMatches,
  sortNewest,
  UNKNOWN_CLIENT,
  yearOf,
  type Deck,
} from './library';
import { DeckCard, Link, SkeletonGrid, SlideCard, StateBlock, Thumb, useCartToggle } from './parts';
import { useWorkspace } from './state';

const ROW_LIMIT = 12;

/** One horizontally scrolling row of cards, with "See all". */
function Row({ id, title, sub, seeAll, total, children }: { id: string; title: string; sub?: string; seeAll?: string; total?: number; children: ReactNode }) {
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
  const scroll = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <section className="row" aria-labelledby={`row-${id}`}>
      <div className="row-head">
        <div>
          <h2 id={`row-${id}`}>{title}</h2>
          {sub && <div className="sub">{sub}</div>}
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
          <p className="thinking">
            <Icon name="spinner" className="spin" />
            Loading the library…
          </p>
          <SkeletonGrid />
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
    return { blocker: <StateBlock icon="library" title="The library is empty" text="No decks have been added yet." /> };
  }
  return { slides: library.slides, decks: library.decks };
}

/* ------------------------------------------------------------------ Home */

export function HomeView() {
  const { query } = useWorkspace();
  if (query.trim()) return <ResultsView />;
  return <LibraryView />;
}

function LibraryView() {
  const { filters, clearFilters } = useWorkspace();
  const lib = useReadyLibrary();
  const ready = 'slides' in lib;
  const slides = useMemo(() => (ready ? lib.slides.filter((s) => slideMatches(s, filters)) : []), [ready, lib, filters]);
  const decks = useMemo(() => (ready ? lib.decks.filter((d) => deckMatches(d, filters)) : []), [ready, lib, filters]);

  const best = browseSlides('best', slides);
  const recent = browseSlides('recent', slides);
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
      <div className="page-head">
        <div>
          <h1 className="h1" tabIndex={-1}>
            Home
          </h1>
          <p className="lede">Browse trusted slides, or use the search box. Tick slides to add them to your cart.</p>
        </div>
      </div>
      {!ready ? (
        <div style={{ marginTop: 20 }}>{lib.blocker}</div>
      ) : (
        <>
          <FilterNote />
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
            <StateBlock icon="search" title="No slides match these filters" text="Try removing one, or clear them all.">
              <button type="button" className="btn" onClick={clearFilters}>
                Clear filters
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

function SelectAll({ slides }: { slides: SlideSummary[] }) {
  const { selection, updateSelection, announce } = useWorkspace();
  const all = slides.length > 0 && slides.every((s) => selection.some((x) => x.id === s.id));
  const click = () => {
    updateSelection((cur) => (all ? cur.filter((c) => !slides.some((s) => s.id === c.id)) : [...cur, ...slides.filter((s) => !cur.some((c) => c.id === s.id))]));
    announce(all ? 'Selection cleared' : `${plural(slides.length, 'slide')} added to cart`);
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
      <StateBlock icon="search" title="Nothing here" text="No slides match this row with your filters.">
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
          <SlideCard key={s.id} slide={s} list={ids} />
        ))}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- Search */

export function ResultsView() {
  const { query, search, filters, retrySearch, setQuery } = useWorkspace();
  const [sort, setSort] = useState<'best' | 'newest'>('best');
  const q = query.trim();
  const shown = useMemo(() => {
    if (search.status !== 'ready') return [];
    const f = search.slides.filter((s) => slideMatches(s, filters));
    return sort === 'newest' ? sortNewest(f) : f;
  }, [search, filters, sort]);
  const deckCount = new Set(shown.map((s) => s.provenance.sourceId)).size;

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
            Searching…
          </p>
          <SkeletonGrid count={4} />
        </div>
      )}
      {search.status === 'ready' && (
        <>
          <div className="refine">
            <label>
              Sort
              <select className="select select-sm" value={sort} onChange={(e) => setSort(e.target.value as 'best' | 'newest')}>
                <option value="best">Best match</option>
                <option value="newest">Newest first</option>
              </select>
            </label>
            <span className="spacer" />
            {shown.length > 0 && <SelectAll slides={shown} />}
          </div>
          <FilterNote />
          {shown.length === 0 ? (
            <StateBlock icon="search" title="No slides match that yet" text="Every word you type must appear in a slide’s title or text. Try fewer or different words, or clear the filters on the left.">
              <button type="button" className="btn" onClick={() => setQuery('')}>
                Clear search
              </button>
            </StateBlock>
          ) : (
            <>
              <p className="summary" aria-live="polite">
                <strong>{plural(shown.length, 'slide')}</strong> from {plural(deckCount, 'deck')}. Near-identical copies are grouped under “Also in…”.
              </p>
              <div className="grid">
                {shown.map((s) => (
                  <SlideCard key={s.id} slide={s} list={shown} />
                ))}
              </div>
            </>
          )}
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
  const { runtime, library, openPreview, openDownload } = useWorkspace();
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
  const more = (library.status === 'ready' ? library.slides : []).filter((s) => s.id !== id && s.provenance.sourceId !== p.sourceId && clientOf(s) === clientOf(slide) && clientOf(s) !== UNKNOWN_CLIENT).slice(0, 10);

  return (
    <div className="sv-wrap">
      <div className="slide-detail">
        <div>
          <h1 className="h1" tabIndex={-1} style={{ marginBottom: 12 }}>
            {slide.title}
          </h1>
          <button type="button" className="big-preview" style={{ display: 'block', width: '100%', padding: 0, cursor: 'zoom-in', background: 'none' }} aria-label="Open a larger preview" onClick={() => openPreview(sibs, i)}>
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
            <p className="meta" style={{ marginTop: 8 }}>
              Slide type and topic labels from AI are planned. Owner and approval show once review exists.
            </p>
          </section>
          {slide.alsoIn && (
            <section className="panel">
              <h2>Also in {plural(slide.alsoIn.otherDeckCount, 'other deck')}</h2>
              <p className="meta">
                {slide.alsoIn.match === 'near' ? 'Nearly identical slides' : 'The same slide'} appear in other decks. Nothing is deleted.
              </p>
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

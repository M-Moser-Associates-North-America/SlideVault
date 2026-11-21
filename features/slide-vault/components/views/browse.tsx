'use client';

import { buttonClass } from '../ui/Button';
import type { SlideSummary } from '../../contracts/dto';
import { browseSlides, browseTitle, deckMatches, downloadedNote, plural, slideMatches, type Deck } from '../library';
import { DeckCard, Link, SlideCard, StateBlock } from '../parts';
import { useSearch } from '../state';
import { useMemo, useState } from 'react';
import { useWorkspaceCompact } from '../size';
import { useReadyLibrary, ColumnsToggle, SelectAll } from './shared';
import { SearchHeader } from './home';
import { ResultsView } from './results';

export function BrowseView({ id }: { id: string }) {
  return (
    <>
      <SearchHeader />
      {id === 'decks' ? <BrowsePage id={id} /> : <ResultsView browse={id} />}
    </>
  );
}

function BrowsePage({ id }: { id: string }) {
  const { filters } = useSearch();
  const lib = useReadyLibrary();
  const title = browseTitle(id);
  return (
    <div className="sv-wrap res-wrap res-browse">
      <div className="page-head">
        <h1 className="h1 res-title" tabIndex={-1}>
          <span className="res-q">{title}</span>
          {!('blocker' in lib) && <span className="res-n"> · {plural(lib.decks.filter((d) => deckMatches(d, filters)).length, 'deck')}</span>}
        </h1>
      </div>
      {'blocker' in lib ? (
        <div style={{ marginTop: 20 }}>{lib.blocker}</div>
      ) : (
        <BrowseBody id={id} slides={lib.slides.filter((s) => slideMatches(s, filters))} decks={lib.decks.filter((d) => deckMatches(d, filters))} />
      )}
    </div>
  );
}

function BrowseBody({ id, slides, decks }: { id: string; slides: SlideSummary[]; decks: Deck[] }) {
  if (id === 'decks') return <DecksList decks={decks} />;
  const ids = browseSlides(id, slides);
  if (!ids.length) {
    return (
      <StateBlock icon="search" title="No slides in this row yet" text="Nothing here matches your filters. Try removing one, or head back to Home.">
        <Link className={buttonClass()} to={{ view: 'pages' }}>
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

/** "See all" for the Decks row: every deck as the same card as in the row, with the same Sort box as the other See all pages. */
function DecksList({ decks }: { decks: Deck[] }) {
  const compact = useWorkspaceCompact();
  const [sort, setSort] = useState<'newest' | 'az' | 'most'>('newest');
  const [dense, setDense] = useState(false);
  const sorted = useMemo(() => {
    const byName = (a: Deck, b: Deck) => a.title.localeCompare(b.title);
    if (sort === 'az') return [...decks].sort(byName);
    if (sort === 'most') return [...decks].sort((a, b) => b.slides.length - a.slides.length || byName(a, b));
    return [...decks].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || byName(a, b));
  }, [decks, sort]);
  return (
    <>
      <div className="res-controls">
        <div className="refine">
          <label>
            <span className="refine-lbl">Sort:</span>
            <select className="select select-sm" value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'az' | 'most')}>
              <option value="newest">Newest first</option>
              <option value="az">Name A to Z</option>
              <option value="most">Most slides</option>
            </select>
          </label>
          <span className="spacer" />
          {compact && <ColumnsToggle dense={dense} setDense={setDense} />}
        </div>
      </div>
      <div className={`grid${dense ? ' is-dense' : ''}`} style={{ marginTop: 16 }}>
        {sorted.map((d) => (
          <DeckCard key={d.id} deck={d} />
        ))}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- Search */

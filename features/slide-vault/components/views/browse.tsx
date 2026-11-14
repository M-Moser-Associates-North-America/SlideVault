'use client';

import type { SlideSummary } from '../../contracts/dto';
import { browseSlides, browseTitle, deckMatches, downloadedNote, plural, slideMatches, type Deck } from '../library';
import { DeckCard, Link, SlideCard, StateBlock } from '../parts';
import { useSearch } from '../state';
import { useReadyLibrary, SelectAll } from './shared';
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

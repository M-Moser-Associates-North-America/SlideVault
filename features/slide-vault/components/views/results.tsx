'use client';

import { Button } from '../ui/Button';
import { SectionCards } from '../SectionCards';
import { useEffect, useMemo, useState } from 'react';
import type { SmartSearchItem, SmartSearchResult } from '../../contracts/dto';
import { Icon } from '../icons';
import { browseSlides, browseTitle, downloadedNote, downloadsOf, filterCount, removeHint, plural, slideMatches, yearOf, SECTION_LABEL } from '../library';
import { findDecks } from '../deck-finder';
import { DeckCard, SkeletonGrid, SlideCard, StateBlock } from '../parts';
import { setResultsSummary } from '../../client/results-summary';
import { ScrollRow } from '../scroll-row';
import { useWorkspacePhoneLike } from '../size';
import { shownInFilterRow } from '../search-reading';
import { useSearch } from '../state';
import { Row, useReadyLibrary, ColumnsToggle } from './shared';

/**
 * The results page. With `browse` set (a Home row's "See all", or a client / year / category tile) it shows the same page
 * for a list that no search produced: same heading, filter pills, sort, section pills and cards, just without the "why it fits" lines.
 */
export function ResultsView({ browse }: { browse?: string } = {}) {
  const { searched, search, filters, patchFilters, clearFilters, retrySearch, setQuery, aiAsk, autoSection, sectionsFromSearch, sectionsInWords, ignoreChip, refreshing } = useSearch();
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
  const visible = pickedSection ? shown.filter((i) => i.slide.section?.kind === pickedSection) : shown;
  const slides = visible.map((i) => i.slide);
  const deckCount = new Set(slides.map((s) => s.provenance.sourceId)).size;
  useEffect(() => {
    setResultsSummary({ count: slides.length, sort, setSort });
    return () => setResultsSummary(null);
  }, [slides.length, sort]);
  /* Only what the search itself asked for brings in the Sections block; tapping a section pill just narrows the slides, so nothing above them moves. */
  /* The Section filter was set by hand to a section the words do not ask for: the cards for the section in the words step aside. */
  const pickedElsewhere = !browse && filters.section.length > 0 && sectionsInWords.length > 0 && !sectionsInWords.some((k) => filters.section.includes(k));
  const sectionMode = !pickedElsewhere && (!!autoSection || sectionsFromSearch.length > 0);
  /* Client, year and slide type already light up in the filter row above. */
  const extraChips = result ? result.chips.filter((c) => !shownInFilterRow(c)) : [];

  /* The section a result belongs to is chosen with the Section filter in the filter row (no separate bar of section pills). */
  return (
    <div className={`sv-wrap res-wrap${browse ? ' res-browse' : ''}${refreshing && !browse ? ' is-refreshing' : ''}`} aria-busy={refreshing && !browse}>
      <div className="page-head">
        <h1 className="h1 res-title" tabIndex={-1}>
          <span className="res-q">{browse ? (tileKind ? 'Results' : browseTitle(browse)) : `Results for “${q}”`}</span>
          {result && shown.length > 0 && <span className="res-n"> · {plural(visible.length, 'slide')}</span>}
          {refreshing && !browse && result && (
            <span className="res-updating" role="status">
              <Icon name="spinner" className="ic-sm spin" /> Updating…
            </span>
          )}
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
          <Button  onClick={retrySearch}>
            Try again
          </Button>
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
          {result.readerNote && (
            <p className="meta" role="status">
              <Icon name="alert" className="ic-sm" /> {result.readerNote}
            </p>
          )}
          {extraChips.length > 0 && (
            <ScrollRow className="interp">
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
                  <button key={`${c.kind}:${c.label}`} type="button" className="chip-x" aria-label={`Remove ${c.kind}: ${c.label}`} onClick={() => ignoreChip(c)}>
                    <span className="k">{c.kind}:</span> {c.label}
                    <Icon name="x" />
                  </button>
                ),
              )}
            </ScrollRow>
          )}
          {result.relaxed && <p className="meta">Nothing matched every filter, so client, year and category are left out.</p>}
          {/* Results in groups, each with its own heading and room: Decks, then Sections (when asked for), then Slides. */}
          {sectionMode && <SectionCards heading="Sections" results={shown.map((i) => i.slide)} only={autoSection ? [autoSection] : sectionsFromSearch} />}
          {shown.length > 0 && (sectionMode || (found && found.decks.length > 0)) && <h2 className="h2 res-h">Slides</h2>}
          <div className="res-controls">
          <div className="refine">
            {!(browse && (browseKind === 'recent' || browseKind === 'popular')) && (
            <label>
              <span className="refine-lbl">Sort:</span>
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
                <Button  onClick={clearFilters}>
                  Clear all filters
                </Button>
              )}
              {!browse && (
                <Button  onClick={() => setQuery('')}>
                  Clear search
                </Button>
              )}
            </StateBlock>
          ) : visible.length === 0 ? (
            <StateBlock icon="search" title={`No ${SECTION_LABEL[pickedSection ?? ''] ?? ''} slides in these results`} text="Another section may have what you need.">
              <Button onClick={() => patchFilters({ section: [] })}>Clear Section filter</Button>
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
              <li>Short searches use simple rules. A longer question is read once by AI and turned into words and filters.</li>
              <li>Best matches first, with why each fits. Near-duplicates are grouped, not deleted.</li>
            </ol>
          </details>}
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Deck */

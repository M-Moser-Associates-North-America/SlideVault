'use client';

import { useEdgeFade } from '../edge-fade';
import { Button, buttonClass } from '../ui/Button';
import { useRef, type ReactNode } from 'react';
import type { SlideSummary } from '../../contracts/dto';
import { Icon } from '../icons';
import { plural, type Deck } from '../library';
import { Link, SkeletonRows, SlideCard, StateBlock } from '../parts';
import { useDraft, useLibrary, useNotify } from '../state';

export const ROW_LIMIT = 12;

/** The browse tiles (client, year, category): scroll sideways like the card rows. */
export function TileRow({ children }: { children: ReactNode }) {
  return <div className="tiles">{children}</div>;
}

/** One horizontally scrolling row of cards, with "See all". */
export function Row({ id, title, sub, seeAll, total, children }: { id: string; title: string; sub?: string; seeAll?: string; total?: number; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  useEdgeFade(ref);
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
          <Button variant="ghost" iconOnly size="sm" aria-label={`Scroll ${title} left`} onClick={() => scroll(-1)}>
            <Icon name="left" />
          </Button>
          <Button variant="ghost" iconOnly size="sm" aria-label={`Scroll ${title} right`} onClick={() => scroll(1)}>
            <Icon name="right" />
          </Button>
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
export function TopTenRow({ slides, sub }: { slides: SlideSummary[]; sub: string }) {
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
export function useReadyLibrary(): { slides: SlideSummary[]; decks: Deck[] } | { blocker: ReactNode } {
  const { library, reloadLibrary } = useLibrary();
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
          <Button  onClick={reloadLibrary}>
            Try again
          </Button>
        </StateBlock>
      ),
    };
  }
  if (library.slides.length === 0) {
    return {
      blocker: (
        <StateBlock icon="library" title="Your library is empty" text="No decks have been added yet. Upload a deck to see its slides here.">
          <Link className={buttonClass()} to={{ view: 'upload' }}>
            Go to Upload
          </Link>
        </StateBlock>
      ),
    };
  }
  return { slides: library.slides, decks: library.decks };
}

/* ------------------------------------------------------------------ Home */

export function SelectAll({ slides }: { slides: SlideSummary[] }) {
  const { selection, updateSelection } = useDraft();
  const { announce } = useNotify();
  const all = slides.length > 0 && slides.every((s) => selection.some((x) => x.id === s.id));
  const click = () => {
    updateSelection((cur) => (all ? cur.filter((c) => !slides.some((s) => s.id === c.id)) : [...cur, ...slides.filter((s) => !cur.some((c) => c.id === s.id))]));
    announce(all ? 'Removed from draft deck' : `${plural(slides.length, 'slide')} added to draft deck`);
  };
  return (
    <Button size="sm" onClick={click} aria-label={all ? 'Remove all from draft deck' : `Add all ${slides.length} to draft deck`}>
      <Icon name="check" />
      <span aria-hidden="true">{all ? 'Remove all' : `Add all ${slides.length}`}</span>
    </Button>
  );
}

/** One button that flips between one and two slides across; the icon shows what a tap will switch to. Used wherever slides are in a grid on a phone. */
export function ColumnsToggle({ dense, setDense }: { dense: boolean; setDense: (d: boolean) => void }) {
  return (
    <Button size="sm" iconOnly className="cols-toggle" aria-label={dense ? 'Show larger cards' : 'Show smaller cards'} onClick={() => setDense(!dense)}>
      <Icon name={dense ? 'expand' : 'columns'} />
    </Button>
  );
}

/** Where "File created by" comes from, so nobody reads it as the person who made the pitch. */
export const FILE_CREATED_TIP = "From the PowerPoint file's own details. For a deck made from a template this can be the template's author and date.";

'use client';

import { Button, buttonClass } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { DeckTags } from '../TagBits';
import { useEffect, useRef, useState } from 'react';
import type { SlideSummary } from '../../contracts/dto';
import { Icon } from '../icons';
import { dateLabel, hiddenGap, folderLabel, plural } from '../library';
import { GroupTool } from '../Packs';
import { Link, SlideCard, StateBlock } from '../parts';
import { ScrollRow } from '../scroll-row';
import { NumberJump } from '../Dialogs';
import { MoreMenu } from '../MoreMenu';
import { useWorkspaceCompact, useWorkspacePhoneLike } from '../size';
import { useRoot } from '../root';
import { useDraft, useLibrary, useNotify, useOverlays } from '../state';
import { useReadyLibrary, SelectAll, ColumnsToggle, FILE_CREATED_TIP } from './shared';

/** A "⋯" button that opens a small list of less-used actions. Closes on a tap outside, on Escape, and after a choice. */
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
  const { updateSelection } = useDraft();
  const { toast, announce } = useNotify();
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
  };
  return (
    <form
      className="range-add"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <div className="range-fields">
        <span className="range-label">Add slides</span>
        <input className="num-jump" inputMode="numeric" pattern="[0-9]*" maxLength={String(slides.length).length} enterKeyHint="next" autoComplete="off" aria-label={`From slide, a number from 1 to ${slides.length}`} value={from} onFocus={keepInView} onBlur={() => setFrom(String(Math.min(slides.length, Math.max(1, Math.round(Number(from)) || 1))))} onChange={(e) => setFrom(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => step(e, from, setFrom)} />
        <span>to</span>
        <input className="num-jump" inputMode="numeric" pattern="[0-9]*" maxLength={String(slides.length).length} enterKeyHint="go" autoComplete="off" aria-label={`To slide, a number from 1 to ${slides.length}`} value={to} onFocus={keepInView} onBlur={() => setTo(String(Math.min(slides.length, Math.max(1, Math.round(Number(to)) || slides.length))))} onChange={(e) => setTo(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => step(e, to, setTo)} />
      </div>
      <div className="range-actions">
        <Button type="submit" size="sm" variant="primary">
          Add {hi - lo + 1}
        </Button>
        <Button variant="ghost" iconOnly className="range-close" aria-label="Close, and show the whole deck" onClick={onDone}>
          <Icon name="x" />
        </Button>
      </div>
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
          <Button size="sm" iconOnly aria-label="Back to the top" onClick={() => scroll.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
            <Icon name="up" />
          </Button>
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
  const { library, setIncludeHidden } = useLibrary();
  const { openDownload, openArchiveDialog } = useOverlays();
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
          <Link className={buttonClass()} to={{ view: 'pages' }}>
            Back to Home
          </Link>
        </StateBlock>
      </div>
    );
  }
  const openRange = () => {
    setRangeFrom('1');
    setRangeTo(String(deck.slides.length));
    setGrouping(false); /* the range box and grouping never share the page */
    setRangeOpen(true);
  };
  const toggleGrouping = () => {
    setRangeOpen(false);
    setGrouping((g) => !g);
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
            {deck.archived && <Badge tone="archived">Archived</Badge>}
            {deck.category && <Badge >{deck.category}</Badge>}
            {deck.year && <Badge >{deck.year}</Badge>}
            <Badge >
              <Icon name="folder" />
              {folderLabel(deck)}
            </Badge>
            {/* The deck's own tags join the row after the badges; "Add tag" is its last chip. */}
            <DeckTags deck={deck} />
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
          <>
          <div className="row-flex deck-actions">
            <SelectAll slides={deck.slides} />
            {tablet && (
              <Button size="sm" aria-pressed={rangeOpen} onClick={() => (rangeOpen ? setRangeOpen(false) : openRange())}>
                <Icon name="plus" />
                <span>Add a range of slides</span>
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => openDownload(deck.slides)} aria-label="Download whole deck">
              <Icon name="download" />
              <span>Download</span>
            </Button>
            <MoreMenu
              label="More deck actions"
              items={[
                ...(tablet ? [] : [{ label: 'Add a range of slides', icon: 'plus' as const, onClick: openRange }]),
                { label: grouping ? 'Stop grouping' : 'Group slides into a pack', icon: 'layers', onClick: toggleGrouping },
                { label: deck.archived ? 'Restore deck' : 'Archive deck', icon: 'archive', onClick: () => openArchiveDialog({ deck: { id: deck.id, title: deck.title, slideCount: deck.slides.length }, restore: !!deck.archived }) },
              ]}
            />
          </div>
          {/* While grouping, the choice stays in view as a selected chip (it would otherwise be hidden in the menu). */}
          {grouping && (
            <Button size="sm" aria-pressed className="deck-group-chip" onClick={() => setGrouping(false)}>
              <Icon name="layers" />
              <span>Stop grouping</span>
              <Icon name="x" />
            </Button>
          )}
          </>
        ) : (
          <div className="row-flex deck-actions-row">
            <SelectAll slides={deck.slides} />
            <Button size="sm" aria-pressed={rangeOpen} onClick={() => (rangeOpen ? setRangeOpen(false) : openRange())}>
              <Icon name="plus" />
              <span>Add a range of slides</span>
            </Button>
            <Button size="sm" aria-pressed={grouping} onClick={toggleGrouping}>
              <Icon name="layers" />
              <span>{grouping ? 'Stop grouping' : 'Group slides into a pack'}</span>
            </Button>
            <Button size="sm" variant="primary" onClick={() => openDownload(deck.slides)}>
              <Icon name="download" />
              <span>Download whole deck</span>
            </Button>
            <Button variant="link" className="deck-archive" onClick={() => openArchiveDialog({ deck: { id: deck.id, title: deck.title, slideCount: deck.slides.length }, restore: !!deck.archived })}>
              <Icon name="archive" className="ic-sm" />
              <span>{deck.archived ? 'Restore deck' : 'Archive deck'}</span>
            </Button>
          </div>
        )}
      </div>
      {rangeOpen && <RangeAdd slides={deck.slides} from={rangeFrom} to={rangeTo} setFrom={setRangeFrom} setTo={setRangeTo} onDone={() => setRangeOpen(false)} />}
      {/* "Go to slide" and the card-size toggle. */}
      <div className="deck-tagbar">
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

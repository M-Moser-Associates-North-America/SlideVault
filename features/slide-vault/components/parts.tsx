'use client';

import { CardVotes } from './SlideActions';
import { useWorkspaceCompact } from './size';
import { CompactTags } from './TagBits';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { SlideSummary } from '../contracts/dto';
import type { Location } from '../contracts/runtime';
import { packPosition, type Pack } from '../client/packs';
import { Icon, type IconName } from './icons';
import { categoryOf, clientOf, plural, yearOf, type Deck, folderLabel } from './library';
import { useAccount, useDraft, useLibrary, useNotify, useOverlays, useRuntime } from './state';

/** A link that goes through the host's navigation (runtime.navigate), keeping real hrefs for new tabs. */
export function Link({
  to,
  className,
  children,
  tabIndex,
  ariaHidden,
  onNavigate,
  ...rest
}: {
  to: Location;
  className?: string;
  children: ReactNode;
  tabIndex?: number;
  ariaHidden?: boolean;
  onNavigate?: () => void;
  'aria-label'?: string;
  title?: string;
  'aria-current'?: 'page' | 'true';
}) {
  const { runtime } = useRuntime();
  const href = runtime.hrefFor?.(to) ?? '#';
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate?.();
    runtime.navigate(to);
  };
  return (
    <a href={href} className={className} onClick={go} tabIndex={tabIndex} aria-hidden={ariaHidden || undefined} {...rest}>
      {children}
    </a>
  );
}

export type Crumb = { label: string; to?: Location };

export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <div className="crumbs">
      <nav aria-label="Breadcrumb">
        <ol>
          {items.map((it, i) => (
            <li key={i}>{i === items.length - 1 || !it.to ? <span aria-current="page">{it.label}</span> : <Link to={it.to}>{it.label}</Link>}</li>
          ))}
        </ol>
      </nav>
    </div>
  );
}

export function StateBlock({ icon, title, text, children, error }: { icon: IconName; title: string; text: string; children?: ReactNode; error?: boolean }) {
  return (
    <div className={`state${error ? ' error' : ''}`} role={error ? 'alert' : undefined}>
      <Icon name={icon} className="ic-big" />
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}

/** Skeleton cards while the library or a search is loading. */
export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel skel-card" />
      ))}
    </div>
  );
}

/** Placeholder rows while the library loads: grey shapes where each row's title and cards will appear. */
export function SkeletonRows({ rows = 2 }: { rows?: number }) {
  return (
    <div className="skel-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="skel-row">
          <div className="skel skel-title" />
          <div className="skel-cards">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skel skel-card" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Thumb({ slide }: { slide: SlideSummary }) {
  const { runtime } = useRuntime();
  /* A soft shimmer shows until the picture has arrived, then it fades in (a picture already in the cache shows at once). */
  const [loaded, setLoaded] = useState(false);
  /* A picture that fails is tried once more after a moment (a patchy connection often recovers); if it still fails, a quiet note stands in for it. */
  const [tries, setTries] = useState(0);
  const base = runtime.assetUrl(slide.previewPath);
  if (tries >= 2) {
    return (
      <span className="thumb-missing" role="img" aria-label="Preview unavailable">
        <Icon name="alert" />
        <span>Preview unavailable</span>
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- previews come from the injected API, not next/image
  return (
    <img
      key={tries}
      ref={(el) => {
        if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
      }}
      className={loaded ? 'is-loaded' : undefined}
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (tries === 0) window.setTimeout(() => setTries(1), 1500);
        else setTries(2);
      }}
      src={tries === 0 ? base : `${base}${base.includes('?') ? '&' : '?'}retry=1`}
      alt=""
      loading="lazy"
      decoding="async"
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        display: 'block',
      }}
    />
  );
}

/**
 * Add a whole deck section to the draft deck (FD-80). If some of its slides belong to a pack that also has slides outside
 * the section, ask first (the pack pop-up); otherwise add it at once. `addNow` skips the question.
 */
export function useAddSection() {
  const { packs } = useLibrary();
  const { selection, updateSelection } = useDraft();
  const { openPackDialog } = useOverlays();
  const { announce, toast } = useNotify();
  const addNow = (name: string, slides: SlideSummary[]) => {
    const add = slides.filter((s) => !selection.some((x) => x.id === s.id));
    updateSelection((cur) => [...cur, ...slides.filter((s) => !cur.some((c) => c.id === s.id))]);
    toast(`Added ${plural(add.length, 'slide')} from ${name}`);
    announce(`Added ${plural(add.length, 'slide')} of ${name} to the draft deck`);
  };
  const addSection = (name: string, slides: SlideSummary[]) => {
    const inside = new Set(slides.map((s) => s.id));
    const have = new Set(selection.map((s) => s.id));
    const straddling: Pack[] = [];
    for (const s of slides) {
      const p = packs.of(s.id);
      if (p && !straddling.some((x) => x.id === p.id) && p.slideIds.some((id) => !inside.has(id) && !have.has(id))) straddling.push(p);
    }
    if (straddling.length) openPackDialog({ kind: 'section', pack: straddling[0], section: { name, slides, packs: straddling } });
    else addNow(name, slides);
  };
  return { addSection, addNow };
}

/**
 * Add to or remove from the cart. A slide that belongs to a pack asks first (FD-38): adding offers the
 * whole pack, removing offers to take the whole pack out. `setOne` skips the question.
 */
export function useCartToggle() {
  const { packs } = useLibrary();
  const { selection, updateSelection, setCartMin } = useDraft();
  const { openPackDialog } = useOverlays();
  const { announce, toast } = useNotify();
  const compact = useWorkspaceCompact();
  const isSelected = (id: string) => selection.some((s) => s.id === id);
  const setOne = (slide: SlideSummary, on: boolean) => {
    if (on && !selection.some((s) => s.id === slide.id)) {
      /* Phone: the first slide opens the draft deck by itself, so it is seen landing and needs no message. Later ones leave it closed,
         so a short message says where the slide went (the Draft deck tab shows the count), with a button to open the deck and one to take it back. */
      if (compact) {
        if (selection.length > 0) {
          toast('Added to draft deck', [
            { label: 'View deck', run: () => setCartMin(false) },
            { label: 'Undo', run: () => updateSelection((cur) => cur.filter((x) => x.id !== slide.id)) },
          ]);
        }
      } else toast(`Added. ${plural(selection.length + 1, 'slide')} ready`);
    }
    updateSelection((cur) => {
      const has = cur.some((s) => s.id === slide.id);
      if (on && !has) return [...cur, slide];
      if (!on && has) return cur.filter((s) => s.id !== slide.id);
      return cur;
    });
    announce(on ? `Added to draft deck: ${slide.title}` : `Removed from draft deck: ${slide.title}`);
  };
  const set = (slide: SlideSummary, on: boolean) => {
    const pack = packs.of(slide.id);
    if (pack) {
      const here = isSelected(slide.id);
      const others = pack.slideIds.filter((id) => id !== slide.id);
      if (on && !here && others.some((id) => !isSelected(id))) return openPackDialog({ kind: 'add', pack, slide });
      if (!on && here && others.some((id) => isSelected(id))) return openPackDialog({ kind: 'remove', pack, slide });
    }
    setOne(slide, on);
  };
  return { isSelected, set, setOne };
}

/** A small label on a slide's card: which pack it is in and where. */
export function PackBadge({ pack, slideId }: { pack: Pack; slideId: string }) {
  const pos = packPosition(pack, slideId);
  const suggested = pack.status === 'suggested';
  return (
    <span className={`pack-badge${suggested ? ' is-suggested' : ''}`} title={`${pack.label ?? 'A pack'}: ${pos} of ${pack.slideIds.length} slides that go together${suggested ? ' (suggested, not yet confirmed)' : ''}`}>
      <Icon name="layers" className="ic-sm" />
      Pack · {pos} of {pack.slideIds.length}
    </span>
  );
}

/** Save or unsave a slide for the signed-in person (kept on the server when there is a database, FD-18). */
export function useSavedToggle() {
  const { announce } = useNotify();
  const { savedIds, toggleSaved } = useAccount();
  const isSaved = (id: string) => savedIds.has(id);
  const toggle = (slide: SlideSummary) => {
    const was = isSaved(slide.id);
    toggleSaved(slide);
    announce(was ? `Removed from saved: ${slide.title}` : `Saved: ${slide.title}`);
  };
  return { isSaved, toggle };
}

/** "Why it fits": on a phone two lines, and a small arrow opens the rest. */
function WhyBox({ why, aiRead }: { why: string; aiRead?: boolean }) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = text.current;
    if (!el || open) return;
    const measure = () => setOver(el.scrollHeight > el.clientHeight + 1);
    const frame = requestAnimationFrame(measure);
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [why, open]);
  return (
    <div className="matched">
      <b>
        {aiRead && <Icon name="sparkle" className="ic-sm" />}
        Why it fits
      </b>
      <span ref={text} className={`why-text${open ? ' is-open' : ''}`}>
        {why}
      </span>
      {(over || open) && (
        <button type="button" className="why-more" aria-expanded={open} aria-label={open ? 'Show less of why it fits' : 'Read more of why it fits'} onClick={() => setOpen((o) => !o)}>
          <Icon name="down" />
        </button>
      )}
    </div>
  );
}

/** Slide card: preview, tick-to-add, where it came from, "also in N other decks". */
export function SlideCard({ slide, list, why, aiRead, note, num }: { slide: SlideSummary; list: SlideSummary[]; why?: string; aiRead?: boolean; note?: string; /** the slide's place in the deck page (1, 2, 3...) */ num?: number }) {
  const { openPreview, openAlso } = useOverlays();
  const { isSelected, set } = useCartToggle();
  const { packs } = useLibrary();
  const pack = packs.of(slide.id);
  const { isSaved, toggle: toggleSave } = useSavedToggle();
  const sel = isSelected(slide.id);
  const saved = isSaved(slide.id);
  const p = slide.provenance;
  const meta = [clientOf(slide), yearOf(slide), categoryOf(slide)].filter((x) => x !== null).join(' · ');
  return (
    <article className={`card vcard${sel ? ' is-selected' : ''}`} data-card={slide.id}>
      <div className="thumbwrap">
        <button
          type="button"
          className="thumb"
          aria-label={`Preview: ${slide.title}`}
          onClick={() =>
            openPreview(
              list,
              Math.max(
                0,
                list.findIndex((s) => s.id === slide.id),
              ),
            )
          }
        >
          <Thumb slide={slide} />
          <span className="zoom" aria-hidden="true">
            <Icon name="expand" className="ic-sm" />
          </span>
        </button>
        <label className="pick">
          <input type="checkbox" checked={sel} onChange={(e) => set(slide, e.target.checked)} aria-label={`Add to draft deck: ${slide.title}`} />
          <span className="box" aria-hidden="true">
            <Icon name="check" />
          </span>
          <span className="pick-tip" aria-hidden="true">
            {sel ? 'Remove from draft deck' : 'Add to draft deck'}
          </span>
        </label>
        {num !== undefined && (
          <span className="slide-num" aria-hidden="true">
            {num}
          </span>
        )}
        {pack && <PackBadge pack={pack} slideId={slide.id} />}
        {(slide.hiddenInSource || p.archived) && (
          <span className="thumb-badge">
            {p.archived && <span className="badge badge-archived">Archived</span>}
            {slide.hiddenInSource && <span className="badge">Hidden in source</span>}
          </span>
        )}
        <button
          type="button"
          className={`save-tg${saved ? ' is-saved' : ''}`}
          title={saved ? 'Saved' : 'Save'}
          aria-pressed={saved}
          aria-label={saved ? `Remove from saved: ${slide.title}` : `Save: ${slide.title}`}
          onClick={() => toggleSave(slide)}
        >
          <Icon name="heart" />
        </button>
      </div>
      <div className="card-body">
        <Link className="card-title" to={{ view: 'slide', id: slide.id }} title={slide.title}>
          {slide.title}
        </Link>
        {/* On the deck page every slide is from the same deck, so the client, year and type line is left out. */}
        {num === undefined && (
        <div className="meta-row">
          {/* Hover: the whole line, when it is cut off ("Next Level Games · 2025 · Design Consultancy"). */}
          <span
            className="meta-wrap"
            hidden={num !== undefined}
            data-tip-pos="start"
            onMouseEnter={(e) => {
              const w = e.currentTarget;
              const m = w.querySelector<HTMLElement>('.meta');
              /* Only when the line is cut off, so the full words can be read; the deck's file name adds nothing here. */
              const cut = (() => {
                if (!m) return false;
                if (m.scrollWidth > m.clientWidth || m.scrollHeight > m.clientHeight + 1) return true;
                /* scrollWidth can miss an ellipsis, so the words' own width is checked too. */
                const r = document.createRange();
                r.selectNodeContents(m);
                return r.getBoundingClientRect().width > m.clientWidth;
              })();
              if (cut) w.setAttribute('data-tip', meta || p.sourceTitle);
              else w.removeAttribute('data-tip');
            }}
          >
            <div className="meta clip">{meta || p.sourceTitle}</div>
          </span>
          {slide.alsoIn && num === undefined && (
            <button
              type="button"
              className="also"
              aria-label={`Also in ${plural(slide.alsoIn.otherDeckCount, 'other deck')}`}
              data-tip={`Also in ${plural(slide.alsoIn.otherDeckCount, 'deck')}`}
              data-tip-pos="end"
              onClick={() => openAlso(slide)}
            >
              <Icon name="folders" className="ic-sm" />
              <span aria-hidden="true">{slide.alsoIn.otherDeckCount}</span>
            </button>
          )}
        </div>
        )}
        <CompactTags slide={slide} />
        {/* In a deck, the card says it in words under the tags instead of showing a bare icon and number. */}
        {num !== undefined && slide.alsoIn && (
          <button type="button" className="also-line" aria-label={`Also in ${plural(slide.alsoIn.otherDeckCount, 'other deck')}`} data-tip={`Also in ${plural(slide.alsoIn.otherDeckCount, 'other deck')}`} data-tip-pos="up start" onClick={() => openAlso(slide)}>
            <Icon name="folders" className="ic-sm" />
            <span className="also-words">Also in {plural(slide.alsoIn.otherDeckCount, 'other deck')}</span>
            <span className="also-n" aria-hidden="true">{slide.alsoIn.otherDeckCount}</span>
          </button>
        )}
        {note && (
          <div className="card-note">
            <Icon name="download" className="ic-sm" />
            {note}
          </div>
        )}
        {why && <WhyBox why={why} aiRead={aiRead} />}
        {num === undefined && (
          <div className="card-foot">
            <CardVotes slide={slide} />
          </div>
        )}
      </div>
    </article>
  );
}

/** Deck card: a 2×2 mosaic of its first real slide previews. */
export function DeckCard({ deck }: { deck: Deck }) {
  const { openArchiveDialog } = useOverlays();
  const first = deck.slides.slice(0, 4);
  const cells = [...first, ...Array.from({ length: 4 - first.length }, () => null)];
  return (
    <article className="card vcard" data-deck={deck.id}>
      <button
        type="button"
        className="deck-arch"
        title={deck.archived ? 'Restore this deck' : 'Archive this deck'}
        aria-label={`${deck.archived ? 'Restore' : 'Archive'} deck: ${deck.title}`}
        onClick={() => openArchiveDialog({ deck: { id: deck.id, title: deck.title, slideCount: deck.slides.length }, restore: !!deck.archived })}
      >
        <Icon name="archive" />
      </button>
      {deck.archived && <span className="deck-arch-badge badge badge-archived">Archived</span>}
      <Link to={{ view: 'deck', id: deck.id }} tabIndex={-1} ariaHidden>
        <div className="mosaic" aria-hidden="true">
          {cells.map((s, i) =>
            s ? (
              <div key={s.id}>
                <Thumb slide={s} />
              </div>
            ) : (
              <div key={`e${i}`} className="ph" />
            ),
          )}
        </div>
      </Link>
      <div className="card-body">
        <Link className="card-title" to={{ view: 'deck', id: deck.id }}>
          {deck.title}
        </Link>
        <div className="meta clip">
          Deck · {plural(deck.slides.length, 'slide')}
          {deck.year ? ` · ${deck.year}` : ''}
        </div>
        <div className="meta clip" title={folderLabel(deck)}>
          <Icon name="folder" className="ic-sm" /> {folderLabel(deck)}
        </div>
      </div>
    </article>
  );
}

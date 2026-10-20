'use client';

import type { MouseEvent, ReactNode } from 'react';
import type { SlideSummary } from '../contracts/dto';
import type { Location } from '../contracts/runtime';
import { Icon, type IconName } from './icons';
import { categoryOf, clientOf, plural, yearOf, type Deck, folderLabel } from './library';
import { simTier, TIER_LABEL, TIER_TEXT, type Tier } from './simulation';
import { useWorkspace } from './state';

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
  const { runtime } = useWorkspace();
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
  const { runtime } = useWorkspace();
  // eslint-disable-next-line @next/next/no-img-element -- previews come from the injected API, not next/image
  return (
    <img
      src={runtime.assetUrl(slide.previewPath)}
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

/** Add to or remove from the cart. */
export function useCartToggle() {
  const { selection, updateSelection, announce, toast } = useWorkspace();
  const isSelected = (id: string) => selection.some((s) => s.id === id);
  const set = (slide: SlideSummary, on: boolean) => {
    if (on && !selection.some((s) => s.id === slide.id)) toast(`Added. ${plural(selection.length + 1, 'slide')} ready`);
    updateSelection((cur) => {
      const has = cur.some((s) => s.id === slide.id);
      if (on && !has) return [...cur, slide];
      if (!on && has) return cur.filter((s) => s.id !== slide.id);
      return cur;
    });
    announce(on ? `Added to draft deck: ${slide.title}` : `Removed from draft deck: ${slide.title}`);
  };
  return { isSelected, set };
}

/** Orange mark for anything simulated on the front end only (FD-14). */
export function SimFlag({ children = 'Simulated' }: { children?: ReactNode }) {
  return <span className="sim-flag">{children}</span>;
}

/** Approval status (simulated): Approved, Awaiting approval or Out of date. */
export function StatusBadge({ tier }: { tier: Tier }) {
  return (
    <span className="badge sim" title={`${TIER_TEXT[tier]} (Simulated)`}>
      <span className="sr-only">Status: </span>
      <span className={`tier-ic tier-ic-${tier.toLowerCase()}`} aria-hidden="true">
        <Icon name={tier === 'Approved' ? 'check' : tier === 'Suggested' ? 'clock' : 'minus'} className="ic-sm" />
      </span>
      {TIER_LABEL[tier]}
    </span>
  );
}

/** Local design prototype: save a slide to the signed-in demo profile (not pushed). */
export function useSavedToggle() {
  const { savedIds, toggleSaved, announce } = useWorkspace();
  const isSaved = (id: string) => savedIds.has(id);
  const toggle = (slide: SlideSummary) => {
    const was = isSaved(slide.id);
    toggleSaved(slide);
    announce(was ? `Removed from saved: ${slide.title}` : `Saved: ${slide.title}`);
  };
  return { isSaved, toggle };
}

/** Slide card: preview, tick-to-add, where it came from, "also in N other decks". */
export function SlideCard({ slide, list, why, note }: { slide: SlideSummary; list: SlideSummary[]; why?: string; note?: string }) {
  const { openPreview, openAlso } = useWorkspace();
  const tier = simTier(slide);
  const { isSelected, set } = useCartToggle();
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
        {tier !== 'Retired' && (
          <label className="pick">
            <input type="checkbox" checked={sel} onChange={(e) => set(slide, e.target.checked)} aria-label={`Add to draft deck: ${slide.title}`} />
            <span className="box" aria-hidden="true">
              <Icon name="check" />
            </span>
            <span className="pick-tip" aria-hidden="true">
              {sel ? 'Remove from draft deck' : 'Add to draft deck'}
            </span>
          </label>
        )}
        {(tier !== 'Approved' || slide.hiddenInSource) && (
          <span className="thumb-badge">
            {tier !== 'Approved' && <StatusBadge tier={tier} />}
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
        <Link className="card-title" to={{ view: 'slide', id: slide.id }}>
          {slide.title}
        </Link>
        <div className="meta clip" title={`Slide ${p.slideNumber} of ${p.sourceTitle}`}>
          {meta || p.sourceTitle}
        </div>
        {slide.alsoIn && (
          <button
            type="button"
            className="also"
            title={slide.alsoIn.match === 'near' ? 'A nearly identical slide is in other decks' : 'The same slide is in other decks'}
            onClick={() => openAlso(slide)}
          >
            <Icon name="copy" className="ic-sm" />
            Also in {plural(slide.alsoIn.otherDeckCount, 'other deck')}
          </button>
        )}
        {note && (
          <div className="sim-note">
            <Icon name="download" className="ic-sm" />
            {note}
          </div>
        )}
        {why && (
          <div className="matched">
            <b>
              <Icon name="sparkle" className="ic-sm" />
              Why it fits
            </b>
            {why}
          </div>
        )}
      </div>
    </article>
  );
}

/** Deck card: a 2×2 mosaic of its first real slide previews. */
export function DeckCard({ deck }: { deck: Deck }) {
  const first = deck.slides.slice(0, 4);
  const cells = [...first, ...Array.from({ length: 4 - first.length }, () => null)];
  return (
    <article className="card vcard" data-deck={deck.id}>
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

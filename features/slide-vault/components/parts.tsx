'use client';

import { CardVotes } from './SlideActions';
import { CompactTags } from './TagBits';
import type { MouseEvent, ReactNode } from 'react';
import type { SlideSummary } from '../contracts/dto';
import type { Location } from '../contracts/runtime';
import { packPosition, type Pack } from '../client/packs';
import { Icon, type IconName } from './icons';
import { categoryOf, clientOf, plural, yearOf, type Deck, folderLabel } from './library';
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

/**
 * Add a whole deck section to the draft deck (FD-80). If some of its slides belong to a pack that also has slides outside
 * the section, ask first (the pack pop-up); otherwise add it at once. `addNow` skips the question.
 */
export function useAddSection() {
  const { selection, updateSelection, announce, toast, packs, openPackDialog } = useWorkspace();
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
  const { selection, updateSelection, announce, toast, packs, openPackDialog } = useWorkspace();
  const isSelected = (id: string) => selection.some((s) => s.id === id);
  const setOne = (slide: SlideSummary, on: boolean) => {
    if (on && !selection.some((s) => s.id === slide.id)) toast(`Added. ${plural(selection.length + 1, 'slide')} ready`);
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
  const { isSelected, set } = useCartToggle();
  const { packs } = useWorkspace();
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
        <div className="meta-row">
          {/* Hover: the whole line when it is cut off ("Harbor Studio · 2025 · Design Consultancy"), else where the slide is from. */}
          <span
            className="meta-wrap"
            data-tip-pos="start"
            onMouseEnter={(e) => {
              const w = e.currentTarget;
              const m = w.querySelector<HTMLElement>('.meta');
              w.setAttribute('data-tip', m && m.scrollWidth > m.clientWidth ? meta || p.sourceTitle : `Slide ${p.slideNumber} of ${p.sourceTitle}`);
            }}
          >
            <div className="meta clip">{meta || p.sourceTitle}</div>
          </span>
          {slide.alsoIn && (
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
        <CompactTags slide={slide} />
        {note && (
          <div className="card-note">
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
        <div className="card-foot">
          <CardVotes slide={slide} />
        </div>
      </div>
    </article>
  );
}

/** Deck card: a 2×2 mosaic of its first real slide previews. */
export function DeckCard({ deck }: { deck: Deck }) {
  const { openArchiveDialog } = useWorkspace();
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

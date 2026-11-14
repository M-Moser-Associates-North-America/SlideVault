'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { getSlide, listTags, searchTagSuggestions, tagSuggestions, type TagSuggestionItem } from '../client/api';
import { demoTagsOn, ranked, TagsUnavailable, useTags, type TagsApi } from '../client/tag-store';
import type { FreeTag, SlideDetail, SlideStory, SlideSummary, TagRemoval } from '../contracts/dto';
import { useEdgeFade } from './edge-fade';
import { FoldPanel } from './fold-panel';
import { Icon } from './icons';
import { plural, type Deck } from './library';
import { hideTip, showTip } from './fixed-tip';
import { useWorkspaceCompact, useWorkspacePhoneLike } from './size';
import { useWorkspace } from './state';
import { cleanTag, type TagSuggestion } from './TagField';

/* Tags on cards, the preview, the slide page and the deck page (FD-72). Quiet by default: small grey
   pills that turn orange on hover; votes, remove and the removal log only where there is room. */

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const words = (s: string) => {
  const t = s.replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** What the hover says: who added the tag and when. */
function tipFor(t: FreeTag): string {
  return `Added by ${t.addedBy} · ${day(t.addedAt)}`;
}

/* The same two small dialog helpers as Dialogs.tsx, kept here so the preview (Dialogs.tsx) can use this file without a circular import. */
function useDialogOpen(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [ref, open]);
}
const backdropClose = (onClose: () => void) => (e: MouseEvent<HTMLDialogElement>) => {
  if (e.target === e.currentTarget) onClose();
};

/* ---------------------------------------------------------------- Helpers */

/** Tags already in use, so adding one reuses the library's spelling. One request for the whole session. */
let knownPromise: Promise<TagSuggestion[]> | null = null;
function useKnownTags(): TagSuggestion[] {
  const { runtime } = useWorkspace();
  const [known, setKnown] = useState<TagSuggestion[]>([]);
  useEffect(() => {
    let live = true;
    knownPromise ??= listTags(runtime).catch(() => []);
    knownPromise.then((k) => live && setKnown(k));
    return () => {
      live = false;
    };
  }, [runtime]);
  return known;
}

/** The slide's tags as the server sent them. Library slides carry none, so the preview asks once for the slide's detail. */
const seeds = new Map<string, FreeTag[]>();
function useSeed(slide: SlideSummary, loaded?: FreeTag[]): FreeTag[] | undefined {
  const { runtime } = useWorkspace();
  const [fetched, setFetched] = useState<{ id: string; tags: FreeTag[] } | null>(null);
  const need = slide.tags === undefined && loaded === undefined && !demoTagsOn();
  useEffect(() => {
    if (!need || seeds.has(slide.id)) return;
    const controller = new AbortController();
    getSlide(runtime, slide.id, controller.signal).then(
      (d) => {
        seeds.set(slide.id, d.tags ?? []);
        setFetched({ id: slide.id, tags: d.tags ?? [] });
      },
      () => {},
    );
    return () => controller.abort();
  }, [need, runtime, slide.id]);
  return slide.tags ?? loaded ?? seeds.get(slide.id) ?? (fetched?.id === slide.id ? fetched.tags : undefined);
}

function useTagSearch(onNavigate?: () => void) {
  const { runtime, typeQuery, submitSearch } = useWorkspace();
  return (tag: string) => {
    onNavigate?.();
    typeQuery(tag);
    submitSearch(tag);
    runtime.navigate({ view: 'pages' });
  };
}

/* ---------------------------------------------------------------- One tag */

/** One of six soft hues per tag, the same everywhere, so tags look different from the grey action buttons. */
export const hueOf = (tag: string) => [...tag.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 5) % 6;

/** When a chip's text is cut off ("Workplace str…"), hover or focus names it in full. Nothing when it fits. */
function nameWhenCut(e: { currentTarget: HTMLElement }, text: string) {
  const b = e.currentTarget;
  const t = b.querySelector<HTMLElement>('.tag-t');
  b.removeAttribute('data-tip');
  if (t && t.scrollWidth > t.clientWidth) showTip(b, text);
  else hideTip();
}

/** A small pill. Click to search for it; hover or focus says who added it. */
export function TagChip({ tag, onNavigate }: { tag: FreeTag; onNavigate?: () => void }) {
  const search = useTagSearch(onNavigate);
  const tipId = useId();
  return (
    <>
      <button type="button" className="tag" data-h={hueOf(tag.tag)} aria-describedby={tipId} onClick={() => search(tag.tag)} onMouseEnter={(e) => nameWhenCut(e, tag.tag)} onFocus={(e) => nameWhenCut(e, tag.tag)} onMouseLeave={hideTip} onBlur={hideTip}>
        <span className="tag-t">{tag.tag}</span>
      </button>
      <span id={tipId} className="sr-only">
        {tipFor(tag)}. Search for this tag.
      </span>
    </>
  );
}

/* ---------------------------------------------------------------- The team's labels */

/** One of the team's reviewed labels for a slide (Schiffon's story tags, FD-53), shown like a tag. */
export type TeamLabel = { text: string; what: string };

/** A slide's reviewed labels, most telling first: its type, the sectors and themes it proves, its projects, its role. */
export function teamLabels(story: SlideStory | null | undefined): TeamLabel[] {
  if (!story) return [];
  const all: TeamLabel[] = [
    ...(story.type ? [{ text: words(story.type), what: 'Slide type' }] : []),
    ...story.sectors.map((x) => ({ text: words(x), what: 'Sector' })),
    ...story.themes.map((x) => ({ text: words(x), what: 'Theme' })),
    ...story.projects.map((x) => ({ text: x, what: 'Project' })),
    ...(story.role ? [{ text: words(story.role), what: 'Role' }] : []),
  ];
  const seen = new Set<string>();
  return all.filter((l) => !seen.has(l.text.toLowerCase()) && !!seen.add(l.text.toLowerCase()));
}

/** Does this label say something the person typed? Those go first on a card. */
const matchesQuery = (text: string, query: string) => {
  const t = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((w) => w.length >= 3 && t.includes(w.replace(/(es|s)$/, '')));
};

/** A team label as a small pill: plain grey with no colour, so it never looks like something a colleague typed. Click to search for it. */
export function TeamChip({ label, onNavigate }: { label: TeamLabel; onNavigate?: () => void }) {
  const search = useTagSearch(onNavigate);
  return (
    <button type="button" className="tag tag-team" aria-label={`${label.text}. ${label.what}, reviewed by the team. Search for it.`} onClick={() => search(label.text)} onMouseEnter={(e) => nameWhenCut(e, label.text)} onFocus={(e) => nameWhenCut(e, label.text)} onMouseLeave={hideTip} onBlur={hideTip}>
      <span className="tag-t">{label.text}</span>
    </button>
  );
}

/**
 * "+3": the rest of a card's tags, one below the other in a small card at the bottom right of the "+3",
 * on hover (with a mouse) or click (a tap, or Enter). The card is drawn at the top of the feature, not inside
 * the slide card, so it can reach past the slide card's edge; it flips to the left or above when there is no room.
 */
function MoreTags({ names }: { names: string[] }) {
  const search = useTagSearch();
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const open = pinned || hover;
  const placed = at !== null;
  const close = () => {
    setPinned(false);
    setHover(false);
  };

  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return setAt(null);
    const r = button.current.getBoundingClientRect();
    const w = menu.current.offsetWidth;
    const h = menu.current.offsetHeight;
    const left = r.left + w > window.innerWidth - 8 ? Math.max(8, r.right - w) : r.left;
    const top = r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    setAt({ top, left });
  }, [open, names.length]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close();
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => setRoot(button.current?.closest<HTMLElement>('.slidevault') ?? null), []);

  /* Opened with a click or Enter: move into the list, so the keyboard can reach it; Escape comes back. */
  useEffect(() => {
    if (pinned) menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [pinned, placed]);

  const enter = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(timer.current);
    setHover(true);
  };
  const leave = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    timer.current = window.setTimeout(() => setHover(false), 150);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="tag-more"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${plural(names.length, 'more tag')}`}
        onClick={() => setPinned((p) => !p)}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        +{names.length}
      </button>
      {open &&
        root &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="group"
            aria-label="More tags"
            className="tagmenu"
            style={{ top: at?.top ?? 0, left: at?.left ?? 0, visibility: at ? 'visible' : 'hidden' }}
            onPointerEnter={enter}
            onPointerLeave={leave}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                close();
                button.current?.focus();
              }
            }}
          >
            {names.map((n) => (
              <button
                key={n}
                type="button"
                className="tag tagmenu-item"
                data-h={hueOf(n)}
                onClick={() => {
                  close();
                  search(n);
                }}
              >
                <span className="tag-t">{n}</span>
              </button>
            ))}
          </div>,
          root,
        )}
    </>
  );
}

/* ---------------------------------------------------------------- Cards */

/**
 * The two most relevant tags, small, under a card's title, then "+N" for the rest (hover, focus or click).
 * Ones that match the search come first, then the people's tags (the slide's own, then its deck's), then
 * the team's labels. Nothing at all when the slide has none.
 */
export function CompactTags({ slide }: { slide: SlideSummary }) {
  const { runtime, profile, query } = useWorkspace();
  const compact = useWorkspaceCompact();
  const own = useTags(runtime, profile, 'slide', slide.id, slide.tags);
  const deck = useTags(runtime, profile, 'deck', slide.provenance.sourceId, slide.tags);
  type Item = { key: string; text: string; node: ReactElement };
  const items: Item[] = [
    ...[...ranked(own.shown), ...ranked(deck.shown)].map((t) => ({ key: `p${t.id}`, text: t.tag, node: <TagChip key={`p${t.id}`} tag={t} /> })),
    ...teamLabels(slide.story).map((l) => ({ key: `t${l.what}${l.text}`, text: l.text, node: <TeamChip key={`t${l.what}${l.text}`} label={l} /> })),
  ];
  const q = query.trim();
  const all = q ? [...items.filter((i) => matchesQuery(i.text, q)), ...items.filter((i) => !matchesQuery(i.text, q))] : items;
  /* A card without tags keeps an empty row when other cards on the page have tags, so everything below lines up. */
  if (all.length === 0) return <div className="tags-spacer" aria-hidden="true" />;
  /* Phones: every tag, in one row that scrolls sideways (no "+N" to open). Tablets and desktop: two tags, then "+N". */
  if (compact) return <ScrollingTags nodes={all.map((i) => i.node)} />;
  const more = all.slice(2);
  return (
    <div className="tags-compact" role="group" aria-label="Tags">
      {all.slice(0, 2).map((i) => i.node)}
      {more.length > 0 && <MoreTags names={more.map((i) => i.text)} />}
    </div>
  );
}

/** The preview's tags (the slide's own, the deck's, the team's): wrapped on wide screens, one row that scrolls sideways on a phone. */
function TagLine({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEdgeFade(ref);
  return (
    <div className="tag-line" ref={ref}>
      {children}
    </div>
  );
}

function ScrollingTags({ nodes }: { nodes: ReactElement[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEdgeFade(ref);
  return (
    <div className="tags-compact is-scroll" role="group" aria-label="Tags" ref={ref}>
      {nodes}
    </div>
  );
}

/* ---------------------------------------------------------------- Editing */

/** "Are you sure?" before anything is removed. Cancel has focus, so Enter never deletes by accident. */
export function ConfirmDialog({ open, title, kind, subject, detail, lead, confirmLabel, onCancel, onConfirm }: { open: boolean; title: string; kind: string; subject: string; detail?: string; lead: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  const { runtime } = useWorkspace();
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useDialogOpen(ref, open);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  return (
    <dialog ref={ref} className="slidevault sv-dialog" data-theme={runtime.theme} aria-labelledby={titleId} onClose={onCancel} onClick={backdropClose(onCancel)}>
      <div className="dlg-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={onCancel}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dlg-body arch-body">
        <div className="arch-deck">
          <span className="arch-label">{kind}</span>
          <span className="arch-name">{subject}</span>
          {detail && <span className="meta">{detail}</span>}
        </div>
        <p className="arch-lead">{lead}</p>
      </div>
      <div className="dlg-foot">
        <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/**
 * A small dashed "+ Add tag" pill that sits in the row with the tags. Click it and it becomes a small box
 * in the same place; suggestions from tags already in use open above it. Enter (or a comma) adds the tag
 * and keeps the box open for the next one; Escape or clicking away closes it.
 */
export function AddTagPill({ label, known, have, disabled, onAdd }: { label: string; known: TagSuggestion[]; have: string[]; disabled?: boolean; onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const id = useId();
  const typed = cleanTag(text);
  const taken = (t: string) => have.some((h) => h.toLowerCase() === t.toLowerCase());
  const q = typed.toLowerCase();
  const options = open
    ? [
        ...(typed && !taken(typed) && !known.some((k) => k.tag.toLowerCase() === q) ? [{ tag: typed, create: true }] : []),
        ...known.filter((k) => !taken(k.tag) && (!q || k.tag.toLowerCase().includes(q))).slice(0, 5).map((k) => ({ tag: k.tag, create: false })),
      ]
    : [];
  const close = () => {
    setOpen(false);
    setText('');
    setActive(-1);
  };
  const add = (name: string) => {
    const t = cleanTag(name);
    if (!t || taken(t)) return setText('');
    onAdd(known.find((k) => k.tag.toLowerCase() === t.toLowerCase())?.tag ?? t); /* the library's own spelling wins */
    setText('');
    setActive(-1);
  };
  if (!open) {
    return (
      <button
        ref={pill}
        type="button"
        className="tag-add"
        disabled={disabled}
        aria-label={label}
        onClick={() => {
          setOpen(true);
          setTimeout(() => input.current?.focus(), 0);
        }}
      >
        <Icon name="plus" className="ic-sm" />
        Add tag
      </button>
    );
  }
  return (
    <span className="tag-input-wrap">
      <input
        ref={input}
        className="tag-input"
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={options.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={active >= 0 ? `${id}-o${active}` : undefined}
        aria-autocomplete="list"
        value={text}
        maxLength={80}
        placeholder="Tag name"
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(',')) add(v.slice(0, -1));
          else setText(v);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(options.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(-1, i - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault(); /* never submits a form around it */
            add(active >= 0 ? options[active].tag : text);
          } else if (e.key === 'Escape') {
            e.stopPropagation(); /* closes the box, not the preview around it */
            e.preventDefault();
            close();
            pill.current?.focus();
          }
        }}
        onBlur={close}
      />
      {options.length > 0 && (
        <ul className="tag-sugg" id={`${id}-list`} role="listbox">
          {options.map((o, i) => (
            <li key={o.tag} id={`${id}-o${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => add(o.tag)}>
              {o.create ? `Add “${o.tag}”` : o.tag}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/**
 * "Suggested" tags (FD-82): small dashed pills beside "+ Add tag", from the slides closest in meaning. One
 * click adds the tag the normal way; nothing is added until then (Alina: AI suggestions stay suggestions
 * until a person confirms). Tags already there are left out; nothing shows when there are none.
 */
const MAX_SUGGESTED_TAGS = 3;

export function SuggestedTagChips({ suggestions, have, disabled, onAdd, label = 'Suggested tags', lead }: { suggestions: TagSuggestionItem[]; have: string[]; disabled?: boolean; onAdd: (tag: string) => void; label?: string; /** shown first, in the same row (the "Add tag" pill); outside the scrolling part so its menu is never clipped */ lead?: ReactElement }) {
  /* Only the three best fits (the list arrives best first), so the row stays short and a person is not made to pick through a long one. */
  const left = suggestions.filter((s) => !have.some((h) => h.toLowerCase() === s.tag.toLowerCase())).slice(0, MAX_SUGGESTED_TAGS);
  const row = useRef<HTMLDivElement>(null);
  useEdgeFade(row);
  if (!left.length) return lead ? <div className="tag-addrow">{lead}</div> : null;
  const chips = (
    <div className="tag-suggested" role="group" aria-label={label} ref={row}>
      <span className="meta">Suggested</span>
      {left.map((s) => (
        <button
          key={s.tag}
          type="button"
          className="tag-add tag-suggest"
          disabled={disabled}
          aria-label={`Add suggested tag ${s.tag}`}
          data-tip={s.from === 'people' ? 'Colleagues tagged similar slides with this' : s.from === 'ai' ? 'Read from your slides by the AI' : s.from === 'search' ? 'What your search was read as' : 'From slides similar to this one'}
          onClick={() => onAdd(s.tag)}
        >
          <Icon name="plus" className="ic-sm" />
          {s.tag}
        </button>
      ))}
    </div>
  );
  return lead ? (
    <div className="tag-addrow">
      {lead}
      {chips}
    </div>
  ) : (
    chips
  );
}

/** The suggestions for one saved slide; empty while loading, for sample decks, or when meaning search isn't set up. */
function useSlideTagSuggestions(slideId: string | undefined): TagSuggestionItem[] {
  const { runtime, search } = useWorkspace();
  /* Kept with the slide they belong to, so moving to another slide never shows the last one's suggestions. */
  const [got, setGot] = useState<{ id: string; list: TagSuggestionItem[] } | null>(null);
  useEffect(() => {
    if (!slideId) return;
    const ctrl = new AbortController();
    tagSuggestions(runtime, slideId, ctrl.signal).then(
      (list) => !ctrl.signal.aborted && setGot({ id: slideId, list }),
      () => {},
    );
    return () => ctrl.abort();
  }, [runtime, slideId]);
  const similar = slideId && got?.id === slideId ? got.list : [];
  /* What the search that found this slide was read as comes first (FD-97); then tags from similar slides in other decks. */
  const fromSearch = searchTagSuggestions(search.status === 'ready' ? search.result : null, slideId);
  return [...fromSearch, ...similar.filter((s) => !fromSearch.some((f) => f.tag.toLowerCase() === s.tag.toLowerCase()))].slice(0, MAX_SUGGESTED_TAGS);
}

/**
 * Tags on something that isn't saved yet (a slide in the Upload screen): the same small pills and the same
 * "+ Add tag" as everywhere else. `inherited` are tags that already apply (the deck's); they show first and
 * can't be removed here.
 */
export function LocalTagList({ label, value, onChange, inherited = [], inheritedTip, suggestions, suggested = [], disabled, auto = [] }: { auto?: string[]; label: string; value: string[]; onChange: (next: string[]) => void; inherited?: string[]; inheritedTip?: string; suggestions: TagSuggestion[]; suggested?: TagSuggestionItem[]; disabled?: boolean }) {
  const own = value.filter((t) => !inherited.some((i) => i.toLowerCase() === t.toLowerCase()));
  return (
    <ul className="tagrows" aria-label={label}>
      {inherited.map((t) => (
        <li key={`d-${t}`} className="tagrow">
          <span className="tag is-static is-deck" data-h={hueOf(t)} data-tip={inheritedTip}>
            <span className="tag-t">{t}</span>
          </span>
        </li>
      ))}
      {own.map((t) => (
        <li key={t} className="tagrow">
          <span className={`tag is-static${auto.some((a) => a.toLowerCase() === t.toLowerCase()) ? ' is-auto' : ''}`} data-h={hueOf(t)}>
            {auto.some((a) => a.toLowerCase() === t.toLowerCase()) && <Icon name="sparkle" className="ic-sm" />}
            <span className="tag-t">{t}</span>
          </span>
          <button type="button" className="tagx" aria-label={`Remove tag ${t}`} data-tip="Remove" disabled={disabled} onClick={() => onChange(own.filter((x) => x !== t))}>
            <Icon name="x" />
          </button>
        </li>
      ))}
      {own.length + inherited.length < 10 && (
        <li className="tagrow">
          <AddTagPill label={label} known={suggestions} have={[...inherited, ...own]} disabled={disabled} onAdd={(name) => onChange([...own, name])} />
        </li>
      )}
      {own.length + inherited.length < 10 && suggested.length > 0 && (
        <li className="tagrow">
          <SuggestedTagChips label={`Suggested tags for ${label.replace(/^Tags for /, '')}`} suggestions={suggested} have={[...inherited, ...own]} disabled={disabled} onAdd={(name) => onChange([...own, name])} />
        </li>
      )}
    </ul>
  );
}

/**
 * The tags of one slide or deck: each as a pill with a remove button; an add box; the removal log
 * folded away underneath.
 */
function TagList({ api, what, canEdit, onNavigate, suggestFor, tail, addRow, lead }: { api: TagsApi; /** something fixed at the left end of the first row (the slide page: "also in other decks") */ lead?: ReactNode; what: 'slide' | 'deck'; canEdit: boolean; onNavigate?: () => void; /** more tag rows to show under these (the preview: the deck's tags and the team's labels) */ tail?: ReactElement | null; /** the "Add tag" pill goes in the suggestions row, under all the tags */ addRow?: boolean; /** a saved slide's id: show tag suggestions for it (FD-82) */ suggestFor?: string }) {
  const { toast, announce } = useWorkspace();
  const known = useKnownTags();
  const suggested = useSlideTagSuggestions(canEdit ? suggestFor : undefined);
  const [asking, setAsking] = useState<FreeTag | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => toast(e instanceof TagsUnavailable || e instanceof Error ? e.message : 'That did not work. Please try again.');

  const add = async (name: string) => {
    setBusy(true);
    try {
      await api.add(name);
      announce(`Added tag ${name}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  /* Bring a tag back: the server's restore keeps its adder and votes; without it the tag is added again as new. */
  const bringBack = async (r: TagRemoval) => {
    try {
      await api.restore(r);
    } catch (e) {
      if (!(e instanceof TagsUnavailable)) return fail(e);
      try {
        await api.add(r.tag);
      } catch (e2) {
        return fail(e2);
      }
    }
    announce(`Restored tag ${r.tag}`);
  };
  const remove = async (tag: FreeTag) => {
    setAsking(null);
    try {
      await api.remove(tag);
    } catch (e) {
      return fail(e);
    }
    const gone: TagRemoval = { id: tag.id, tag: tag.tag, on: tag.on, addedBy: tag.addedBy, removedBy: '', removedAt: '' };
    toast(`Removed “${tag.tag}”`, { label: 'Undo', run: () => void bringBack(gone) });
  };

  const row = (t: FreeTag) => (
    <li key={t.id} className="tagrow">
      <TagChip tag={t} onNavigate={onNavigate} />
      {canEdit && (
        <button type="button" className="tagx" aria-label={`Remove tag ${t.tag}`} data-tip="Remove" onClick={() => setAsking(t)}>
          <Icon name="x" />
        </button>
      )}
    </li>
  );

  return (
    <div className="taglist">
      {addRow ? (
        (api.shown.length > 0 || tail || lead) && (
          <div className="tag-first">
            {lead}
            <TagLine>
              {api.shown.length > 0 && <ul className="tagrows">{api.shown.map(row)}</ul>}
              {tail}
            </TagLine>
          </div>
        )
      ) : api.shown.length > 0 || canEdit ? (
        <ul className="tagrows">
          {api.shown.map(row)}
          {canEdit && (
            <li className="tagrow">
              <AddTagPill label={`Add a tag to this ${what}`} known={known} have={api.shown.map((t) => t.tag)} disabled={busy} onAdd={(name) => void add(name)} />
            </li>
          )}
        </ul>
      ) : (
        <p className="meta">No tags on this {what} yet.</p>
      )}
      {!addRow && tail}
      {canEdit && (
        <SuggestedTagChips
          label={`Suggested tags for this ${what}`}
          suggestions={suggested}
          have={api.shown.map((t) => t.tag)}
          disabled={busy}
          onAdd={(name) => void add(name)}
          lead={addRow ? <AddTagPill label={`Add a tag to this ${what}`} known={known} have={api.shown.map((t) => t.tag)} disabled={busy} onAdd={(name) => void add(name)} /> : undefined}
        />
      )}
      {!canEdit && <p className="meta">Only curators can change tags.</p>}
      {api.removed.length > 0 && (
        <details className="tagfold">
          <summary>Recently removed ({api.removed.length})</summary>
          <ul className="tagremoved">
            {api.removed.map((r) => (
              <li key={`${r.id}-${r.removedAt}`}>
                <span>
                  <b>{r.tag}</b>
                  {r.removedBy ? <span className="meta"> · removed by {r.removedBy}{r.removedAt ? `, ${day(r.removedAt)}` : ''}</span> : null}
                </span>
                {canEdit && (
                  <button type="button" className="btn-link" onClick={() => void bringBack(r)}>
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ConfirmDialog
        open={!!asking}
        title="Remove this tag?"
        kind={`Tag on this ${what}`}
        subject={asking?.tag ?? ''}
        detail={asking ? tipFor(asking) : undefined}
        lead="Everyone will stop seeing it here and in search. You can undo it right after, or restore it later."
        confirmLabel="Remove tag"
        onCancel={() => setAsking(null)}
        onConfirm={() => asking && void remove(asking)}
      />
    </div>
  );
}

const useCanEdit = () => useWorkspace().runtime.capabilities.has('metadata.edit');

/** The slide page: the slide's own tags, the deck's tags beside them (changed on the deck page), and the labels. */
export function SlideTagsPanel({ slide, loaded, also }: { slide: SlideSummary; loaded?: SlideDetail | null; /** the "also in other decks" icon, at the right of the heading */ also?: ReactNode }) {
  const { runtime, profile } = useWorkspace();
  const seed = useSeed(slide, loaded ? (loaded.tags ?? []) : undefined);
  const own = useTags(runtime, profile, 'slide', slide.id, seed, true);
  const deck = useTags(runtime, profile, 'deck', slide.provenance.sourceId, seed);
  const canEdit = useCanEdit();
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Tags</h2>
        {also}
      </div>
      <TagList api={own} what="slide" canEdit={canEdit} suggestFor={slide.id} />
      {deck.shown.length > 0 && (
        <div className="tags-fromdeck">
          <p className="meta">From the deck</p>
          <div className="tags-compact">
            {deck.shown.map((t) => (
              <TagChip key={t.id} tag={t} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** The preview: the slide's own tags, small. */
export function PreviewTags({ slide, onNavigate, lead }: { slide: SlideSummary; onNavigate: () => void; lead?: ReactNode }) {
  const { runtime, profile } = useWorkspace();
  const seed = useSeed(slide);
  const own = useTags(runtime, profile, 'slide', slide.id, seed);
  const deck = useTags(runtime, profile, 'deck', slide.provenance.sourceId, seed);
  const canEdit = useCanEdit();
  const team = teamLabels(slide.story);
  if (seed === undefined && !demoTagsOn() && team.length === 0 && !lead) return null;
  const more = (
    <>
      {deck.shown.length > 0 && (
        <div className="tags-compact" aria-label="Tags from the deck">
          {deck.shown.map((t) => (
            <TagChip key={t.id} tag={t} onNavigate={onNavigate} />
          ))}
        </div>
      )}
      {team.length > 0 && (
        <div className="tags-compact" role="group" aria-label="Labels from the team">
          {team.map((l) => (
            <TeamChip key={l.what + l.text} label={l} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </>
  );
  /* The slide's tags, the deck's and the team's first; the "Add tag" pill and the suggestions share the last row. */
  const withList = seed !== undefined || demoTagsOn();
  return <div className="lb-tags">{withList ? <TagList api={own} what="slide" canEdit={canEdit} onNavigate={onNavigate} suggestFor={slide.id} tail={more} addRow lead={lead} /> : lead ? <div className="tag-first">{lead}<TagLine>{more}</TagLine></div> : <TagLine>{more}</TagLine>}</div>;
}

/** The deck page: the deck's tags, which every slide in it also shows. Read from any one slide's detail. */
export function DeckTags({ deck }: { deck: Deck }) {
  const { runtime, profile } = useWorkspace();
  const first = deck.slides[0];
  const [seed, setSeed] = useState<{ id: string; tags: FreeTag[] } | null>(null);
  useEffect(() => {
    if (!first || demoTagsOn()) return;
    const controller = new AbortController();
    getSlide(runtime, first.id, controller.signal).then(
      (d) => setSeed({ id: deck.id, tags: d.tags ?? [] }),
      () => {},
    );
    return () => controller.abort();
  }, [runtime, first, deck.id]);
  const api = useTags(runtime, profile, 'deck', deck.id, seed?.id === deck.id ? seed.tags : first?.tags, true);
  const canEdit = useCanEdit();
  const compact = useWorkspacePhoneLike();
  /* Phone: the tags in one row that scrolls sideways, and the "Add tag" pill under them, as in the preview and on the slide page. */
  return (
    <div className="deck-tags">
      <h2 className={compact ? 'sr-only' : 'h3'}>Tags</h2>
      <TagList api={api} what="deck" canEdit={canEdit} addRow={compact} />
    </div>
  );
}

/* ---------------------------------------------------------------- Labels */

/** The team's own labels for a slide (role, type, themes...), read only. A sparkle marks ones only the AI has read. */
export function SlideLabelsPanel({ story, fold, open }: { story: SlideStory | null | undefined; open?: boolean; /** phone: a card that opens and closes */ fold?: boolean }) {
  if (!story) return null;
  const confirmed = story.status === 'confirmed';
  const rows: [string, string | null][] = [
    ['Role', [story.role, story.type].filter(Boolean).map((x) => words(x as string)).join(' · ') || null],
    ['Reuse', story.reuse ? words(story.reuse) : null],
    ['Themes', story.themes.length ? story.themes.join(', ') : null],
    ['Sectors', story.sectors.length ? story.sectors.join(', ') : null],
    ['Projects', story.projects.length ? story.projects.join(', ') : null],
    ['Shows', story.shows],
    ['Convinces', story.convinces],
    ['Heads-up', story.flags.length ? story.flags.join('; ') : null],
  ];
  const shown = rows.filter((r): r is [string, string] => !!r[1]);
  if (shown.length === 0) return null;
  const body = (
    <>
      <dl className="trust">
        {shown.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="meta labels-source">
        {!confirmed && <Icon name="sparkle" className="ic-sm" />}
        {confirmed ? 'From the team’s review' : story.uncertain ? 'Suggested by AI, and it was unsure' : 'Suggested by AI, not yet confirmed'}
      </p>
    </>
  );
  if (fold) {
    return (
      <FoldPanel className="panel-about" open={open} title="About this slide" hint={shown[0] ? `${shown[0][0]}: ${shown[0][1]}` : undefined}>
        {body}
      </FoldPanel>
    );
  }
  return (
    <section className="panel panel-about">
      <h2>About this slide</h2>
      {body}
    </section>
  );
}

'use client';

import { Button } from './ui/Button';
import { startTransition, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { categoryOf, clientOf, countBy, createdByOf, filterCount, plural, SECTION_LABEL, slideMatches, tagsOf, uploadedByOf, yearOf, type Filters } from './library';
import { backdropClose, useDialogOpen } from './Dialogs';
import { DeeperAiToggle } from './DeeperAiToggle';
import { Link } from './parts';
import type { SlideSummary, SmartSearchChip } from '../contracts/dto';
import { rowReading, withoutChip } from './search-reading';
import { SLIDE_TYPES, hasSlideType } from './search-rules';
import { useHeroOut } from '../client/hero-visibility';
import { StickySearch } from './StickySearch';
import { HiddenToggle } from './HiddenToggle';
import { StoryLauncher } from './StoryLauncher';
import { useEdgeFade } from './edge-fade';
import { useResultsSummary } from '../client/results-summary';
import { useRoot } from './root';
import { peekHeight } from './scroll-peek';
import { useWorkspaceCompact, useWorkspaceFiltersRolled, useWorkspacePhoneUpright, useWorkspaceTabletLandscape, workspaceBounds } from './size';
import { useLibrary, useRuntime, useSearch } from './state';

/**
 * The slim filter row under the Home search box: one icon per filter. Hovering shows the name,
 * clicking opens a small panel where you can type to narrow the list or tick values. Year, client,
 * project type and slide type are always on the row; less-used filters sit behind the last icon
 * ("More"). Wide screens: the row sticks under the tabs and stays visible. Phones: one swipeable row
 * that scrolls away with the page, a "Filters" button that opens every filter in a bottom sheet, and
 * a small pinned "Filters" button once the row has scrolled out of view.
 */

type Key = 'year' | 'client' | 'category' | 'slideType' | 'section' | 'more';

const YEAR_PRESETS: [number, string][] = [
  [1, 'This year'],
  [2, 'Last 2 years'],
  [5, 'Last 5 years'],
];

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Height of the pinned tabs bar above, so the filter row can stick right underneath it. */
function useTopOffset(): number {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const measure = () => {
      const el = document.querySelector('.slidevault .sv-top');
      setTop(el && getComputedStyle(el).position === 'sticky' ? el.getBoundingClientRect().height : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return top;
}

/** A type-to-narrow list of tick boxes. */
function Picker({
  label,
  options,
  picked,
  counts,
  onToggle,
  single,
  collapsible,
}: {
  label: string;
  options: string[];
  picked: string[];
  counts?: Map<string, number>;
  onToggle: (v: string) => void;
  /** Only one can be picked: choosing another moves the tick */
  single?: boolean;
  /** In the Filters sheet: a long list shows the first few, with a button to open the rest, so there is no small scrolling box inside the scrolling sheet. */
  collapsible?: boolean;
}) {
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  /* The tick shows the moment it is pressed; the page (which has a lot to redraw) follows a beat later, and
     the pending tick gives way to the real choice as soon as that arrives. */
  const sig = picked.join('|');
  const [mine, setMine] = useState<{ sig: string; list: string[] } | null>(null);
  const showing = mine && mine.sig === sig ? mine.list : picked;
  const choose = (o: string) => {
    setMine({ sig, list: showing.includes(o) ? showing.filter((x) => x !== o) : single ? [o] : [...showing, o] });
    setTimeout(() => startTransition(() => onToggle(o)), 30);
  };
  const shown = options.filter((o) => o.toLowerCase().includes(text.trim().toLowerCase()));
  const id = useId();
  const SHORT = 5;
  const folded = !!collapsible && !expanded && text.trim() === '' && shown.length > SHORT;
  const listed = folded ? shown.filter((o, i) => i < SHORT || showing.includes(o)) : shown;
  /* A list taller than its box: stop halfway through the next option, so it is clear there is more to scroll to. */
  const listRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.style.maxHeight = '';
    const max = parseFloat(getComputedStyle(list).maxHeight);
    if (Number.isFinite(max) && max > 0) list.style.maxHeight = `${peekHeight(list, max)}px`;
  }, [listed.length]);
  return (
    <div className="fb-picker">
      <div className="fb-picker-h">
        <span>{label}</span>
      </div>
      <input
        type="search"
        className="fb-find"
        placeholder={`Type to find`}
        aria-label={`Find in ${label}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        data-autofocus
      />
      <ul className="fb-list" ref={listRef} aria-label={label}>
        {listed.map((o, i) => (
          <li key={o}>
            <label htmlFor={`${id}-${i}`} className={counts && (counts.get(o) ?? 0) === 0 && !picked.includes(o) ? 'is-zero' : undefined}>
              <input id={`${id}-${i}`} type="checkbox" checked={showing.includes(o)} onChange={() => choose(o)} />
              <span className="fb-opt">{o}</span>
              {counts && <span className="fb-n">{counts.get(o) ?? 0}</span>}
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="fb-none">Nothing matches “{text}”</li>}
      </ul>
      {collapsible && shown.length > SHORT && text.trim() === '' && (
        <button type="button" className="fb-showall" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all ${shown.length}`}
          <Icon name="down" />
        </button>
      )}
    </div>
  );
}

/** A filter the server cannot fill in yet: shown greyed out, so people know it is coming, with the reason. */
function NotYet({ label }: { label: string }) {
  return (
    <div className="fb-picker is-off" aria-disabled="true">
      <div className="fb-picker-h">
        <span>{label}</span>
      </div>
      <input type="search" className="fb-find" placeholder="Type to find" aria-label={`Find in ${label} (not available yet)`} disabled />
      <p className="fb-note">Not available yet. It switches on once SlideVault has this information for each deck.</p>
    </div>
  );
}

export function FilterBar() {
  const { runtime } = useRuntime();
  const { library, includeArchived, setIncludeArchived } = useLibrary();
  const { filters, patchFilters, clearFilters, query, setQuery, search, autoSection, dismissAutoSection, searched } = useSearch();
  const [open, setOpen] = useState<Key | null>(null);
  /* Phones: the same panels open in a bottom sheet instead of a small popover. */
  const compact = useWorkspaceFiltersRolled();
  const tabletLand = useWorkspaceTabletLandscape();
  const onPhone = useWorkspaceCompact();
  const upright = useWorkspacePhoneUpright();
  const { scroll } = useRoot();
  const [sheet, setSheet] = useState<Key | 'all' | null>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  useDialogOpen(sheetRef, sheet !== null);
  const wrap = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);
  useEdgeFade(rowRef);
  useEdgeFade(chipsRef);
  const [rowOut, setRowOut] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const top = useTopOffset();
  const heroOut = useHeroOut();
  const summary = useResultsSummary();
  const nowYear = new Date().getFullYear();

  const slides = useMemo(() => (library.status === 'ready' ? library.slides : []), [library]);
  /* The lists show every option. The numbers beside them count only slides that also fit the OTHER
     filters that are on, so picking one thing updates the counts for the rest, and options that
     would leave nothing are greyed out. */
  const clients = useMemo(() => [...countBy(slides, clientOf).keys()].sort((a, b) => a.localeCompare(b)), [slides]);
  const categories = useMemo(() => [...countBy(slides, categoryOf).keys()].sort((a, b) => a.localeCompare(b)), [slides]);
  const without = useCallback((omit: Partial<Filters>) => slides.filter((s) => slideMatches(s, { ...filters, ...omit })), [slides, filters]);
  const clientCounts = useMemo(() => countBy(without({ client: [] }), clientOf), [without]);
  const categoryCounts = useMemo(() => countBy(without({ category: [] }), categoryOf), [without]);
  /* Who made and who uploaded a deck: real values only, so these lists exist only once the server sends them. */
  const creators = useMemo(() => [...countBy(slides, createdByOf).keys()].sort((a, b) => a.localeCompare(b)), [slides]);
  const uploaders = useMemo(() => [...countBy(slides, uploadedByOf).keys()].sort((a, b) => a.localeCompare(b)), [slides]);
  const creatorCounts = useMemo(() => countBy(without({ createdBy: [] }), createdByOf), [without]);
  const uploaderCounts = useMemo(() => countBy(without({ uploadedBy: [] }), uploadedByOf), [without]);
  /* People's own tags (FD-58): a slide can carry several, so each one is counted. */
  const tagCount = (list: SlideSummary[]) => {
    const m = new Map<string, number>();
    for (const s of list) for (const t of tagsOf(s)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };
  const tagNames = useMemo(() => [...tagCount(slides).keys()].sort((a, b) => a.localeCompare(b)), [slides]);
  const tagCounts = useMemo(() => tagCount(without({ tag: [] })), [without]);
  const typeCounts = useMemo(() => {
    const base = without({ slideType: [] });
    return new Map(SLIDE_TYPES.map((t) => [t.label, base.filter((s) => hasSlideType(s, t.label)).length]));
  }, [without]);
  const yearCounts = useMemo(() => {
    const base = without({ yfrom: null, yto: null });
    return new Map(YEAR_PRESETS.map(([k]) => [k, base.filter((s) => (yearOf(s) ?? -1) >= new Date().getFullYear() - k + 1).length]));
  }, [without]);

  /* What the search was read as (client, year, kind of slide), straight from the server, so the
     row and the results header always agree. */
  const reading = rowReading(query.trim() && search.status === 'ready' ? search.result : null);
  const pClient = reading.client;
  const pYear = reading.year;
  const pTypes = reading.types;
  const fromClient = pClient && !filters.client.includes(pClient.label) ? pClient : null;
  const fromYear = pYear && filters.yfrom === null && filters.yto === null ? pYear : null;
  const fromTypes = pTypes.filter((t) => !filters.slideType.includes(t.label));
  const removeFromSearch = (chip: SmartSearchChip) => setQuery(withoutChip(query, chip));

  const close = useCallback((returnFocus: boolean) => {
    setOpen((cur) => {
      if (cur && returnFocus) wrap.current?.querySelector<HTMLElement>(`[data-key="${cur}"]`)?.focus();
      return null;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    wrap.current?.querySelector<HTMLElement>('.fb-pop [data-autofocus]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  /* A filter card open under the row (wide and medium widths): the card gets the room left on screen and
     scrolls inside itself, down to its last line, while the page behind stays where it is. */
  useEffect(() => {
    if (!open || compact) return;
    const page = scroll.current;
    const pop = wrap.current?.querySelector<HTMLElement>('.fb-pop');
    if (!pop) return;
    const fit = () => {
      const room = Math.max(220, workspaceBounds(pop).bottom - pop.getBoundingClientRect().top - 16);
      pop.style.maxHeight = '';
      /* Options below the fold: stop halfway through the next one, so it shows there is more to scroll to. */
      pop.style.maxHeight = `${peekHeight(pop, room)}px`;
    };
    fit();
    const stop = (e: Event) => {
      if (!pop.contains(e.target as Node)) e.preventDefault();
    };
    page?.addEventListener('wheel', stop, { passive: false });
    page?.addEventListener('touchmove', stop, { passive: false });
    window.addEventListener('resize', fit);
    return () => {
      page?.removeEventListener('wheel', stop);
      page?.removeEventListener('touchmove', stop);
      window.removeEventListener('resize', fit);
    };
  }, [open, compact, scroll]);

  /* Wide and medium widths: tell when the row has stuck to the top, to give it more room above. */
  useEffect(() => {
    const el = sentinel.current;
    if (compact || !el) return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)), {
      root: scroll.current,
      rootMargin: `${-top}px 0px 0px 0px`,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [compact, scroll, top]);

  /* Phones: once the row has scrolled off the top, a small "Filters" button stays pinned there. */
  useEffect(() => {
    if (!compact) return;
    let observer: IntersectionObserver | null = null;
    /* A phone on its side lays the row out without a box of its own (its buttons share the line with Storyboard), so then the whole bar is watched. */
    const attach = () => {
      observer?.disconnect();
      const row = rowRef.current;
      const el = row && row.getClientRects().length ? row : wrap.current;
      if (!el) return;
      observer = new IntersectionObserver(([entry]) => setRowOut(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)), { root: scroll.current });
      observer.observe(el);
    };
    attach();
    const turned = window.matchMedia('(orientation: landscape)');
    turned.addEventListener('change', attach);
    return () => {
      turned.removeEventListener('change', attach);
      observer?.disconnect();
    };
  }, [compact, scroll]);

  const yearOn = filters.yfrom !== null || filters.yto !== null;
  const moreCount = (filters.bestOnly ? 1 : 0) + filters.createdBy.length + filters.uploadedBy.length + filters.tag.length;
  /* The section is chosen here on every page (there is no separate bar of section pills), so it counts and shows as a chip like any other filter. */
  const secOnResults = false;
  const items: { key: Key; label: string; icon: IconName; active: number }[] = [
    { key: 'year', label: 'Year', icon: 'calendar', active: yearOn || fromYear ? 1 : 0 },
    { key: 'client', label: 'Client', icon: 'building', active: filters.client.length + (fromClient ? 1 : 0) },
    { key: 'category', label: 'Project type', icon: 'folder', active: filters.category.length },
    { key: 'slideType', label: 'Slide type', icon: 'layers', active: filters.slideType.length + fromTypes.length },
    { key: 'section', label: 'Section', icon: 'folder', active: secOnResults ? 0 : filters.section.length + (autoSection ? 1 : 0) },
    { key: 'more', label: 'More', icon: 'sliders', active: moreCount },
  ];

  /* The chips under the row: one per active choice, each removable. */
  const yearText =
    filters.yfrom !== null && filters.yto === null && YEAR_PRESETS.some(([k]) => filters.yfrom === nowYear - k + 1)
      ? (YEAR_PRESETS.find(([k]) => filters.yfrom === nowYear - k + 1) as [number, string])[1]
      : `${filters.yfrom ?? 'Any'} to ${filters.yto ?? 'now'}`;
  const chips: { id: string; kind: string; text: string; remove: () => void; fromSearch?: boolean }[] = [
    ...(yearOn ? [{ id: 'year', kind: 'Year', text: yearText, remove: () => patchFilters({ yfrom: null, yto: null }) }] : []),
    ...filters.client.map((v) => ({ id: `c-${v}`, kind: 'Client', text: v, remove: () => patchFilters({ client: filters.client.filter((x) => x !== v) }) })),
    ...filters.category.map((v) => ({ id: `p-${v}`, kind: 'Project type', text: v, remove: () => patchFilters({ category: filters.category.filter((x) => x !== v) }) })),
    ...filters.slideType.map((v) => ({ id: `t-${v}`, kind: 'Slide type', text: v, remove: () => patchFilters({ slideType: filters.slideType.filter((x) => x !== v) }) })),
    ...filters.createdBy.map((v) => ({ id: `cb-${v}`, kind: 'File created by', text: v, remove: () => patchFilters({ createdBy: filters.createdBy.filter((x) => x !== v) }) })),
    ...filters.uploadedBy.map((v) => ({ id: `ub-${v}`, kind: 'Uploaded by', text: v, remove: () => patchFilters({ uploadedBy: filters.uploadedBy.filter((x) => x !== v) }) })),
    ...(secOnResults ? [] : filters.section).map((v) => ({ id: `sc-${v}`, kind: 'Section', text: SECTION_LABEL[v] ?? v, remove: () => patchFilters({ section: [] }) })),
    ...filters.tag.map((v) => ({ id: `tg-${v}`, kind: 'Tag', text: v, remove: () => patchFilters({ tag: filters.tag.filter((x) => x !== v) }) })),
    ...(filters.bestOnly ? [{ id: 'best', kind: 'Collection', text: 'Best of the Best', remove: () => patchFilters({ bestOnly: false }) }] : []),
    ...(fromYear ? [{ id: 'sy', kind: 'Year', text: fromYear.label, remove: () => removeFromSearch(fromYear), fromSearch: true }] : []),
    ...(fromClient ? [{ id: 'sc', kind: 'Client', text: fromClient.label, remove: () => removeFromSearch(fromClient), fromSearch: true }] : []),
    ...fromTypes.map((t) => ({ id: `st-${t.label}`, kind: 'Slide type', text: t.label, remove: () => removeFromSearch(t.chip), fromSearch: true })),
    ...(autoSection && !secOnResults ? [{ id: 'ss', kind: 'Section', text: SECTION_LABEL[autoSection] ?? autoSection, remove: dismissAutoSection, fromSearch: true }] : []),
  ];

  const panel = (key: Key) => {
    if (key === 'year')
      return (
        <div className="fb-picker">
          <div className="fb-picker-h">
            <span>Year</span>
          </div>
          {fromYear && (
            <p className="fb-note">
              From your search: <strong>{fromYear.label}</strong>{' '}
              <button type="button" className="btn-link" onClick={() => removeFromSearch(fromYear)}>
                Remove
              </button>
            </p>
          )}
          <div className="fb-presets">
            {YEAR_PRESETS.map(([k, label]) => {
              const on = filters.yfrom === nowYear - k + 1 && filters.yto === null;
              return (
                <button key={k} type="button" className={`pchip${(yearCounts.get(k) ?? 0) === 0 && !on ? ' is-zero' : ''}`} aria-pressed={on} onClick={() => patchFilters(on ? { yfrom: null, yto: null } : { yfrom: nowYear - k + 1, yto: null })} data-autofocus={k === 2 ? true : undefined}>
                  {label} <span className="fb-n">({plural(yearCounts.get(k) ?? 0, 'slide')})</span>
                </button>
              );
            })}
          </div>
          <div className="fb-range">
            <label>
              From
              <input
                type="number"
                inputMode="numeric"
                min={1981}
                max={nowYear}
                placeholder="1981"
                value={filters.yfrom ?? ''}
                onChange={(e) => patchFilters({ yfrom: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </label>
            <label>
              To
              <input
                type="number"
                inputMode="numeric"
                min={1981}
                max={nowYear}
                placeholder={String(nowYear)}
                value={filters.yto ?? ''}
                onChange={(e) => patchFilters({ yto: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </label>
          </div>
        </div>
      );
    if (key === 'client')
      return (
        <Picker
          collapsible={compact}
          label="Client"
          options={clients}
          picked={fromClient ? [...filters.client, fromClient.label] : filters.client}
          counts={clientCounts}
          onToggle={(v) => (fromClient && v === fromClient.label ? removeFromSearch(fromClient) : patchFilters({ client: toggle(filters.client, v) }))}
        />
      );
    if (key === 'category')
      return <Picker collapsible={compact} label="Project type" options={categories} picked={filters.category} counts={categoryCounts} onToggle={(v) => patchFilters({ category: toggle(filters.category, v) })} />;
    if (key === 'section') {
      const kindOf = (label: string) => Object.keys(SECTION_LABEL).find((k) => SECTION_LABEL[k] === label) ?? label;
      return (
        <Picker
          collapsible={compact}
          label="Section"
          single
          options={Object.values(SECTION_LABEL)}
          picked={(filters.section.length ? filters.section : autoSection ? [autoSection] : []).map((k) => SECTION_LABEL[k] ?? k)}
          onToggle={(label) => {
            // The section the search asked for is ticked already: ticking it again turns it off for this search.
            if (!filters.section.length && autoSection === kindOf(label)) dismissAutoSection();
            else patchFilters({ section: filters.section.includes(kindOf(label)) ? [] : [kindOf(label)] });
            if (!compact) setTimeout(() => close(true), 160); /* one choice: the tick shows first, then the card closes */
          }}
        />
      );
    }
    if (key === 'slideType')
      return (
        <Picker
          collapsible={compact}
          label="Slide type"
          options={SLIDE_TYPES.map((t) => t.label)}
          picked={[...filters.slideType, ...fromTypes.map((t) => t.label)]}
          counts={typeCounts}
          onToggle={(v) => {
            const fromSearchType = fromTypes.find((t) => t.label === v);
            if (fromSearchType) removeFromSearch(fromSearchType.chip);
            else patchFilters({ slideType: toggle(filters.slideType, v) });
          }}
        />
      );
    return (
      <div className="fb-more">
        {tagNames.length > 0 ? (
          <Picker collapsible={compact} label="Tags" options={tagNames} picked={filters.tag} counts={tagCounts} onToggle={(v) => patchFilters({ tag: toggle(filters.tag, v) })} />
        ) : (
          <NotYet label="Tags" />
        )}
        {creators.length > 0 ? (
          <Picker collapsible={compact} label="File created by" options={creators} picked={filters.createdBy} counts={creatorCounts} onToggle={(v) => patchFilters({ createdBy: toggle(filters.createdBy, v) })} />
        ) : (
          <NotYet label="File created by" />
        )}
        {uploaders.length > 0 ? (
          <Picker collapsible={compact} label="Uploaded by" options={uploaders} picked={filters.uploadedBy} counts={uploaderCounts} onToggle={(v) => patchFilters({ uploadedBy: toggle(filters.uploadedBy, v) })} />
        ) : (
          <NotYet label="Uploaded by" />
        )}
        <label className="fb-check">
          <input type="checkbox" checked={filters.bestOnly} onChange={(e) => patchFilters({ bestOnly: e.target.checked })} />
          <span>Best of the Best only</span>
        </label>
        <label className="fb-check">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          <span>Show archived decks</span>
        </label>
        <Link className="btn-link" to={{ view: 'archive' }} onNavigate={() => setOpen(null)}>
          Open the archived decks page
        </Link>
      </div>
    );
  };

  const n = filterCount(filters) - (secOnResults ? filters.section.length : 0);
  const activeTotal = items.reduce((sum, it) => sum + it.active, 0);
  const openOne = (key: Key) => (compact ? setSheet(key) : setOpen(open === key ? null : key));

  return (
    <>
    <div ref={sentinel} className="fbar-sentinel" aria-hidden="true" />
    <div className={`fbar${stuck && !compact ? ' is-stuck' : ''}${heroOut && !compact ? ' has-search' : ''}`} ref={wrap} style={{ top }} role="region" aria-label="Filters">
      {heroOut && !compact && <StickySearch />}
      {compact && upright && searched === '' && runtime.location.view !== 'browse' && (
        <div className="fb-tools">
          <StoryLauncher part="button" />
        </div>
      )}
      <div className="fbar-row" ref={rowRef} role="toolbar" aria-label="Filter slides">
        <DeeperAiToggle />
        {compact && <HiddenToggle place="row" />}
        <button type="button" className={`fb-btn fb-all${activeTotal ? ' on' : ''}`} aria-haspopup="dialog" onClick={() => setSheet('all')}>
          <Icon name="sliders" />
          <span className="fb-lbl">Filters</span>
          {activeTotal > 0 && <span className="fb-n-on" aria-hidden="true">{activeTotal}</span>}
        </button>
        {/* Phone on its side and tablets: Storyboard is in this same row, after Filters (a phone held upright keeps it on a line above). */}
        {compact && !upright && searched === '' && runtime.location.view !== 'browse' && <StoryLauncher part="button" />}
        {/* Phones and upright tablets: one Filters button; the sheet it opens starts with Year and Client. */}
        {!compact && items.map((it) => (
          <div key={it.key} className="fb-item">
            <button
              type="button"
              className={`fb-btn${it.active ? ' on' : ''}`}
              data-key={it.key}
              aria-haspopup="dialog"
              aria-expanded={compact ? undefined : open === it.key}
              onClick={() => openOne(it.key)}
            >
              <Icon name={it.icon} />
              <span className="fb-lbl">{it.label}</span>
              {it.active > 0 && <span className="fb-n-on" aria-hidden="true">{it.active}</span>}
            </button>
            {!compact && open === it.key && (
              <div className={`fb-pop${it.key === 'more' ? ' fb-pop-wide' : ''}`} role="dialog" aria-label={it.label}>
                {panel(it.key)}
              </div>
            )}
          </div>
        ))}
        {n > 0 && chips.length === 0 && (
          <button type="button" className="btn-link fb-clear-all" onClick={clearFilters}>
            Clear all
          </button>
        )}
      {chips.length > 0 && (
        <ul className="fb-chips" aria-label="Filters on" ref={chipsRef}>
          {/* A thin vertical line (phones and tablets) marks where the filter buttons end and the chosen filters start. */}
          <li className="fb-sep" aria-hidden="true" />
          {chips.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`chip-x${c.fromSearch ? ' from-search' : ''}`}
                aria-label={`Remove ${c.kind}: ${c.text}${c.fromSearch ? ' (read from your search)' : ''}`}
                title={c.fromSearch ? 'Read from your search' : undefined}
                onClick={c.remove}
              >
                {c.fromSearch && <Icon name="sparkle" className="ic-sm" />}
                <span className="k">{c.kind}:</span> {c.text}
                <Icon name="x" />
              </button>
            </li>
          ))}
          {n > 0 && (
            <li className="fb-chips-clear">
              <button type="button" className="btn-link fb-clear-all" onClick={clearFilters}>
                Clear all
              </button>
            </li>
          )}
        </ul>
      )}
      </div>
      {compact && rowOut && sheet === null && (
        <div className="fb-pin-bar">
          {(tabletLand || !summary) && <StickySearch eye={false} placeholder={tabletLand ? undefined : 'Search slides'} />}
          {summary && !tabletLand ? (
            <span className="pin-sum">
              <strong>{summary.count} slides</strong>
              <span aria-hidden="true"> · </span>
              <label className="pin-sort">
                <span className="sr-only">Sort</span>
                <select value={summary.sort} onChange={(e) => summary.setSort(e.target.value as 'best' | 'popular' | 'newest')}>
                  <option value="best">Best match</option>
                  <option value="popular">Most downloaded</option>
                  <option value="newest">Newest first</option>
                </select>
              </label>
            </span>
          ) : (
            <DeeperAiToggle />
          )}
          {/* On a phone the pinned bar has no room for a Filters button: the search needs it. */}
          {!onPhone && (
            <button type="button" className="fb-pin" onClick={() => setSheet('all')}>
              <Icon name="sliders" />
              <span>Filters</span>
              {activeTotal > 0 && <span className="fb-n-on" aria-hidden="true">{activeTotal}</span>}
            </button>
          )}
        </div>
      )}
      <dialog
        ref={sheetRef}
        className="slidevault sv-dialog fb-sheet"
        data-theme={runtime.theme}
        aria-labelledby="sv-sheet-title"
        onClose={() => setSheet(null)}
        onClick={backdropClose(() => setSheet(null))}
      >
        {sheet !== null && (
          <>
            <div className="dlg-head">
              <h2 id="sv-sheet-title">{sheet === 'all' ? 'Filters' : (items.find((it) => it.key === sheet)?.label ?? 'Filters')}</h2>
              <Button variant="ghost" iconOnly size="sm" aria-label="Close filters" onClick={() => setSheet(null)}>
                <Icon name="x" />
              </Button>
            </div>
            <div className="dlg-body fb-sheet-body">
              {sheet === 'all' ? items.map((it) => <section key={it.key}>{panel(it.key)}</section>) : panel(sheet)}
            </div>
            <div className="dlg-foot">
              {n > 0 && (
                <Button  onClick={clearFilters}>
                  Clear all
                </Button>
              )}
              <Button variant="primary" onClick={() => setSheet(null)}>
                Done
              </Button>
            </div>
          </>
        )}
      </dialog>
    </div>
    </>
  );
}

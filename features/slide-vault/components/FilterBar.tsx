'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { categoryOf, clientOf, countBy, filterCount, slideMatches, yearOf, type Filters } from './library';
import { SimFlag } from './parts';
import { backdropClose, useDialogOpen } from './Dialogs';
import type { SmartSearchChip } from '../contracts/dto';
import { rowReading, withoutChip } from './search-reading';
import { SIM_PEOPLE, SLIDE_TYPES, TIER_LABEL, simContributor, simHasSlideType, simUploader, visibleTiers, type Tier } from './simulation';
import { useRoot } from './root';
import { useWorkspaceCompact } from './size';
import { useWorkspace } from './state';

/**
 * The slim filter row under the Home search box: one icon per filter. Hovering shows the name,
 * clicking opens a small panel where you can type to narrow the list or tick values. Year, client,
 * project type and slide type are always on the row; less-used filters sit behind the last icon
 * ("More"). Wide screens: the row sticks under the tabs and stays visible. Phones: one swipeable row
 * that scrolls away with the page, a "Filters" button that opens every filter in a bottom sheet, and
 * a small pinned "Filters" button once the row has scrolled out of view.
 */

type Key = 'year' | 'client' | 'category' | 'slideType' | 'more';

const YEAR_PRESETS: [number, string][] = [
  [2, 'Last 2 years'],
  [5, 'Last 5 years'],
  [10, 'Last 10 years'],
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
  simulated,
}: {
  label: string;
  options: string[];
  picked: string[];
  counts?: Map<string, number>;
  onToggle: (v: string) => void;
  simulated?: boolean;
}) {
  const [text, setText] = useState('');
  const shown = options.filter((o) => o.toLowerCase().includes(text.trim().toLowerCase()));
  const id = useId();
  return (
    <div className="fb-picker">
      <div className="fb-picker-h">
        <span>{label}</span>
        {simulated && <SimFlag />}
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
      <ul className="fb-list" aria-label={label}>
        {shown.map((o, i) => (
          <li key={o}>
            <label htmlFor={`${id}-${i}`} className={counts && (counts.get(o) ?? 0) === 0 && !picked.includes(o) ? 'is-zero' : undefined}>
              <input id={`${id}-${i}`} type="checkbox" checked={picked.includes(o)} onChange={() => onToggle(o)} />
              <span className="fb-opt">{o}</span>
              {counts && <span className="fb-n">{counts.get(o) ?? 0}</span>}
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="fb-none">Nothing matches “{text}”</li>}
      </ul>
    </div>
  );
}

export function FilterBar() {
  const { library, filters, patchFilters, clearFilters, runtime, query, setQuery, search } = useWorkspace();
  const [open, setOpen] = useState<Key | null>(null);
  /* Phones: the same panels open in a bottom sheet instead of a small popover. */
  const compact = useWorkspaceCompact();
  const { scroll } = useRoot();
  const [sheet, setSheet] = useState<Key | 'all' | null>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  useDialogOpen(sheetRef, sheet !== null);
  const wrap = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowOut, setRowOut] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const top = useTopOffset();
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
  const typeCounts = useMemo(() => {
    const base = without({ slideType: [] });
    return new Map(SLIDE_TYPES.map((t) => [t.label, base.filter((s) => simHasSlideType(s, t.label)).length]));
  }, [without]);
  const uploaderCounts = useMemo(() => countBy(without({ uploader: [] }), simUploader), [without]);
  const contributorCounts = useMemo(() => countBy(without({ contributor: [] }), simContributor), [without]);
  const yearCounts = useMemo(() => {
    const base = without({ yfrom: null, yto: null });
    return new Map(YEAR_PRESETS.map(([k]) => [k, base.filter((s) => (yearOf(s) ?? -1) >= new Date().getFullYear() - k + 1).length]));
  }, [without]);
  const tiers = visibleTiers(runtime.capabilities);

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
    const el = rowRef.current;
    if (!compact || !el) return;
    const observer = new IntersectionObserver(([entry]) => setRowOut(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)), { root: scroll.current });
    observer.observe(el);
    return () => observer.disconnect();
  }, [compact, scroll]);

  const yearOn = filters.yfrom !== null || filters.yto !== null;
  const moreCount = filters.uploader.length + filters.contributor.length + filters.status.length + (filters.bestOnly ? 1 : 0);
  const items: { key: Key; label: string; icon: IconName; active: number }[] = [
    { key: 'year', label: 'Year', icon: 'calendarFill', active: yearOn || fromYear ? 1 : 0 },
    { key: 'client', label: 'Client', icon: 'buildingFill', active: filters.client.length + (fromClient ? 1 : 0) },
    { key: 'category', label: 'Project type', icon: 'folderFill', active: filters.category.length },
    { key: 'slideType', label: 'Slide type', icon: 'layersFill', active: filters.slideType.length + fromTypes.length },
    { key: 'more', label: 'More', icon: 'slidersFill', active: moreCount },
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
    ...filters.uploader.map((v) => ({ id: `u-${v}`, kind: 'Uploaded by', text: v, remove: () => patchFilters({ uploader: filters.uploader.filter((x) => x !== v) }) })),
    ...filters.contributor.map((v) => ({ id: `k-${v}`, kind: 'Contributed by', text: v, remove: () => patchFilters({ contributor: filters.contributor.filter((x) => x !== v) }) })),
    ...filters.status.map((v) => ({ id: `s-${v}`, kind: 'Status', text: TIER_LABEL[v], remove: () => patchFilters({ status: filters.status.filter((x) => x !== v) }) })),
    ...(filters.bestOnly ? [{ id: 'best', kind: 'Collection', text: 'Best of the Best', remove: () => patchFilters({ bestOnly: false }) }] : []),
    ...(fromYear ? [{ id: 'sy', kind: 'Year', text: fromYear.label, remove: () => removeFromSearch(fromYear), fromSearch: true }] : []),
    ...(fromClient ? [{ id: 'sc', kind: 'Client', text: fromClient.label, remove: () => removeFromSearch(fromClient), fromSearch: true }] : []),
    ...fromTypes.map((t) => ({ id: `st-${t.label}`, kind: 'Slide type', text: t.label, remove: () => removeFromSearch(t.chip), fromSearch: true })),
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
                  {label} <span className="fb-n">{yearCounts.get(k) ?? 0}</span>
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
          label="Client"
          options={clients}
          picked={fromClient ? [...filters.client, fromClient.label] : filters.client}
          counts={clientCounts}
          onToggle={(v) => (fromClient && v === fromClient.label ? removeFromSearch(fromClient) : patchFilters({ client: toggle(filters.client, v) }))}
        />
      );
    if (key === 'category')
      return <Picker label="Project type" options={categories} picked={filters.category} counts={categoryCounts} onToggle={(v) => patchFilters({ category: toggle(filters.category, v) })} />;
    if (key === 'slideType')
      return (
        <Picker
          label="Slide type"
          options={SLIDE_TYPES.map((t) => t.label)}
          picked={[...filters.slideType, ...fromTypes.map((t) => t.label)]}
          counts={typeCounts}
          simulated
          onToggle={(v) => {
            const fromSearchType = fromTypes.find((t) => t.label === v);
            if (fromSearchType) removeFromSearch(fromSearchType.chip);
            else patchFilters({ slideType: toggle(filters.slideType, v) });
          }}
        />
      );
    return (
      <div className="fb-more">
        <Picker label="Uploaded by" options={SIM_PEOPLE} picked={filters.uploader} counts={uploaderCounts} simulated onToggle={(v) => patchFilters({ uploader: toggle(filters.uploader, v) })} />
        <Picker label="Contributed by" options={SIM_PEOPLE} picked={filters.contributor} counts={contributorCounts} simulated onToggle={(v) => patchFilters({ contributor: toggle(filters.contributor, v) })} />
        {tiers.length > 1 && (
          <div className="fb-picker">
            <div className="fb-picker-h">
              <span>Status</span>
              <SimFlag />
            </div>
            <div className="fb-presets">
              {tiers.map((t) => (
                <button key={t} type="button" className="pchip" aria-pressed={filters.status.includes(t)} onClick={() => patchFilters({ status: toggle(filters.status, t) as Tier[] })}>
                  {TIER_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="fb-check">
          <input type="checkbox" checked={filters.bestOnly} onChange={(e) => patchFilters({ bestOnly: e.target.checked })} />
          <span>Best of the Best only</span>
        </label>
      </div>
    );
  };

  const n = filterCount(filters);
  const activeTotal = items.reduce((sum, it) => sum + it.active, 0);
  const openOne = (key: Key) => (compact ? setSheet(key) : setOpen(open === key ? null : key));

  return (
    <>
    <div ref={sentinel} className="fbar-sentinel" aria-hidden="true" />
    <div className={`fbar${stuck && !compact ? ' is-stuck' : ''}`} ref={wrap} style={{ top }} role="region" aria-label="Filters">
      <div className="fbar-row" ref={rowRef} role="toolbar" aria-label="Filter slides">
        <button type="button" className={`fb-btn fb-all${activeTotal ? ' on' : ''}`} aria-haspopup="dialog" onClick={() => setSheet('all')}>
          <Icon name="slidersFill" />
          <span className="fb-lbl">Filters</span>
          {activeTotal > 0 && <span className="fb-n-on" aria-hidden="true">{activeTotal}</span>}
        </button>
        {items.map((it) => (
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
        {n > 0 && (
          <button type="button" className="btn-link fb-clear" onClick={clearFilters}>
            Clear all
          </button>
        )}
      </div>
      {chips.length > 0 && (
        <ul className="fb-chips" aria-label="Filters on">
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
        </ul>
      )}
      {compact && rowOut && sheet === null && (
        <button type="button" className="fb-pin" onClick={() => setSheet('all')}>
          <Icon name="slidersFill" />
          <span>Filters</span>
          {activeTotal > 0 && <span className="fb-n-on" aria-hidden="true">{activeTotal}</span>}
        </button>
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
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close filters" onClick={() => setSheet(null)}>
                <Icon name="x" />
              </button>
            </div>
            <div className="dlg-body fb-sheet-body">
              {sheet === 'all' ? items.map((it) => <section key={it.key}>{panel(it.key)}</section>) : panel(sheet)}
            </div>
            <div className="dlg-foot">
              {n > 0 && (
                <button type="button" className="btn" onClick={clearFilters}>
                  Clear all
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => setSheet(null)}>
                Done
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
    </>
  );
}

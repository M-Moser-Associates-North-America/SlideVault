'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { categoryOf, clientOf, countBy, filterCount, UNKNOWN_CLIENT } from './library';
import { SimFlag } from './parts';
import { SIM_PEOPLE, SLIDE_TYPES, simContributor, simHasSlideType, simParse, simUploader, slideTypeForChip, stripFromQuery, visibleTiers, type Chip, type Tier } from './simulation';
import { useWorkspace } from './state';

/**
 * The slim filter row under the Home search box: one icon per filter. Hovering shows the name,
 * clicking opens a small panel where you can type to narrow the list or tick values. Year, client,
 * project type and slide type are always on the row; less-used filters sit behind the last icon
 * ("More"). The row hides while scrolling down and comes back on the slightest scroll up.
 */

type Key = 'year' | 'client' | 'category' | 'slideType' | 'more';

const YEAR_PRESETS: [number, string][] = [
  [2, 'Last 2 years'],
  [5, 'Last 5 years'],
  [10, 'Last 10 years'],
];

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Hide on scroll down, show on any scroll up, always show near the top of the page. */
function useHideOnScrollDown(onHide: () => void): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 120) setHidden(false);
      else if (y > last + 4) {
        setHidden(true);
        onHide();
      }
      else if (y < last - 1) setHidden(false);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [onHide]);
  return hidden;
}

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
            <label htmlFor={`${id}-${i}`}>
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
  const { library, filters, patchFilters, clearFilters, runtime, query, setQuery } = useWorkspace();
  const [open, setOpen] = useState<Key | null>(null);
  const closeOnHide = useCallback(() => setOpen(null), []);
  const hidden = useHideOnScrollDown(closeOnHide);
  const top = useTopOffset();
  const wrap = useRef<HTMLDivElement>(null);
  const nowYear = new Date().getFullYear();

  const slides = useMemo(() => (library.status === 'ready' ? library.slides : []), [library]);
  const clientCounts = useMemo(() => countBy(slides, clientOf), [slides]);
  const categoryCounts = useMemo(() => countBy(slides, categoryOf), [slides]);
  const typeCounts = useMemo(() => new Map(SLIDE_TYPES.map((t) => [t.label, slides.filter((s) => simHasSlideType(s, t.label)).length])), [slides]);
  const uploaderCounts = useMemo(() => countBy(slides, simUploader), [slides]);
  const contributorCounts = useMemo(() => countBy(slides, simContributor), [slides]);
  const clients = useMemo(() => [...clientCounts.keys()].sort((a, b) => a.localeCompare(b)), [clientCounts]);
  const categories = useMemo(() => [...categoryCounts.keys()].sort((a, b) => a.localeCompare(b)), [categoryCounts]);
  const tiers = visibleTiers(runtime.capabilities);

  /* What the typed sentence already says (client, year, kind of slide), so the row can show it too. */
  const clientNames = useMemo(() => clients.filter((c) => c !== UNKNOWN_CLIENT), [clients]);
  const parsed = useMemo(() => (query.trim() ? simParse(query, clientNames) : null), [query, clientNames]);
  const pClient = parsed?.chips.find((c) => c.key === 'client') ?? null;
  const pYear = parsed?.chips.find((c) => c.key === 'year') ?? null;
  const pTypes: { chip: Chip; label: string }[] = parsed
    ? parsed.chips.flatMap((chip) => {
        const label = slideTypeForChip(parsed, chip);
        return label ? [{ chip, label }] : [];
      })
    : [];
  const fromClient = pClient && !filters.client.includes(pClient.label) ? pClient : null;
  const fromYear = pYear && filters.yfrom === null && filters.yto === null ? pYear : null;
  const fromTypes = pTypes.filter((t) => !filters.slideType.includes(t.label));
  const removeFromSearch = (chip: Chip) => setQuery(stripFromQuery(query, chip));

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
    ...filters.status.map((v) => ({ id: `s-${v}`, kind: 'Status', text: v, remove: () => patchFilters({ status: filters.status.filter((x) => x !== v) }) })),
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
                <button key={k} type="button" className="pchip" aria-pressed={on} onClick={() => patchFilters(on ? { yfrom: null, yto: null } : { yfrom: nowYear - k + 1, yto: null })} data-autofocus={k === 2 ? true : undefined}>
                  {label}
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
                  {t}
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

  return (
    <div className={`fbar${hidden ? ' is-hidden' : ''}`} ref={wrap} style={{ top }} role="region" aria-label="Filters">
      <div className="fbar-row" role="toolbar" aria-label="Filter slides">
        {items.map((it) => (
          <div key={it.key} className="fb-item">
            <button
              type="button"
              className={`fb-btn${it.active ? ' on' : ''}`}
              data-key={it.key}
                            aria-haspopup="dialog"
              aria-expanded={open === it.key}
              onClick={() => setOpen(open === it.key ? null : it.key)}
            >
              <Icon name={it.icon} />
              <span className="fb-lbl">{it.label}</span>
              {it.active > 0 && <span className="fb-n-on" aria-hidden="true">{it.active}</span>}
            </button>
            {open === it.key && (
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
    </div>
  );
}

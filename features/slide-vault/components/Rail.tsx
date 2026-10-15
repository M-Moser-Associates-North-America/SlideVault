'use client';

import { useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from './icons';
import { categoryOf, clientOf, countBy, filterCount, yearsOf, type Deck } from './library';
import { visibleTiers, type Tier } from './simulation';
import { SimFlag } from './parts';
import { useWorkspace } from './state';

/**
 * Example searches shown under the box. The sentence-style ones are read by the simulated smart
 * search (FD-14); the single words also work with the real keyword search.
 */
const TRY_QUERIES = ['team intro for a law firm pitch', 'cost and fees', 'about us and values', 'recent logistics work', 'process and timeline 2025'];

/** Wide screens always show the filters; narrow ones fold them away behind the heading. */
const WIDE = '(min-width: 961px)';
const subscribeWide = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
const useIsWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '');

/** The search box. On Home it sits at the top of the left column; on deck and slide pages it sits above the content. */
export function SearchForm({ onSubmit }: { onSubmit: () => void }) {
  const { query, setQuery } = useWorkspace();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form className="top-search" role="search" onSubmit={submit}>
      <div className="sbox">
        <label htmlFor="sv-q" className="sr-only">
          Search slides
        </label>
        <Icon name="search" />
        <input
          id="sv-q"
          className="input"
          type="search"
          placeholder="Search slides"
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim()) onSubmit();
          }}
        />
        <button type="button" className="sclear" aria-label="Clear search" hidden={!query} onClick={() => setQuery('')}>
          <Icon name="x" />
        </button>
      </div>
      <button
        type="button"
        className="btn btn-icon mic"
        aria-disabled="true"
        aria-label="Voice search, planned for later"
        data-tip="Voice search: later, if time allows"
        data-tip-pos="start"
      >
        <Icon name="mic" />
      </button>
    </form>
  );
}

export function TryAsking() {
  const { query, setQuery } = useWorkspace();
  return (
    <section className="rail-try" aria-labelledby="try-h">
      <h2 id="try-h" className="try-h">
        <Icon name="search" className="ic-sm" />
        Try searching
      </h2>
      <ul className="try-list">
        {TRY_QUERIES.map((q) => (
          <li key={q}>
            <button type="button" className="try-chip" aria-current={query.trim() === q ? 'true' : undefined} onClick={() => setQuery(q)}>
              {q}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chips({ label, values, picked, onToggle, count }: { label: string; values: string[]; picked: string[]; onToggle: (v: string) => void; count?: Map<string, number> }) {
  return (
    <fieldset className="fg">
      <legend>
        {label}
        {picked.length > 0 && <span className="n">{picked.length}</span>}
      </legend>
      <div className="fchips">
        {values.map((v) => (
          <label key={v} className="fchip">
            <input type="checkbox" checked={picked.includes(v)} onChange={() => onToggle(v)} />
            <span>
              {v}
              {count ? <span className="sr-only"> ({count.get(v) ?? 0} slides)</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ClientCombo({ options, picked, onPick, onRemove }: { options: [string, number][]; picked: string[]; onPick: (v: string) => void; onRemove: (v: string) => void }) {
  const { announce } = useWorkspace();
  const id = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => options.filter(([v]) => !picked.includes(v) && norm(v).includes(norm(text.trim()))), [options, picked, text]);

  const pick = (v: string) => {
    onPick(v);
    setText('');
    setOpen(false);
    setActive(-1);
    inputRef.current?.focus();
    announce(`Client filter added: ${v}`);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (shown.length) setActive((a) => (a + 1) % shown.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) setActive((a) => (a - 1 + shown.length) % shown.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown.length) pick(shown[active >= 0 ? active : 0][0]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="fg">
      <label className="fg-l" htmlFor={`${id}-q`}>
        Client{picked.length > 0 && <span className="n">{picked.length}</span>}
      </label>
      <div className="combo">
        <input
          ref={inputRef}
          id={`${id}-q`}
          className="input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-o${active}` : undefined}
          placeholder="Search clients"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
        />
        <ul id={`${id}-list`} className="combo-list" role="listbox" aria-label="Clients" hidden={!open}>
          {shown.length ? (
            shown.map(([v, n], i) => (
              <li
                key={v}
                id={`${id}-o${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'act' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(v);
                }}
              >
                <span>{v}</span>
                <span className="meta">{n}</span>
              </li>
            ))
          ) : (
            <li className="none" role="presentation">
              No client matches
            </li>
          )}
        </ul>
      </div>
      {picked.length > 0 && (
        <div className="fchips picked">
          {picked.map((v) => (
            <button key={v} type="button" className="pickchip" aria-label={`Remove client filter: ${v}`} onClick={() => onRemove(v)}>
              {v}
              <Icon name="x" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PRESETS: [number, string][] = [
  [2, 'Last 2 years'],
  [5, 'Last 5 years'],
  [10, 'Last 10 years'],
];

export function FilterPanel({ decks, slidesAll }: { decks: Deck[]; slidesAll: import('../contracts/dto').SlideSummary[] }) {
  const { runtime, filters, patchFilters, clearFilters } = useWorkspace();
  const tiers = visibleTiers(runtime.capabilities);
  const nowYear = new Date().getFullYear();
  const n = filterCount(filters);
  const wide = useIsWide();
  const [foldOpen, setFoldOpen] = useState(false);
  const [yearCustom, setYearCustom] = useState(false);

  const categories = useMemo(() => [...new Set(decks.map((d) => d.category).filter((c): c is string => !!c))].sort(), [decks]);
  const categoryCounts = useMemo(() => countBy(slidesAll, categoryOf), [slidesAll]);
  const clientCounts = useMemo(() => countBy(slidesAll, clientOf), [slidesAll]);
  const clients = useMemo(() => [...clientCounts.entries()].sort(([a], [b]) => a.localeCompare(b)), [clientCounts]);
  const years = useMemo(() => yearsOf(decks), [decks]);
  const hasBest = decks.some((d) => d.bestOfTheBest);

  const isPreset = filters.yto === null && PRESETS.some(([k]) => filters.yfrom === nowYear - k + 1);
  const showYear = yearCustom || filters.yto !== null || (filters.yfrom !== null && !isPreset);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <details className="filters" open={wide || foldOpen} onToggle={(e) => !wide && setFoldOpen(e.currentTarget.open)}>
      <summary onClick={(e) => wide && e.preventDefault()}>
        <h2 className="f-title">Filters{n ? ` · ${n}` : ''}</h2>
        {n > 0 && (
          <button
            type="button"
            className="btn-link f-clear"
            onClick={(e) => {
              e.preventDefault();
              clearFilters();
            }}
          >
            Clear all
          </button>
        )}
      </summary>
      <div className="f-body">
        {hasBest && (
          <fieldset className="fg">
            <legend>Collection</legend>
            <div className="fchips">
              <label className="fchip">
                <input type="checkbox" checked={filters.bestOnly} onChange={(e) => patchFilters({ bestOnly: e.target.checked })} />
                <span>Best of the Best</span>
              </label>
            </div>
          </fieldset>
        )}
        {tiers.length > 1 && (
          <fieldset className="fg sim-group">
            <legend>
              Status
              {filters.status.length > 0 && <span className="n">{filters.status.length}</span>}
              <SimFlag />
            </legend>
            <div className="fchips">
              {tiers.map((t) => (
                <label key={t} className="fchip">
                  <input
                    type="checkbox"
                    checked={filters.status.includes(t)}
                    onChange={() =>
                      patchFilters({
                        status: toggle(filters.status, t) as Tier[],
                      })
                    }
                  />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {categories.length > 0 && (
          <Chips label="Category" values={categories} picked={filters.category} count={categoryCounts} onToggle={(v) => patchFilters({ category: toggle(filters.category, v) })} />
        )}
        {years.length > 0 && (
          <fieldset className="fg">
            <legend>
              Year
              {(filters.yfrom !== null || filters.yto !== null) && <span className="n">on</span>}
            </legend>
            <div className="fchips">
              {PRESETS.map(([k, label]) => {
                const on = filters.yfrom === nowYear - k + 1 && filters.yto === null;
                return (
                  <button
                    key={k}
                    type="button"
                    className="pchip"
                    aria-pressed={on}
                    onClick={() => patchFilters(on ? { yfrom: null, yto: null } : { yfrom: nowYear - k + 1, yto: null })}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <button type="button" className="btn-link y-link" aria-expanded={showYear} onClick={() => setYearCustom(!showYear)}>
              {showYear ? 'Hide custom range' : 'Custom range'}
            </button>
            {showYear && (
              <div className="yr">
                <label className="sr-only" htmlFor="sv-y-from">
                  From year
                </label>
                <select
                  id="sv-y-from"
                  className="select select-sm"
                  value={filters.yfrom ?? ''}
                  onChange={(e) =>
                    patchFilters({
                      yfrom: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">From</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <span className="meta" aria-hidden="true">
                  to
                </span>
                <label className="sr-only" htmlFor="sv-y-to">
                  To year
                </label>
                <select
                  id="sv-y-to"
                  className="select select-sm"
                  value={filters.yto ?? ''}
                  onChange={(e) =>
                    patchFilters({
                      yto: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">To</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>
        )}
        {clients.length > 0 && (
          <ClientCombo
            options={clients}
            picked={filters.client}
            onPick={(v) => patchFilters({ client: [...filters.client, v] })}
            onRemove={(v) => patchFilters({ client: filters.client.filter((x) => x !== v) })}
          />
        )}
        {categories.length === 0 && years.length === 0 && clients.length === 0 && !hasBest && (
          <p className="f-note">Filters appear once decks have a client, year or category from their folder.</p>
        )}
      </div>
    </details>
  );
}

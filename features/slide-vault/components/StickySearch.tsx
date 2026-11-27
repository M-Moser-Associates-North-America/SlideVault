'use client';

import type { FormEvent } from 'react';
import { HiddenToggle } from './HiddenToggle';
import { Icon } from './icons';
import { useSearch } from './state';

/**
 * The slim search that stays above the sticky filter row once Home's big search bar has scrolled
 * out of sight. Same query as the big bar; Enter lets the AI read it, as there.
 * `place`: 'bar' above the pinned filter row (desktop), 'pin' in the pinned bar on phones and tablets
 * (styles/sticky-search.css sizes it for each).
 */
export function StickySearch({ place, eye = true, placeholder = 'Search slides, clients or topics' }: { place: 'bar' | 'pin'; eye?: boolean; placeholder?: string }) {
  const { query, setQuery, typeQuery, submitSearch } = useSearch();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) submitSearch();
  };
  return (
    <div className={`fb-search-wrap in-${place}`}>
      <form className="fb-search" role="search" onSubmit={submit}>
        <label htmlFor="sv-fb-q" className="sr-only">
          Search slides
        </label>
        <Icon name="search" />
        <input id="sv-fb-q" type="search" autoComplete="off" enterKeyHint="search" placeholder={placeholder} value={query} onChange={(e) => typeQuery(e.target.value)} />
        <button type="button" className="fb-clear" aria-label="Clear search" hidden={!query} onClick={() => { setQuery(''); document.getElementById('sv-fb-q')?.focus(); }}>
          <Icon name="x" />
        </button>
      </form>
      {eye && <HiddenToggle place="search" />}
    </div>
  );
}

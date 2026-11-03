'use client';

import type { FormEvent } from 'react';
import { HiddenToggle } from './HiddenToggle';
import { Icon } from './icons';
import { useWorkspace } from './state';

/**
 * The slim search that stays above the sticky filter row once Home's big search bar has scrolled
 * out of sight. Same query as the big bar; Enter lets the AI read it, as there.
 */
export function StickySearch() {
  const { query, setQuery, submitSearch } = useWorkspace();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) submitSearch();
  };
  return (
    <div className="fb-search-wrap">
      <form className="fb-search" role="search" onSubmit={submit}>
        <label htmlFor="sv-fb-q" className="sr-only">
          Search slides
        </label>
        <Icon name="search" />
        <input id="sv-fb-q" type="search" autoComplete="off" enterKeyHint="search" placeholder="Search slides, clients or topics" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="fb-clear" aria-label="Clear search" hidden={!query} onClick={() => { setQuery(''); document.getElementById('sv-fb-q')?.focus(); }}>
          <Icon name="x" />
        </button>
      </form>
      <HiddenToggle />
    </div>
  );
}

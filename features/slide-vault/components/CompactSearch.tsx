'use client';

import { useHeroOut } from '../client/hero-visibility';
import { Icon } from './icons';
import { useWorkspace } from './state';

/**
 * A slim search shortcut in the header, shown only while the big search bar on Home is scrolled
 * out of sight. Clicking it takes you back up to the big bar, ready to type.
 */
export function CompactSearch() {
  const out = useHeroOut();
  const { query } = useWorkspace();
  if (!out) return null;
  const goUp = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      const el = document.getElementById('sv-hero-q') as HTMLInputElement | null;
      el?.focus({ preventScroll: true });
    }, 350);
  };
  return (
    <button type="button" className="compact-search" onClick={goUp} aria-label="Search slides">
      <Icon name="search" />
      <span className={query ? 'cs-q' : 'cs-ph'}>{query || 'Search slides, clients or topics'}</span>
    </button>
  );
}

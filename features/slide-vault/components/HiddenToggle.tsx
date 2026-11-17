'use client';

import { useId } from 'react';
import { Icon } from './icons';
import { useLibrary } from './state';

/**
 * An eye button beside the search bar. Off (the default): slides that were hidden in their original
 * deck stay out of search and the library (FD-27). On: they appear, each marked "Hidden in source".
 * The tooltip is our own (the browser's is slow and easy to miss): a heading, then one plain line.
 * `place` picks its size for where it sits (styles/search-toggles.css): the big Home search ('hero'),
 * the slim search ('search') or the phone and tablet filter row ('row').
 */
export function HiddenToggle({ place }: { place: 'hero' | 'search' | 'row' }) {
  const { includeHidden, setIncludeHidden } = useLibrary();
  const tipId = useId();
  return (
    <span className={`hid-wrap in-${place}`}>
      <button type="button" role="switch" aria-checked={includeHidden} aria-label="Show hidden slides" aria-describedby={tipId} className={`hid-toggle${includeHidden ? ' on' : ''}`} onClick={() => setIncludeHidden(!includeHidden)}>
        <Icon name={includeHidden ? 'eye' : 'eyeOff'} />
      </button>
      <span className="hid-tip" role="tooltip" id={tipId}>
        <strong>{includeHidden ? 'Hidden slides: shown' : 'Hidden slides: left out'}</strong>
        <span>{includeHidden ? 'Slides hidden in their original deck are included and marked “Hidden in source”. Click to leave them out.' : 'Click to also show slides that were hidden in their original deck.'}</span>
      </span>
    </span>
  );
}

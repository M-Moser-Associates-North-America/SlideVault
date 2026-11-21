'use client';

import { useEffect, useState, type Ref } from 'react';
import { Icon } from './icons';
import { Button } from './ui/Button';

/** `remove` answers false when nothing could be taken off (a reading that no typed word can be tied to). */
export type FilterChip = { id: string; kind: string; text: string; remove: () => boolean | void; fromSearch?: boolean };

/**
 * The chosen filters as one row of chips, with "Clear all" at the end. Crossing a chip out answers at once: it dims and
 * shows a spinner where its x was, until the new results are in and the chip is gone (or a few seconds pass).
 */
export function FilterChips({ chips, showClearAll, onClearAll, onCannotRemove, listRef }: { chips: FilterChip[]; showClearAll: boolean; onClearAll: () => void; onCannotRemove: () => void; listRef?: Ref<HTMLUListElement> }) {
  const [leaving, setLeaving] = useState<string | null>(null);
  const chipIds = chips.map((c) => c.id).join('|');
  useEffect(() => {
    if (!leaving) return;
    const gone = !chipIds.split('|').includes(leaving);
    const t = setTimeout(() => setLeaving(null), gone ? 0 : 8000);
    return () => clearTimeout(t);
  }, [leaving, chipIds]);
  return (
    <ul className="fb-chips" aria-label="Filters on" ref={listRef}>
      {/* A thin vertical line (phones and tablets) marks where the filter buttons end and the chosen filters start. */}
      <li className="fb-sep" aria-hidden="true" />
      {chips.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className={`chip-x${c.fromSearch ? ' from-search' : ''}${leaving === c.id ? ' is-leaving' : ''}`}
            aria-label={`Remove ${c.kind}: ${c.text}${c.fromSearch ? ' (read from your search)' : ''}`}
            aria-busy={leaving === c.id}
            title={c.fromSearch ? 'Read from your search' : undefined}
            onClick={() => {
              if (c.remove() === false) onCannotRemove();
              else setLeaving(c.id);
            }}
          >
            {c.fromSearch && <Icon name="sparkle" className="ic-sm" />}
            <span className="k">{c.kind}:</span> {c.text}
            {leaving === c.id ? <Icon name="spinner" className="ic-sm spin" /> : <Icon name="x" />}
          </button>
        </li>
      ))}
      {showClearAll && (
        <li className="fb-chips-clear">
          <Button variant="link" className="fb-clear-all" onClick={onClearAll}>
            Clear all
          </Button>
        </li>
      )}
    </ul>
  );
}

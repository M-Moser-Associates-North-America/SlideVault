'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { backdropClose, useDialogOpen } from './Dialogs';
import { Icon } from './icons';
import { useLibrary, useRuntime } from './state';
import { Button } from './ui/Button';

/** True on a touch screen (a finger, no hover): there a tooltip cannot be seen, so the eye explains itself in a small card instead. */
function useTouchOnly(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const q = window.matchMedia('(pointer: coarse)');
      q.addEventListener('change', notify);
      return () => q.removeEventListener('change', notify);
    },
    () => window.matchMedia('(pointer: coarse)').matches,
    () => false,
  );
}

/**
 * An eye button beside the search bar. Off (the default): slides that were hidden in their original
 * deck stay out of search and the library (FD-27). On: they appear, each marked "Hidden in source".
 * With a mouse the tooltip is our own (the browser's is slow and easy to miss): a heading, then one plain line, and a click switches.
 * On a phone and a tablet (the filter row, or any touch screen) there is no hover, so a tap opens a small card that says what it does,
 * with two buttons, Hide and Show; closing it by any other way changes nothing.
 * `place` picks its size for where it sits (styles/search-toggles.css): the big Home search ('hero'),
 * the slim search ('search') or the phone and tablet filter row ('row').
 */
export function HiddenToggle({ place }: { place: 'hero' | 'search' | 'row' }) {
  const { includeHidden, setIncludeHidden } = useLibrary();
  const { runtime } = useRuntime();
  const touch = useTouchOnly();
  const card = place === 'row' || touch;
  const tipId = useId();
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useDialogOpen(ref, open);
  const choose = (show: boolean) => {
    setIncludeHidden(show);
    setOpen(false);
  };
  return (
    <span className={`hid-wrap in-${place}`}>
      {card ? (
        <button type="button" aria-haspopup="dialog" aria-label={`Hidden slides: ${includeHidden ? 'shown' : 'left out'}. Tap to change.`} className={`hid-toggle${includeHidden ? ' on' : ''}`} onClick={() => setOpen(true)}>
          <Icon name={includeHidden ? 'eye' : 'eyeOff'} />
        </button>
      ) : (
        <>
          <button type="button" role="switch" aria-checked={includeHidden} aria-label="Show hidden slides" aria-describedby={tipId} className={`hid-toggle${includeHidden ? ' on' : ''}`} onClick={() => setIncludeHidden(!includeHidden)}>
            <Icon name={includeHidden ? 'eye' : 'eyeOff'} />
          </button>
          <span className="hid-tip" role="tooltip" id={tipId}>
            <strong>{includeHidden ? 'Hidden slides: shown' : 'Hidden slides: left out'}</strong>
            <span>{includeHidden ? 'Slides hidden in their original deck are included and marked “Hidden in source”. Click to leave them out.' : 'Click to also show slides that were hidden in their original deck.'}</span>
          </span>
        </>
      )}
      {card && (
        <dialog ref={ref} className="slidevault sv-dialog hid-dialog" data-theme={runtime.theme} aria-labelledby={titleId} onClose={() => setOpen(false)} onClick={backdropClose(() => setOpen(false))}>
          {open && (
            <>
              <div className="dlg-head">
                <h2 id={titleId}>Hidden slides</h2>
                <Button variant="ghost" iconOnly size="sm" className="dlg-close" aria-label="Close" onClick={() => setOpen(false)}>
                  <Icon name="x" />
                </Button>
              </div>
              <div className="dlg-body">
                <p className="hid-lead">Some slides were hidden by the team in their original deck. They are left out of search and lists unless you choose to show them; shown ones are marked “Hidden in source”.</p>
                <p className="hid-now">
                  Right now they are <strong>{includeHidden ? 'shown' : 'left out'}</strong>.
                </p>
              </div>
              <div className="dlg-foot">
                <Button aria-pressed={!includeHidden} onClick={() => choose(false)}>
                  <Icon name="eyeOff" />
                  <span>Hide them</span>
                </Button>
                <Button aria-pressed={includeHidden} onClick={() => choose(true)}>
                  <Icon name="eye" />
                  <span>Show them</span>
                </Button>
              </div>
            </>
          )}
        </dialog>
      )}
    </span>
  );
}

'use client';

import { useRef, useState } from 'react';
import { backdropClose, useDialogOpen } from './Dialogs';
import { Icon } from './icons';
import { plural } from './library';
import { useWorkspace } from './state';

/**
 * Archive or restore a deck (FD-50). Archiving hides the deck from the library, search and AI for everyone;
 * nothing is deleted and it can be restored. For the MVP anyone signed in can do it (a tier decision for later).
 */
export function ArchiveDialog() {
  const { runtime, archiveDialog, closeArchiveDialog, archiveDeck } = useWorkspace();
  const ref = useRef<HTMLDialogElement>(null);
  useDialogOpen(ref, !!archiveDialog);
  const [busy, setBusy] = useState(false);
  const d = archiveDialog;

  const go = async () => {
    if (!d) return;
    setBusy(true);
    const done = await archiveDeck(d.deck, !d.restore);
    setBusy(false);
    closeArchiveDialog();
    /* The deck page of a deck that has just left the library has nothing left to show. */
    if (done && !d.restore && ((runtime.location.view === 'deck' && runtime.location.id === d.deck.id) || (runtime.location.view === 'slide' && d.fromSlide))) runtime.navigate({ view: 'pages' });
  };

  return (
    <dialog ref={ref} className="slidevault sv-dialog" data-theme={runtime.theme} aria-labelledby="sv-arch-title" onClose={closeArchiveDialog} onClick={backdropClose(closeArchiveDialog)}>
      <div className="dlg-head">
        <h2 id="sv-arch-title">{d?.restore ? 'Restore this deck?' : 'Archive this deck?'}</h2>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={closeArchiveDialog}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dlg-body arch-body">
        {d && (
          <>
            <div className="arch-deck">
              <span className="arch-label">Deck</span>
              <span className="arch-name">{d.deck.title}</span>
              <span className="meta">{plural(d.deck.slideCount, 'slide')}</span>
            </div>
            {d.restore ? (
              <>
                <p className="arch-lead">It will show up again for everyone.</p>
                <ul className="arch-list">
                  <li>Back in the library, search and AI results.</li>
                </ul>
              </>
            ) : (
              <>
                <p className="arch-lead">{d.fromSlide ? `This hides all ${d.deck.slideCount} slides, not just “${d.fromSlide}”.` : `This hides all ${d.deck.slideCount} slides.`}</p>
                <ul className="arch-list">
                  <li>Hidden from the library, search and AI, for everyone.</li>
                  <li>Nothing is deleted. Restore it any time with “Show archived decks” in the filters.</li>
                </ul>
                <p className="arch-note">Slides already in a draft deck stay there.</p>
              </>
            )}
          </>
        )}
      </div>
      <div className="dlg-foot">
        <button type="button" className="btn btn-ghost" onClick={closeArchiveDialog}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} autoFocus onClick={go}>
          {d?.restore ? 'Restore deck' : 'Archive deck'}
        </button>
      </div>
    </dialog>
  );
}

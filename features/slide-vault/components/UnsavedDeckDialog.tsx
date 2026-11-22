'use client';

import { useRef } from 'react';
import { requestDraftSave } from '../client/draft-save-request';
import { takeLeaveAction, useUnsavedDeckQuestion } from '../client/unsaved-deck-store';
import { backdropClose, useDialogOpen } from './Dialogs';
import { Icon } from './icons';
import { plural } from './library';
import { useRuntime } from './state';
import { Button } from './ui/Button';

/**
 * Asked when someone signs out while the draft deck holds slides that are not saved. Closing the box (outside click, Escape, the cross) stays signed in and changes nothing.
 * "Save first" opens the draft deck and its Save as draft box, and signs out only once the draft is saved.
 */
export function UnsavedDeckDialog() {
  const { runtime } = useRuntime();
  const { unsaved, asking } = useUnsavedDeckQuestion();
  const ref = useRef<HTMLDialogElement>(null);
  useDialogOpen(ref, asking);
  const stay = () => takeLeaveAction();
  return (
    <dialog ref={ref} className="slidevault sv-dialog" data-theme={runtime.theme} aria-labelledby="sv-unsaved-title" onClose={stay} onClick={backdropClose(stay)}>
      <div className="dlg-head">
        <h2 id="sv-unsaved-title">Sign out with an unsaved draft deck?</h2>
        <Button variant="ghost" iconOnly size="sm" aria-label="Close" onClick={stay}>
          <Icon name="x" />
        </Button>
      </div>
      <div className="dlg-body">
        <p className="open-draft-lead">
          Your draft deck has {plural(unsaved, 'slide')} that {unsaved === 1 ? 'is' : 'are'} not saved. Signing out clears {unsaved === 1 ? 'it' : 'them'}.
        </p>
      </div>
      <div className="dlg-foot">
        <Button variant="ghost" onClick={() => takeLeaveAction()?.()}>
          Sign out anyway
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            const leave = takeLeaveAction();
            if (leave) requestDraftSave(() => leave());
          }}
        >
          Save first
        </Button>
      </div>
    </dialog>
  );
}

'use client';

import { useEffect, useRef } from 'react';
import { backdropClose, useDialogOpen } from './Dialogs';
import { SECTION_LABEL } from './library';
import { useRuntime } from './state';
import { Button } from './ui/Button';

/**
 * Asked when the person picks a section by hand that is not the one their words ask for ("bank case studies section",
 * then Team). Proceed keeps the filter and narrows the words' results to it; Recheck changes nothing and puts the
 * cursor back in the search box so the words can be redone. The words themselves are never changed here.
 * Short and centred, the two choices at opposite edges (styles/section-conflict.css); Escape or a press outside means Recheck.
 * Closing it after Proceed (the card shuts because `picked` went away) must not count as Recheck, so the close event only
 * counts while a question is still showing.
 */
export function SectionConflictDialog({ picked, inWords, onProceed, onRecheck }: { picked: string[] | null; inWords: string[]; onProceed: () => void; onRecheck: () => void }) {
  const { runtime } = useRuntime();
  const ref = useRef<HTMLDialogElement>(null);
  const proceedRef = useRef<HTMLButtonElement>(null);
  useDialogOpen(ref, picked !== null);
  useEffect(() => {
    if (picked !== null) proceedRef.current?.focus();
  }, [picked]);
  const name = (k: string) => SECTION_LABEL[k] ?? k;
  return (
    <dialog ref={ref} className="slidevault sv-dialog conflict-dialog" data-theme={runtime.theme} aria-labelledby="sv-conflict-title" onClose={() => picked !== null && onRecheck()} onClick={backdropClose(onRecheck)}>
      <div className="dlg-head">
        <h2 id="sv-conflict-title">Your words and the filter don’t match</h2>
      </div>
      <div className="dlg-body">
        {picked !== null && (
          <>
            <p>
              Your search says <em>{inWords.map(name).join(' or ')}</em>, but you picked <em>{picked.map(name).join(' or ')}</em>.
            </p>
            <p>
              Proceed to see only <strong>{picked.map(name).join(' or ')} slides</strong>.
            </p>
          </>
        )}
      </div>
      <div className="dlg-foot">
        <Button onClick={onRecheck}>
          Recheck my search
        </Button>
        <Button ref={proceedRef} variant="primary" onClick={onProceed}>
          Proceed
        </Button>
      </div>
    </dialog>
  );
}

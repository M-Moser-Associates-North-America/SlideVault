'use client';

import { useEffect, useRef } from 'react';
import { answerLeaveUpload, useLeaveUploadQuestion } from '../client/upload-draft-store';
import { backdropClose, useDialogOpen } from './Dialogs';
import { Icon } from './icons';
import { useWorkspace } from './state';

/** Asked when someone signs out while the Upload screen holds unsent work. Stay is the default. */
export function LeaveUploadDialog() {
  const { runtime } = useWorkspace();
  const { draft, asking } = useLeaveUploadQuestion();
  const ref = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  useDialogOpen(ref, asking && !!draft);
  /* The safe choice is the one under the cursor: Enter keeps the work. */
  useEffect(() => {
    if (asking && draft) stayRef.current?.focus();
  }, [asking, draft]);
  const stay = () => answerLeaveUpload(false);
  return (
    <dialog ref={ref} className="slidevault sv-dialog" data-theme={runtime.theme} aria-labelledby="sv-leave-title" onClose={stay} onClick={backdropClose(stay)}>
      <div className="dlg-head">
        <h2 id="sv-leave-title">Leave your upload behind?</h2>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={stay}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dlg-body arch-body">
        {draft && (
          <>
            <div className="arch-deck">
              <span className="arch-label">Unfinished upload</span>
              <span className="arch-name">{draft.label}</span>
            </div>
            <p className="arch-lead">{draft.uploading ? 'This deck is still uploading. Signing out now stops it.' : 'Signing out clears what you entered, including any tags. Nothing is saved, and you would have to start again.'}</p>
          </>
        )}
      </div>
      <div className="dlg-foot">
        <button type="button" className="btn btn-ghost" onClick={() => answerLeaveUpload(true)}>
          Sign out anyway
        </button>
        <button ref={stayRef} type="button" className="btn btn-primary" onClick={stay}>
          Stay on this page
        </button>
      </div>
    </dialog>
  );
}

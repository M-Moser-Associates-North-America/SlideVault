'use client';

import { useRef } from 'react';
import { backdropClose, useDialogOpen } from './Dialogs';
import { Icon } from './icons';
import { plural } from './library';
import { useWorkspace } from './state';

export type UploadSummary = {
  title: string;
  details: string;
  slideCount: number | null;
  hiddenCount: number;
  bestOfTheBest: boolean;
  /** No category chosen: said in words before uploading */
  incomplete?: boolean;
  deckTags: string[];
  slideTags: number;
  taggedSlides: number;
  /** Tags that were filled in for the person (by the AI or from similar slides) and are still there: said before uploading */
  filledIn?: number;
  filledInBy?: 'ai' | 'similar' | null;
};

/** "Upload this deck?" with what will happen, in order of importance, before anything is sent. */
export function UploadConfirmDialog({ open, summary, onCancel, onConfirm }: { open: boolean; summary: UploadSummary | null; onCancel: () => void; onConfirm: () => void }) {
  const { runtime } = useWorkspace();
  const ref = useRef<HTMLDialogElement>(null);
  useDialogOpen(ref, open);
  const s = summary;
  return (
    <dialog ref={ref} className="slidevault sv-dialog" data-theme={runtime.theme} aria-labelledby="sv-upc-title" onClose={onCancel} onClick={backdropClose(onCancel)}>
      <div className="dlg-head">
        <h2 id="sv-upc-title">Upload this deck?</h2>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={onCancel}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dlg-body arch-body">
        {s && (
          <>
            <div className="arch-deck">
              <span className="arch-label">Deck</span>
              <span className="arch-name">{s.title}</span>
              {s.details && <span className="meta">{s.details}</span>}
            </div>
            {s.incomplete && <p className="arch-note">No category chosen. The deck is still uploaded; it just won’t appear under a category filter.</p>}
            <ul className="arch-list">
              <li>
                {s.slideCount === null ? 'Slides are split after the upload.' : plural(s.slideCount, 'slide')}
                {s.hiddenCount > 0 ? ` (${s.hiddenCount} hidden in the file, kept out of search)` : ''}
              </li>
              <li>{s.deckTags.length ? `Deck tags: ${s.deckTags.join(', ')}` : 'No deck tags'}</li>
              <li>{s.slideTags ? `${plural(s.slideTags, 'tag')} on ${plural(s.taggedSlides, 'slide')}` : 'No slide tags'}</li>
              {s.filledIn ? <li>{plural(s.filledIn, 'tag')} filled in {s.filledInBy === 'ai' ? 'by the AI' : 'from similar slides'}: please check {s.filledIn === 1 ? 'it' : 'them'} before you upload</li> : null}
              {s.bestOfTheBest && <li>Marked as part of the Best of the Best collection</li>}
            </ul>
            <p className="arch-note">Everyone can see it once it&rsquo;s uploaded. You can archive it later if needed.</p>
          </>
        )}
      </div>
      <div className="dlg-foot">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" autoFocus onClick={onConfirm}>
          Upload deck
        </button>
      </div>
    </dialog>
  );
}

'use client';

import { useId, useRef } from 'react';
import type { DraftSnapshot } from '../client/draft-status';
import { requestDraftSave } from '../client/draft-save-request';
import type { Draft } from '../client/profile-store';
import { backdropClose, useDialogOpen } from './Dialogs';
import { Icon } from './icons';
import { plural } from './library';
import { useDraft, useNotify, useRuntime } from './state';
import { Button } from './ui/Button';

/**
 * The two ways to bring a saved draft into the draft deck, each ending the same way: the draft deck opens so the result is in view, and a toast offers Undo.
 * "open" replaces what is there; "add" puts the saved draft's slides after the ones already there.
 */
export function useDraftOpeners() {
  const { selection, updateSelection, setCartMin, loadDraft, slidesOfDraft, snapshotDraft, restoreDraft } = useDraft();
  const { toast, announce } = useNotify();
  const loading = () => toast('The library is still loading. Please try again in a moment.');
  /* Undo only while the draft deck is still as this action left it (restoreDraft checks), and only if there was something to bring back. */
  const undoFor = (before: DraftSnapshot, after: string[]) => (before.slides.length > 0 ? { label: 'Undo', run: () => restoreDraft(before, after) } : undefined);

  /** Replace the draft deck with the saved draft. `before` is what Undo brings back (default: the draft deck as it is now); `lead` starts the toast. */
  const open = (draft: Draft, before: DraftSnapshot = snapshotDraft(), lead = '') => {
    const found = slidesOfDraft(draft);
    if (!found) return loading();
    if (found.length === 0 && draft.slideIds.length > 0) {
      toast(`None of the slides in “${draft.name}” are in the library right now (they may be hidden or removed), so it was not opened.`);
      return;
    }
    loadDraft(draft);
    setCartMin(false);
    const gone = draft.slideIds.length - found.length;
    toast(`${lead}Opened “${draft.name}” in your draft deck.${gone > 0 ? ` ${plural(gone, 'slide')} in it ${gone === 1 ? 'is' : 'are'} hidden or no longer in the library and stay${gone === 1 ? 's' : ''} in the saved deck.` : ''}`, undoFor(before, found.map((s) => s.id)));
    announce(`Opened ${draft.name} in the draft deck`);
  };

  /** Keep what is in the draft deck and add the saved draft's slides after it (a slide already there is not added twice). */
  const add = (draft: Draft) => {
    const found = slidesOfDraft(draft);
    if (!found) return loading();
    const before = snapshotDraft();
    const fresh = found.filter((s) => !selection.some((c) => c.id === s.id));
    if (fresh.length === 0) {
      toast(found.length === 0 && draft.slideIds.length > 0 ? `None of the slides in “${draft.name}” are in the library right now (they may be hidden or removed).` : `Everything in “${draft.name}” was already in your draft deck.`);
      return;
    }
    updateSelection((cur) => [...cur, ...fresh.filter((s) => !cur.some((c) => c.id === s.id))]);
    setCartMin(false);
    toast(`Added ${plural(fresh.length, 'slide')} from “${draft.name}” to your draft deck.`, undoFor(before, [...selection, ...fresh].map((s) => s.id)));
    announce(`${plural(fresh.length, 'slide')} from ${draft.name} added to the draft deck`);
  };
  return { open, add };
}

/**
 * Opening a saved draft while the draft deck holds unsaved work: ask first, in plain words.
 * "Save them first" opens the draft deck and its Save as draft box (which also refuses a name that is already taken); the saved draft opens once that is saved, and nothing happens if the box is closed.
 * "Add to them" keeps what is there and adds the saved draft's slides after it. Closing the box changes nothing.
 * When the saved draft is the very deck being edited, "Add to them" makes no sense, so the box offers to reopen the saved version instead.
 */
export function OpenDraftDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const { runtime } = useRuntime();
  const { selection, draftOrigin } = useDraft();
  const { open, add } = useDraftOpeners();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useDialogOpen(ref, draft !== null);

  const n = selection.length;
  const shown = draft?.name ?? '';
  const sameDeck = !!draft && draftOrigin?.id === draft.id;

  const saveFirst = () => {
    if (!draft) return;
    const slides = selection;
    requestDraftSave((saved) => open(draft, { slides, title: saved.name, originId: saved.id }, `Saved “${saved.name}”. `));
    onClose();
  };

  return (
    <dialog ref={ref} className="slidevault sv-dialog open-draft" data-theme={runtime.theme} aria-labelledby={titleId} onClose={onClose} onClick={backdropClose(onClose)}>
      {draft && (
        <>
          <div className="dlg-head">
            <h2 id={titleId}>{sameDeck ? `“${shown}” has changes you have not saved` : 'Your draft deck has slides in it'}</h2>
            <Button variant="ghost" iconOnly size="sm" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </Button>
          </div>
          <div className="dlg-body">
            <p className="open-draft-lead">
              {sameDeck
                ? `“${shown}” is already in your draft deck, with changes that are not saved. Opening it again replaces those changes with the saved version. Do you want to save your changes first?`
                : `There ${n === 1 ? 'is' : 'are'} already ${plural(n, 'slide')} in your draft deck that ${n === 1 ? 'is' : 'are'} not saved. Do you want to save ${n === 1 ? 'it' : 'them'} first, or add the slides from “${shown}” to ${n === 1 ? 'it' : 'them'}?`}
            </p>
          </div>
          <div className="dlg-foot">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {sameDeck ? (
              <Button
                onClick={() => {
                  open(draft);
                  onClose();
                }}
              >
                Reopen saved version
              </Button>
            ) : (
              <Button
                onClick={() => {
                  add(draft);
                  onClose();
                }}
              >
                Add to them
              </Button>
            )}
            <Button variant="primary" onClick={saveFirst}>
              Save them first
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}

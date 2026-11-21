'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import type { DraftSnapshot } from '../client/draft-status';
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
  const undoFor = (before: DraftSnapshot) => (before.slides.length > 0 ? { label: 'Undo', run: () => restoreDraft(before) } : undefined);

  /** Replace the draft deck with the saved draft. `before` is what Undo brings back (default: the draft deck as it is now); `lead` starts the toast. */
  const open = (draft: Draft, before: DraftSnapshot = snapshotDraft(), lead = '') => {
    if (!slidesOfDraft(draft)) return loading();
    const found = loadDraft(draft);
    setCartMin(false);
    const gone = draft.slideIds.length - found;
    toast(`${lead}Opened “${draft.name}” in your draft deck.${gone > 0 ? ` ${gone} slide(s) are no longer in the library.` : ''}`, undoFor(before));
    announce(`Opened ${draft.name} in the draft deck`);
  };

  /** Keep what is in the draft deck and add the saved draft's slides after it (a slide already there is not added twice). */
  const add = (draft: Draft) => {
    const found = slidesOfDraft(draft);
    if (!found) return loading();
    const before = snapshotDraft();
    const fresh = found.filter((s) => !selection.some((c) => c.id === s.id));
    updateSelection((cur) => [...cur, ...fresh.filter((s) => !cur.some((c) => c.id === s.id))]);
    setCartMin(false);
    toast(fresh.length ? `Added ${plural(fresh.length, 'slide')} from “${draft.name}” to your draft deck.` : `Everything in “${draft.name}” was already in your draft deck.`, fresh.length ? undoFor(before) : undefined);
    announce(`${plural(fresh.length, 'slide')} from ${draft.name} added to the draft deck`);
  };
  return { open, add };
}

/**
 * Opening a saved draft while the draft deck holds unsaved work: ask first, in plain words.
 * "Save them first" saves the draft deck (under its own name, with no further question; a name is asked for only when it has none), then opens the saved draft.
 * "Add to them" keeps what is there and adds the saved draft's slides after it. Closing the box changes nothing.
 */
export function OpenDraftDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const { runtime } = useRuntime();
  const { selection, draftTitle, draftOrigin, saveDraft, replaceDraft } = useDraft();
  const { toast } = useNotify();
  const { open, add } = useDraftOpeners();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const nameId = useId();
  const [step, setStep] = useState<'ask' | 'name'>('ask');
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  useDialogOpen(ref, draft !== null);

  const n = selection.length;
  const shown = draft?.name ?? '';
  /* The draft deck's own name: the saved deck it came from, or what was typed in its name box. */
  const ownName = draftOrigin ? draftTitle.trim() || draftOrigin.name : draftTitle.trim();

  const saveThenOpen = async (name: string) => {
    if (!draft || !name || saving) return;
    setSaving(true);
    try {
      let id: string | null;
      if (draftOrigin) {
        await replaceDraft(draftOrigin.id, name, selection);
        id = draftOrigin.id;
      } else id = await saveDraft(name, selection);
      open(draft, { slides: selection, title: name, originId: id }, `Saved “${name}”. `);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the draft deck. Nothing was changed.');
      setSaving(false);
    }
  };
  const submitName = (e: FormEvent) => {
    e.preventDefault();
    void saveThenOpen(typed.trim());
  };

  return (
    <dialog ref={ref} className="slidevault sv-dialog open-draft" data-theme={runtime.theme} aria-labelledby={titleId} onClose={onClose} onClick={backdropClose(onClose)}>
      {draft && (
        <>
          <div className="dlg-head">
            <h2 id={titleId}>{step === 'ask' ? 'Your draft deck has slides in it' : 'Name your draft deck'}</h2>
            <Button variant="ghost" iconOnly size="sm" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </Button>
          </div>
          {step === 'ask' ? (
            <>
              <div className="dlg-body">
                <p className="open-draft-lead">
                  There {n === 1 ? 'is' : 'are'} already {plural(n, 'slide')} in your draft deck that {n === 1 ? 'is' : 'are'} not saved. Do you want to save {n === 1 ? 'it' : 'them'} first, or add the slides from “{shown}” to {n === 1 ? 'it' : 'them'}?
                </p>
              </div>
              <div className="dlg-foot">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    add(draft);
                    onClose();
                  }}
                >
                  Add to them
                </Button>
                <Button variant="primary" disabled={saving} onClick={() => (ownName ? void saveThenOpen(ownName) : setStep('name'))}>
                  {saving ? 'Saving…' : 'Save them first'}
                </Button>
              </div>
            </>
          ) : (
            <form onSubmit={submitName}>
              <div className="dlg-body">
                <label className="save-name" htmlFor={nameId}>
                  <span>Name this draft</span>
                  <input id={nameId} type="text" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={80} placeholder="For example, Harbor Bank pitch" autoFocus autoComplete="off" />
                </label>
                <p className="meta open-draft-note">
                  {plural(n, 'slide')} will be saved, then “{shown}” opens in your draft deck.
                </p>
              </div>
              <div className="dlg-foot">
                <Button variant="ghost" onClick={() => setStep('ask')}>
                  Back
                </Button>
                <Button type="submit" variant="primary" disabled={!typed.trim() || saving}>
                  {saving ? 'Saving…' : 'Save and open'}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </dialog>
  );
}

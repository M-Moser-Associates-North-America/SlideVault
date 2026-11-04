'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { SlideDetail, SlideSummary, TitleEdit } from '../contracts/dto';
import { backdropClose, useDialogOpen } from './Dialogs';
import { Icon } from './icons';
import { titleEditOf, useWorkspace } from './state';

const MAX_TITLE = 200;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
/** What is technically true about the current name: a person, the AI, or the system that read it from the slide's text. */
function lastRenamed(e: TitleEdit): string {
  const when = e.at ? ` · ${day(e.at)}` : '';
  if (e.kind === 'person') return `Last renamed by ${e.by ?? 'someone'}${when}`;
  if (e.kind === 'ai') return `Last renamed by AI${when}`;
  return `Last renamed by the system, read automatically from the slide's text${when}`;
}
const tidy = (raw: string) => raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);

/**
 * The slide page's title with a pencil beside it. The title is read from the slide's own text, so it can
 * be wrong; the pencil opens one pop-up that warns the new name is for everyone and takes the new name
 * there (FD-73). Nothing changes until "Rename for everyone" is pressed.
 */
export function SlideTitle({ slide, loaded }: { slide: SlideSummary; loaded?: SlideDetail | null }) {
  const { runtime, renameSlide } = useWorkspace();
  const canEdit = runtime.capabilities.has('metadata.edit');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(slide.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  const id = useId();
  useDialogOpen(ref, open);

  const edit = titleEditOf(slide.id, loaded?.titleEdit ?? slide.titleEdit);
  const next = tidy(text);
  const changed = next !== slide.title && next.length > 0;

  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    field.current?.select();
  }, [open]);

  const start = () => {
    setText(slide.title);
    setError(null);
    setOpen(true);
  };
  const close = () => {
    if (busy) return;
    setOpen(false);
    setTimeout(() => pencil.current?.focus(), 0);
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await renameSlide(slide.id, next);
      setOpen(false);
      setTimeout(() => pencil.current?.focus(), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="slide-title-row">
      <h1 className="h1" tabIndex={-1}>
        {slide.title}
      </h1>
      {canEdit && (
        <button ref={pencil} type="button" className="title-edit" aria-label="Rename this slide" data-tip="Rename this slide" onClick={start}>
          <Icon name="pencil" />
        </button>
      )}
      <dialog ref={ref} className="slidevault sv-dialog" data-theme={runtime.theme} aria-labelledby={`${id}-t`} onClose={() => setOpen(false)} onClick={(e) => backdropClose(close)(e)}>
        <form onSubmit={save}>
          <div className="dlg-head">
            <h2 id={`${id}-t`}>Rename this slide?</h2>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={close}>
              <Icon name="x" />
            </button>
          </div>
          <div className="dlg-body arch-body">
            <div className="notice info">
              <Icon name="alert" />
              <span>This changes the name for everyone using SlideVault, not just you. Use it when the title was read wrongly from the file.</span>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor={`${id}-n`}>Slide name</label>
              <input ref={field} id={`${id}-n`} className="input" type="text" value={text} maxLength={MAX_TITLE} disabled={busy} onChange={(e) => setText(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-e` : undefined} />
            </div>
            <p className="title-edit-note">
              <em>{lastRenamed(edit)}</em>
            </p>
            {error && (
              <p id={`${id}-e`} className="field-hint is-missing" role="alert" style={{ marginTop: 8 }}>
                {error}
              </p>
            )}
          </div>
          <div className="dlg-foot">
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!changed || busy}>
              {busy ? 'Renaming…' : 'Rename for everyone'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

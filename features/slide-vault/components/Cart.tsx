'use client';

import { Button } from './ui/Button';
import { stopNudge, useNudge } from '../client/draft-nudge';
import { useTourOpen } from '../client/tour-store';
import { draftStatus } from '../client/draft-status';
import { isServerDraft } from '../client/profile-store';
import { setUnsavedDeck } from '../client/unsaved-deck-store';
import { onDraftSaveRequest, type AfterSave } from '../client/draft-save-request';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from './icons';
import { downloadPlan, plural } from './library';
import { useRoot } from './root';
import { workspaceSizeOf } from './size';
import type { SlideSummary } from '../contracts/dto';
import { Link, Thumb } from './parts';
import { useAccount, useDraft, useLibrary, useNotify, useOverlays, useRuntime } from './state';
import { addTagToSlides, TagsUnavailable } from '../client/tag-store';
import { cleanTag, TAG_MAX_LENGTH } from './TagField';

/**
 * The cart: slides ticked anywhere on the site, in the order they will download.
 * Collapsed to a thin rail by default; opens by itself the first time a slide is added.
 */
export function Cart() {
  const { runtime } = useRuntime();
  const { packs, library } = useLibrary();
  const { selection, updateSelection, excluded, setIncluded, cartMin, setCartMin, draftTitle, setDraftTitle, saveDraft, replaceDraft, draftOrigin, snapshotDraft, putBackSlides, drafts, combine, setCombine, addPackToDraft } = useDraft();
  const { openDownload, openPreview, openPackDialog } = useOverlays();
  const { announce, toast } = useNotify();
  const n = selection.length;
  const included = selection.filter((s) => !excluded.has(s.id));
  const plan = downloadPlan(included);

  /* "Clear" asks "Are you sure?" first. The question belongs to the current list of slides, so any
     change to the list (adding or removing a slide) quietly cancels it. */
  const signature = selection.map((s) => s.id).join(',');
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const confirming = confirmFor === signature && n > 0;

  /* "Save as draft" asks for a name in a small dialog. When the draft deck came from a saved deck (opened
     from My decks, or saved from here before), it also asks: update that deck, or save a new one? */
  const saveRef = useRef<HTMLDialogElement>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [choice, setChoice] = useState<'update' | 'new'>('update');
  const [typedName, setTypedName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const origin = draftOrigin;
  /* Every slide the library shows now: saved slides that are hidden or gone cannot be in the draft deck, so they are not counted as removed. */
  const known = useMemo(() => (library.status === 'ready' ? new Set(library.slides.map((s) => s.id)) : null), [library]);
  const savedIds = (origin?.slideIds ?? []).filter((id) => !known || known.has(id));
  const nowIds = selection.map((s) => s.id);
  const added = origin ? nowIds.filter((id) => !savedIds.includes(id)).length : 0;
  const removed = origin ? savedIds.filter((id) => !nowIds.includes(id)).length : 0;
  const reordered = !!origin && added === 0 && removed === 0 && nowIds.join() !== savedIds.join();
  const unchanged = !!origin && added === 0 && removed === 0 && !reordered;
  const title = draftTitle.trim();
  /* Saved, or not: shown in the header, and it decides whether Clear needs a confirmation. */
  const status = draftStatus(selection, origin, draftTitle, known);
  /* A saved draft the server does not hold lives only in this browser; say so. */
  const deviceOnly = status === 'saved' && !!origin && (!isServerDraft(origin.id) || !!origin.pending); /* pending: updated while the server was out of reach */
  /* Closing or reloading the tab with a draft deck that is not saved asks first (the draft deck is not kept anywhere else). Not in automated test browsers, which have nobody to answer. */
  const unsaved = status === 'new' || status === 'changed';
  /* The app's Sign out asks first while there is an unsaved draft deck. */
  useEffect(() => {
    setUnsavedDeck(unsaved ? selection.length : 0);
    return () => setUnsavedDeck(0);
  }, [unsaved, selection.length]);
  useEffect(() => {
    if (!unsaved || navigator.webdriver) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [unsaved]);
  /* What the name box starts with: the deck's own name to update it, or a fresh name for a copy. */
  const suggestedName = !origin ? title : choice === 'update' ? title || origin.name : title && title.toLowerCase() !== origin.name.toLowerCase() ? title : `${origin.name} copy`;
  const draftName = typedName ?? suggestedName;
  /* A name that is already a saved draft's (another one: updating a deck may keep its own name) must be changed first; delete the old one and the name is free again. */
  const keepsOwnName = !!origin && choice === 'update' && draftName.trim().toLowerCase() === origin.name.trim().toLowerCase();
  const nameTaken = keepsOwnName ? null : (drafts.find((d) => d.name.trim().toLowerCase() === draftName.trim().toLowerCase()) ?? null);
  const changes = [added > 0 && `${plural(added, 'slide')} added`, removed > 0 && `${plural(removed, 'slide')} removed`, reordered && 'order changed'].filter(Boolean).join(', ');
  const openSave = () => {
    setTypedName(null);
    setChoice(origin && !unchanged ? 'update' : 'new');
    setSaving(false);
    setSaveOpen(true);
    saveRef.current?.showModal();
  };
  const afterSave = useRef<AfterSave | null>(null);
  const closeSave = () => {
    afterSave.current = null; /* closed without saving: whatever was waiting on the save does not happen */
    saveRef.current?.close();
    setSaveOpen(false);
  };
  /* "Save them first" from My decks: the draft deck opens and shows this same box; what was waiting happens only once the draft is saved. */
  const openSaveNow = useRef(openSave);
  useEffect(() => {
    openSaveNow.current = openSave;
  });
  useEffect(
    () =>
      onDraftSaveRequest((after) => {
        setCartMin(false);
        openSaveNow.current();
        afterSave.current = after;
      }),
    [setCartMin],
  );
  const submitSave = async (e: FormEvent) => {
    e.preventDefault();
    const name = draftName.trim();
    if (!name || saving) return;
    const updating = !!origin && choice === 'update';
    if (nameTaken) return;
    setSaving(true);
    let savedId: string | null = null;
    try {
      if (updating && origin) savedId = await replaceDraft(origin.id, name, selection);
      else savedId = await saveDraft(name, selection);
    } catch {
      setSaving(false);
      toast(updating ? 'Could not update the deck. Nothing was changed. Try again.' : 'Could not save the deck. Try again.');
      return;
    }
    setSaving(false);
    /* When something is waiting on this save (opening a saved draft), its own toast says both; otherwise say what was saved. */
    const here = savedId !== null && !isServerDraft(savedId) ? ' on this device only' : '';
    if (!afterSave.current) toast(updating ? `Updated “${name}” in My decks${here}` : `Saved “${name}” to My decks${here}`);
    announce(updating ? `Updated ${name} in My decks` : `Saved ${name} as a new deck in My decks`);
    const after = afterSave.current;
    closeSave();
    after?.({ id: savedId, name, updated: updating });
  };

  const listRef = useRef<HTMLUListElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [mark, setMark] = useState<{ id: string; after: boolean } | null>(null);
  const focusGrip = useRef<string | null>(null);

  useEffect(() => {
    if (focusGrip.current) {
      listRef.current?.querySelector<HTMLElement>(`.grip[data-id="${CSS.escape(focusGrip.current)}"]`)?.focus();
      focusGrip.current = null;
    }
  });

  /* A slide that sits in the list with the rest of its pack, side by side, moves with them as one block. */
  const blockOf = (id: string): string[] => {
    const pack = packs.of(id);
    if (!pack) return [id];
    const at = selection.flatMap((s, i) => (packs.of(s.id)?.id === pack.id ? [i] : []));
    const together = at.length > 1 && at.every((v, k) => k === 0 || v === at[k - 1] + 1);
    return together ? at.map((i) => selection[i].id) : [id];
  };

  const move = (id: string, to: number) => {
    const block = blockOf(id);
    updateSelection((cur) => {
      const items = block.map((b) => cur.find((s) => s.id === b)).filter((x): x is SlideSummary => !!x);
      if (!items.length) return cur;
      const order = cur.filter((s) => !block.includes(s.id));
      order.splice(Math.max(0, Math.min(order.length, to)), 0, ...items);
      return order;
    });
    const what = block.length > 1 ? `Pack of ${block.length} slides` : (selection.find((s) => s.id === id)?.title ?? 'Slide');
    announce(`${what} moved to position ${Math.max(1, Math.min(n - block.length + 1, to + 1))} of ${n}`);
  };

  /** Where would a drop at pointer height y land? Index among the other items, plus which line to draw. */
  const dropAt = (y: number, skip: string[] = dragId ? blockOf(dragId) : []): { index: number; id: string | null; after: boolean } => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('.ci') ?? [])].filter((li) => !skip.includes(li.dataset.id ?? ''));
    for (let i = 0; i < items.length; i++) {
      const b = items[i].getBoundingClientRect();
      if (y < b.top + b.height / 2) return { index: i, id: items[i].dataset.id ?? null, after: false };
    }
    return {
      index: items.length,
      id: items[items.length - 1]?.dataset.id ?? null,
      after: true,
    };
  };

  /* Dragging starts from the handle with a pointer (finger or mouse), so it works on touch screens too. */
  const startDrag = (e: PointerEvent<HTMLButtonElement>, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const block = blockOf(id);
    setDragId(id);
    const scroller = listRef.current?.closest<HTMLElement>('.cart-body');
    const over = (ev: globalThis.PointerEvent) => {
      const d = dropAt(ev.clientY, block);
      setMark(d.id ? { id: d.id, after: d.after } : null);
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (ev.clientY < r.top + 48) scroller.scrollTop -= 12;
        else if (ev.clientY > r.bottom - 48) scroller.scrollTop += 12;
      }
    };
    const finish = (ev: globalThis.PointerEvent) => {
      grip.removeEventListener('pointermove', over);
      grip.removeEventListener('pointerup', finish);
      grip.removeEventListener('pointercancel', finish);
      const d = dropAt(ev.clientY, block);
      setDragId(null);
      setMark(null);
      if (ev.type === 'pointerup' && d.index !== selection.findIndex((x) => x.id === block[0])) {
        focusGrip.current = id;
        move(id, d.index);
      }
    };
    grip.addEventListener('pointermove', over);
    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);
  };

  const onGripKey = (e: KeyboardEvent, id: string) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const block = blockOf(id);
    const first = selection.findIndex((x) => x.id === block[0]);
    const to = e.key === 'ArrowUp' ? first - 1 : first + 1;
    if (to < 0 || to > n - block.length) return;
    focusGrip.current = id;
    move(id, to);
  };

  /* The panel is as tall as the room left under the header: full height once the page has scrolled
     and the panel has stuck to the top, shorter while the page header is still showing. */
  const { scroll } = useRoot();
  const empty = n === 0;
  useEffect(() => {
    const scroller = scroll.current;
    if (!scroller) return;
    const fit = () => {
      const col = scroller.querySelector<HTMLElement>('.cart-col');
      if (!col) return;
      /* Stick right under the tabs bar, whatever its height is, so no gap shows above the panel. */
      /* Only a pinned tabs bar takes room at the top; on desktop the header scrolls away, so the panel sticks to the very top. */
      const top = document.querySelector<HTMLElement>('.slidevault .sv-top');
      const stick = top && /sticky|fixed/.test(getComputedStyle(top).position) ? top.offsetHeight : 0;
      col.style.setProperty('--cart-top', `${stick}px`);
      const colTop = col.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      col.style.setProperty('--cart-room', `${Math.max(240, scroller.clientHeight - Math.max(stick, colTop))}px`);
    };
    fit();
    /* Measure again once the panel has opened or closed and the layout has settled, and whenever anything
       that decides the panel's top or the room under it changes size (the page, the tabs bar, the layout
       grid, the panel itself), so the card always reaches the bottom. */
    const settle = [requestAnimationFrame(fit), window.setTimeout(fit, 120), window.setTimeout(fit, 400)];
    scroller.addEventListener('scroll', fit, { passive: true });
    window.addEventListener('resize', fit);
    const observer = new ResizeObserver(fit);
    observer.observe(scroller);
    for (const el of scroller.querySelectorAll('.sv-top, .sv-shell, .cart-col')) observer.observe(el);
    return () => {
      cancelAnimationFrame(settle[0] as number);
      clearTimeout(settle[1]);
      clearTimeout(settle[2]);
      scroller.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
      observer.disconnect();
    };
  }, [scroll, cartMin, empty]);

  /* The name of the draft deck. It looks like a field (pencil, outline on hover) so it is clear it can be edited. */
  const titleField = (
    <label className="cart-name">
      <span className="sr-only">Name of this draft deck</span>
      <input type="text" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} maxLength={80} placeholder="Untitled draft deck" autoComplete="off" spellCheck={false} />
      <Icon name="pencil" className="ic cart-name-ic" />
    </label>
  );

  const closeCart = () => {
    setCartMin(true);
    focusDraftOpener();
  };

  /* On phones and upright tablets the open draft deck covers the page: Escape closes it (a tap on the dimmed page does too). */
  useEffect(() => {
    if (cartMin) return;
    const overlay = () => workspaceSizeOf(document.querySelector('.slidevault .cart-col')) !== 'wide';
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (overlay() && e.key === 'Escape' && !document.querySelector('dialog[open]')) closeCart();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const toggleButton = (
    <Button variant="ghost" iconOnly size="sm" className="cart-tg" aria-label="Close draft deck" onClick={closeCart}>
      <Icon name="x" />
    </Button>
  );

  if (!n) {
    return (
      <>
        <div className="cart cart-empty">
          <div className="cart-head">
            <div className="cart-top">
              <h2 className="cart-h">Draft deck</h2>
              <span className="cart-tools">{toggleButton}</span>
            </div>
            {titleField}
            <p className="cart-title">No slides yet</p>
          </div>
          <div className="cart-body">
            <div className="cart-empty-body">
              <span className="ce-ic" aria-hidden="true">
                <Icon name="layers" />
              </span>
              <p className="meta">Tick slides to collect them here.</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  const none = included.length === 0;
  /* Clearing never loses saved work, and an Undo brings the slides back either way. */
  const clearNow = () => {
    const before = snapshotDraft();
    updateSelection(() => []);
    announce('Draft deck cleared');
    toast('Draft deck cleared', { label: 'Undo', run: () => putBackSlides(before, before.slides.map((x) => x.id)) });
  };
  return (
    <>
      <div className="cart" role="region" aria-label="Draft deck">
        <div className="cart-head">
          <div className="cart-top">
            <h2 className="cart-h">
              Draft deck<span className="count">{n}</span>
            </h2>
            <span className="cart-tools">{toggleButton}</span>
          </div>
          {titleField}
          <p className="cart-title">
            {plural(n, 'slide')}
            <span className={`cart-state is-${status}`}>
              {status === 'saved' ? (
                <>
                  <Icon name="check" className="ic-sm" /> {deviceOnly ? 'Saved on this device only' : 'Saved'}
                </>
              ) : status === 'changed' ? (
                'Unsaved changes'
              ) : (
                'Not saved yet'
              )}
            </span>
          </p>
          <div className="cart-acts">
            <Button size="sm" onClick={openSave}>
              <Icon name="folder" />
              <span>Save as draft</span>
            </Button>
            <Button size="sm" variant="primary" disabled={none} title={none ? 'Add at least one slide to your draft deck first.' : undefined} onClick={() => openDownload(included)}>
              <Icon name="download" />
              <span>Download as pptx</span>
            </Button>
          </div>
        </div>
        <div className="cart-body">
          <ul ref={listRef} className="cart-items">
            {selection.map((s, i) => {
              const off = excluded.has(s.id);
              const pack = packs.of(s.id);
              const prevPack = i > 0 ? packs.of(selection[i - 1].id) : null;
              const nextPack = i < n - 1 ? packs.of(selection[i + 1].id) : null;
              const first = !!pack && prevPack?.id !== pack.id;
              const last = !!pack && nextPack?.id !== pack.id;
              const present = pack ? selection.filter((x) => pack.slideIds.includes(x.id)).length : 0;
              const dragging = !!dragId && blockOf(dragId).includes(s.id);
              const cls = ['ci', off ? 'off' : '', dragging ? 'dragging' : '', pack ? 'in-pack' : '', first ? 'pack-first' : '', last ? 'pack-last' : '', mark?.id === s.id ? (mark.after ? 'drop-after' : 'drop-before') : ''].filter(Boolean).join(' ');
              return (
                <Fragment key={s.id}>
                  {first && pack && (
                    <li className="pack-head">
                      <Icon name="layers" className="ic-sm" />
                      <span className="ph-t">
                        {pack.label ?? 'Pack'} · {present} of {pack.slideIds.length}
                      </span>
                      {present < pack.slideIds.length && (
                        <Button variant="link" onClick={() => addPackToDraft(pack)}>
                          Add the rest
                        </Button>
                      )}
                    </li>
                  )}
                  <li className={cls} data-id={s.id}>
                    <button
                      type="button"
                      className="grip"
                      data-id={s.id}
                      title={pack && blockOf(s.id).length > 1 ? 'Drag to reorder. The whole pack moves together.' : 'Drag to reorder'}
                      onPointerDown={(e) => startDrag(e, s.id)}
                      aria-label={`Reorder: ${s.title}, position ${i + 1} of ${n}.${blockOf(s.id).length > 1 ? ' The whole pack moves together.' : ''} Press up or down arrow to move.`}
                      onKeyDown={(e) => onGripKey(e, s.id)}
                    >
                      <Icon name="grip" />
                    </button>
                    <input type="checkbox" checked={!off} onChange={(e) => setIncluded(s.id, e.target.checked)} aria-label={`Include in download: ${s.title}`} />
                    <div className="t">
                      <Thumb slide={s} />
                      <span className="ci-n" aria-hidden="true">
                        {i + 1}
                      </span>
                    </div>
                    <div className="ci-txt">
                      <Link to={{ view: 'slide', id: s.id }}>{s.title}</Link>
                      <span className="meta">{s.provenance.sourceTitle}</span>
                    </div>
                    <Button
                      variant="ghost" iconOnly size="sm"
                      aria-label={`Remove from draft deck: ${s.title}`}
                      onClick={() => {
                        if (pack && present > 1) openPackDialog({ kind: 'remove', pack, slide: s });
                        else {
                          const before = snapshotDraft();
                          updateSelection((cur) => cur.filter((x) => x.id !== s.id));
                          /* Undo puts back this slide only, where it was; anything done since stays. */
                          toast(`Removed “${s.title}”`, { label: 'Undo', run: () => putBackSlides(before, [s.id]) });
                        }
                      }}
                    >
                      <Icon name="x" />
                    </Button>
                  </li>
                </Fragment>
              );
            })}
          </ul>
          {n > 1 && <p className="ci-hint">Drag the handle to reorder. Slides download in this order.</p>}
          <TagAll slides={included} />
          {plan.zip && (
            <div className="cart-zip">
              <label className="fb-check">
                <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} />
                <span>Combine into one deck</span>
              </label>
            </div>
          )}
        </div>
        <div className="cart-foot">
          <p className="txt">
            {none ? (
              'No slides ticked.'
            ) : (
              <>
                {included.length < n && (
                  <>
                    <strong>{included.length} of {n} slides</strong> ticked.{' '}
                  </>
                )}
                Downloads as {plan.zip && !combine ? 'a zip, one .pptx per deck' : 'one editable .pptx'}.
              </>
            )}
          </p>
          <div className="cart-list-acts">
            {confirming ? (
              <div className="cart-confirm" role="group" aria-label="Confirm clearing the draft deck">
                <span className="cc-q">{status === 'changed' ? 'Changes not saved. Clear?' : 'Not saved. Clear?'}</span>
                <Button
                  size="sm" iconOnly className="cc-yes"
                  aria-label="Yes, clear the draft deck"
                  title="Yes, clear it"
                  onClick={() => {
                    setConfirmFor(null);
                    clearNow();
                  }}
                >
                  <Icon name="check" />
                </Button>
                <Button size="sm" iconOnly aria-label="No, keep my slides" title="No, keep them" onClick={() => setConfirmFor(null)} autoFocus>
                  <Icon name="x" />
                </Button>
              </div>
            ) : (
              <>
                <Button variant="ghost" size="sm" disabled={none} title={none ? 'Add at least one slide to your draft deck first.' : undefined} onClick={() => openPreview(included, 0)}>
                  <Icon name="eye" />
                  <span>Preview</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => (status === 'saved' ? clearNow() : setConfirmFor(signature))}>
                  <Icon name="trash" />
                  <span>Clear</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      <dialog
        ref={saveRef}
        className="slidevault sv-dialog"
        data-theme={runtime.theme}
        aria-labelledby={`${nameId}-t`}
        onClose={() => {
          afterSave.current = null;
          setSaveOpen(false);
        }}
        onClick={(e) => e.target === e.currentTarget && closeSave()}
      >
        {saveOpen && (
          <form onSubmit={submitSave}>
            <div className="dlg-head">
              <div>
                <h2 id={`${nameId}-t`}>{origin ? 'Save your draft deck' : 'Save as a draft'}</h2>
                <p className="meta">
                  {origin ? (unchanged ? `Started from “${origin.name}”. Nothing has changed since you saved it.` : `Started from “${origin.name}”. Since then: ${changes}.`) : 'Saved under Working drafts in My decks.'}
                </p>
              </div>
              <Button variant="ghost" iconOnly size="sm" className="dlg-close" aria-label="Close" onClick={closeSave}>
                <Icon name="x" />
              </Button>
            </div>
            <div className="dlg-body">
              {origin && choice === 'update' ? (
                <>
                  <p className="save-lead">Update “{origin.name}” with these changes?</p>
                  {draftName.trim() && draftName.trim().toLowerCase() !== origin.name.toLowerCase() && <p className="meta">It will be renamed “{draftName.trim()}”.</p>}
                  {nameTaken && (
                    <p className="save-taken" role="alert">
                      A draft called “{nameTaken.name}” already exists. Change the draft deck’s name first, or save as a new copy.
                    </p>
                  )}
                  <Button variant="link" className="save-copy" onClick={() => { setTypedName(null); setChoice('new'); }}>
                    Save as a new copy instead
                  </Button>
                </>
              ) : (
                <>
                  <label className="save-name" htmlFor={nameId}>
                    <span>Name this draft</span>
                    <input id={nameId} type="text" value={draftName} onChange={(e) => setTypedName(e.target.value)} maxLength={80} placeholder="For example, Harbor Bank pitch" autoFocus autoComplete="off" aria-invalid={!!nameTaken} aria-describedby={nameTaken ? `${nameId}-taken` : undefined} />
                  </label>
                  {nameTaken && (
                    <p id={`${nameId}-taken`} className="save-taken" role="alert">
                      A draft called “{nameTaken.name}” already exists. Please rename this one.
                    </p>
                  )}
                  {origin && !unchanged && (
                    <Button variant="link" className="save-copy" onClick={() => { setTypedName(null); setChoice('update'); }}>
                      Back: update “{origin.name}” instead
                    </Button>
                  )}
                </>
              )}
              <p className="meta" style={{ marginTop: 10 }}>
                {plural(n, 'slide')} will be saved.
              </p>
            </div>
            <div className="dlg-foot">
              <Button type="submit" variant="primary" disabled={!draftName.trim() || saving || !!nameTaken}>
                {saving ? 'Saving…' : origin ? (choice === 'update' ? `Update “${origin.name}”` : 'Save as new copy') : 'Save draft'}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}

/** Puts focus back on whatever opens the draft deck: the bottom tab on a phone, otherwise the black button. */
export function focusDraftOpener() {
  requestAnimationFrame(() => {
    const options = [...document.querySelectorAll<HTMLElement>('.slidevault .sv-bottombar .bb-deck, .slidevault .cart-pill')];
    options.find((el) => el.offsetParent !== null)?.focus();
  });
}

/* The black button at the bottom right that opens the draft deck, like the reference mockup's. It sits at
   the workspace level, outside the panel, so it stays put while the panel is closed. */
export function CartPill() {
  const { selection, cartMin, setCartMin } = useDraft();
  const touring = useTourOpen();
  const nudge = useNudge('draft') && !touring;
  const n = selection.length;
  if (!cartMin) return null;
  return (
    <button
      type="button"
      className={`cart-pill${nudge ? ' is-nudge' : ''}`}
      aria-label={`Open draft deck, ${plural(n, 'slide')}`}
      onClick={() => {
        stopNudge('draft');
        setCartMin(false);
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.slidevault .cart .cart-tg')?.focus());
      }}
    >
      <Icon name="layers" />
      <span>Draft deck</span>
      {n > 0 && <span className="pill-n">{n}</span>}
    </button>
  );
}

/**
 * Tag every ticked slide in the draft deck at once (FD-58), e.g. "Priya" or "2026 pitch", so the
 * set can be found again by typing it. Closed until asked for, to keep the draft deck quiet.
 */
function TagAll({ slides }: { slides: SlideSummary[] }) {
  const { runtime } = useRuntime();
  const { toast } = useNotify();
  const { profile } = useAccount();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!slides.length) return null;
  if (!open)
    return (
      <Button variant="link" className="cart-tagall-open" title="Adds one tag to every slide in this draft deck. Everyone can see it." onClick={() => setOpen(true)}>
        <Icon name="tag" className="ic-sm" /> Tag {slides.length === 1 ? 'this slide' : `all ${slides.length} slides`}
      </Button>
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = cleanTag(text);
    if (!name || busy) return;
    setBusy(true);
    try {
      const added = await addTagToSlides(runtime, profile, slides, name);
      toast(added ? `Tagged ${plural(added, 'slide')} “${name}”.` : `Every slide already has “${name}”.`);
      setText('');
      setOpen(false);
    } catch (err) {
      toast(err instanceof TagsUnavailable || err instanceof Error ? err.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cart-tagall-wrap">
      <form className="cart-tagall" onSubmit={(e) => void submit(e)}>
        <label htmlFor={`${id}-t`} className="sr-only">
          Tag for all {slides.length} slides
        </label>
        <input id={`${id}-t`} className="input" type="text" value={text} maxLength={TAG_MAX_LENGTH} placeholder="Tag, e.g. Priya" disabled={busy} onChange={(e) => setText(e.target.value)} autoFocus />
        <Button type="submit" size="sm" disabled={busy || !cleanTag(text)}>
          {busy ? 'Tagging…' : 'Add'}
        </Button>
        <Button size="sm" iconOnly aria-label="Cancel tagging" onClick={() => setOpen(false)} disabled={busy}>
          <Icon name="x" />
        </Button>
      </form>
      <p className="meta cart-tagall-note">Tags are shared with everyone, and show up in search.</p>
    </div>
  );
}

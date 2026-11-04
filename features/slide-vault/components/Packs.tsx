'use client';

import { useRef, useState, type FormEvent } from 'react';
import { packPosition, type Pack } from '../client/packs';
import type { SlideSummary } from '../contracts/dto';
import { backdropClose, useDialogOpen } from './Dialogs';
import { Icon } from './icons';
import { plural } from './library';
import { Link, Thumb, useAddSection, useCartToggle } from './parts';
import { useWorkspace } from './state';

/**
 * Packs (FD-38): slides that only work together, such as a team introduction and its people. Picking
 * one asks whether to bring the rest; the draft deck keeps a pack together; anyone can group slides
 * into a pack and ungroup them again for now (a later tier decision, see notes.md).
 */

const packName = (pack: Pack) => (pack.label ? `“${pack.label}”` : 'this pack');

/** The slides of a pack in order, current one marked. */
export function PackStrip({ pack, currentId, onNavigate }: { pack: Pack; currentId?: string; onNavigate?: () => void }) {
  const { library } = useWorkspace();
  const byId = new Map((library.status === 'ready' ? library.slides : []).map((s) => [s.id, s]));
  return (
    <ol className="pack-strip" aria-label={`Slides in ${pack.label ?? 'the pack'}`}>
      {pack.slideIds.map((id, i) => {
        const s = byId.get(id);
        if (!s) return null;
        const here = id === currentId;
        return (
          <li key={id} className={here ? 'is-here' : undefined}>
            <Link to={{ view: 'slide', id }} className="ps-t" aria-label={`Slide ${i + 1} of ${pack.slideIds.length}: ${s.title}${here ? ' (this one)' : ''}`} onNavigate={onNavigate}>
              <Thumb slide={s} />
              <span className="ps-n" aria-hidden="true">
                {i + 1}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** The question asked before adding or removing one slide of a pack, and before ungrouping one. */
export function PackDialog() {
  const { runtime, library, packDialog, closePackDialog, selection, updateSelection, addPackToDraft, removePackFromDraft, ungroupPack, toast, announce } = useWorkspace();
  const { setOne } = useCartToggle();
  const { addNow } = useAddSection();
  const ref = useRef<HTMLDialogElement>(null);
  useDialogOpen(ref, !!packDialog);
  const [busy, setBusy] = useState(false);
  const d = packDialog;
  const pack = d?.pack;
  const inDeck = pack ? pack.slideIds.filter((id) => selection.some((s) => s.id === id)) : [];
  const total = pack?.slideIds.length ?? 0;

  const run = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      closePackDialog();
    }
  };
  const ungroup = () =>
    run(async () => {
      if (!pack) return;
      try {
        const where = await ungroupPack(pack);
        toast(where === 'saved' ? 'Done. The slides are still in the library.' : 'Pack ungrouped in this browser. The server will keep it until it can store changes.');
        announce('Pack ungrouped');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not ungroup the pack. Nothing was changed.');
      }
    });

  let title = '';
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;
  if (d && pack) {
    if (d.kind === 'add' && d.slide) {
      const slide = d.slide;
      const others = pack.slideIds.filter((id) => id !== slide.id && !inDeck.includes(id));
      title = 'This slide is part of a pack';
      body = (
        <>
          <p>
            It is slide {packPosition(pack, slide.id)} of {total} in {pack.label ? <>the pack <strong>{pack.label}</strong></> : 'a pack'}. These slides work best added together, in this order.
          </p>
          {inDeck.length > 0 && <p className="meta">{plural(inDeck.length, 'slide')} of this pack {inDeck.length === 1 ? 'is' : 'are'} already in your draft deck.</p>}
          <PackStrip pack={pack} currentId={slide.id} onNavigate={closePackDialog} />
          {pack.status === 'suggested' && <p className="meta">This pack was suggested and has not been confirmed by a person yet.</p>}
        </>
      );
      actions = (
        <>
          <button type="button" className="btn btn-ghost" onClick={closePackDialog}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => setOne(slide, true))}>
            Only this slide
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} autoFocus onClick={() => run(() => addPackToDraft(pack))}>
            {inDeck.length > 0 ? `Add the other ${others.length + 1}` : `Add all ${total} slides`}
          </button>
        </>
      );
    } else if (d.kind === 'section' && d.section) {
      const sec = d.section;
      const inside = new Set(sec.slides.map((x) => x.id));
      const inPacks = sec.slides.filter((x) => sec.packs.some((p) => p.slideIds.includes(x.id)));
      const outsideIds = [...new Set(sec.packs.flatMap((p) => p.slideIds).filter((id) => !inside.has(id) && !selection.some((x) => x.id === id)))];
      const bySlide = new Map((library.status === 'ready' ? library.slides : []).map((x) => [x.id, x]));
      const outside = outsideIds.map((id) => bySlide.get(id)).filter((x): x is SlideSummary => !!x);
      title = 'Part of this section belongs to a pack';
      body = (
        <>
          <p>
            {plural(inPacks.length, 'slide')} in <strong>{sec.name}</strong> {inPacks.length === 1 ? 'belongs' : 'belong'} to {sec.packs.length === 1 ? (pack.label ? <>the pack <strong>{pack.label}</strong></> : 'a pack') : `${sec.packs.length} packs`}, and {plural(outside.length, 'more slide')} of {sec.packs.length === 1 ? 'it' : 'them'} {outside.length === 1 ? 'is' : 'are'} outside this section. These slides work best added together.
          </p>
          <PackStrip pack={pack} onNavigate={closePackDialog} />
          {pack.status === 'suggested' && <p className="meta">This pack was suggested and has not been confirmed by a person yet.</p>}
        </>
      );
      actions = (
        <>
          <button type="button" className="btn btn-ghost" onClick={closePackDialog}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => addNow(sec.name, sec.slides))}>
            Only this section ({sec.slides.length})
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            autoFocus
            onClick={() =>
              run(() => {
                const all = [...sec.slides, ...outside];
                updateSelection((cur) => [...cur, ...all.filter((x) => !cur.some((c) => c.id === x.id))]);
                toast(`Added ${plural(all.filter((x) => !selection.some((c) => c.id === x.id)).length, 'slide')}: the section and the rest of its pack`);
                announce('Added the section and the rest of its pack to the draft deck');
              })
            }
          >
            Add the section and the pack ({sec.slides.length + outside.length})
          </button>
        </>
      );
    } else if (d.kind === 'remove' && d.slide) {
      const slide = d.slide;
      title = 'Remove the whole pack?';
      body = (
        <>
          <p>
            This slide is part of a pack, and {plural(inDeck.length - 1, 'other slide')} from it {inDeck.length - 1 === 1 ? 'is' : 'are'} in your draft deck.
          </p>
          <PackStrip pack={pack} currentId={slide.id} onNavigate={closePackDialog} />
        </>
      );
      actions = (
        <>
          <button type="button" className="btn btn-ghost" onClick={closePackDialog}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => setOne(slide, false))}>
            Only this slide
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} autoFocus onClick={() => run(() => removePackFromDraft(pack))}>
            Remove all {inDeck.length}
          </button>
        </>
      );
    } else if (d.kind === 'ungroup') {
      title = pack.status === 'suggested' ? `Dismiss the suggested pack ${packName(pack)}?` : `Ungroup ${packName(pack)}?`;
      body = (
        <>
          <p>
            The {plural(total, 'slide')} stay in the library and in any draft deck. They just stop being offered together{pack.status === 'suggested' ? ', and the Storyboard stops pairing them' : ', in search and in the Storyboard'}.{' '}
            {pack.local ? 'This pack only exists in this browser.' : 'This changes it for everyone who uses SlideVault.'}
          </p>
          <PackStrip pack={pack} onNavigate={closePackDialog} />
        </>
      );
      actions = (
        <>
          <button type="button" className="btn btn-ghost" onClick={closePackDialog}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} autoFocus onClick={ungroup}>
            {pack.status === 'suggested' ? 'Dismiss suggestion' : 'Ungroup'}
          </button>
        </>
      );
    }
  }

  return (
    <dialog ref={ref} className="slidevault sv-dialog pack-dialog" data-theme={runtime.theme} aria-labelledby="sv-pack-title" onClose={closePackDialog} onClick={backdropClose(closePackDialog)}>
      <div className="dlg-head">
        <h2 id="sv-pack-title">{title}</h2>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={closePackDialog}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dlg-body">{body}</div>
      <div className="dlg-foot">{actions}</div>
    </dialog>
  );
}

/** On a slide's own page: its pack, the whole pack in one click, rename and ungroup. */
export function PackPanel({ slide, pack }: { slide: SlideSummary; pack: Pack }) {
  const { openPackDialog, renamePack, setPackStatus, toast, announce } = useWorkspace();
  const suggested = pack.status === 'suggested';
  const when = pack.confirmedAt ? new Date(pack.confirmedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(pack.label ?? '');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await renamePack(pack, name);
    setRenaming(false);
    toast('Pack renamed');
  };
  return (
    <section className="panel pack-panel" aria-labelledby="sv-pack-h">
      <h2 id="sv-pack-h">
        {pack.label ?? 'Part of a pack'}
        {pack.status === 'suggested' ? <span className="badge pack-sug">Suggested</span> : <span className="badge">Confirmed</span>}
        {pack.local && <span className="badge" title="Kept in this browser only until the server can store packs">This browser only</span>}
      </h2>
      <p className="meta">
        Slide {packPosition(pack, slide.id)} of {plural(pack.slideIds.length, 'slide')} that go together, in this order.
      </p>
      {!suggested && (
        <p className="meta pack-who" role="status">
          {`Confirmed${pack.confirmedBy ? ` by ${pack.confirmedBy}` : ''}${when ? ` · ${when}` : ''}`}
        </p>
      )}
      <PackStrip pack={pack} currentId={slide.id} />
      <div className="row-flex" style={{ marginTop: 10 }}>
        {suggested ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={async () => {
              await setPackStatus(pack, 'confirmed');
              announce('Pack confirmed');
            }}
          >
            <Icon name="check" />
            <span>Confirm this pack</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              await setPackStatus(pack, 'suggested');
              announce('Pack moved back to suggested');
            }}
          >
            <span>Unconfirm</span>
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => setRenaming((r) => !r)} aria-expanded={renaming}>
          <Icon name="pencil" />
          <span>Rename</span>
        </button>
        <button type="button" className="btn btn-sm" onClick={() => openPackDialog({ kind: 'ungroup', pack })}>
          <Icon name="x" />
          <span>{suggested ? 'Dismiss suggestion' : 'Ungroup'}</span>
        </button>
      </div>
      {renaming && (
        <form className="pack-rename" onSubmit={save}>
          <label className="sr-only" htmlFor="sv-pack-name">
            Pack name
          </label>
          <input id="sv-pack-name" type="text" value={name} maxLength={60} placeholder="Name this pack" onChange={(e) => setName(e.target.value)} autoComplete="off" data-autofocus />
          <button type="submit" className="btn btn-sm btn-primary">
            Save name
          </button>
        </form>
      )}
    </section>
  );
}

/** Group mode on a deck page: pick slides in the order they should go, name the pack, create it. */
export function GroupTool({ deckSlides, onDone }: { deckSlides: SlideSummary[]; onDone: () => void }) {
  const { packs, makePack, toast, announce } = useWorkspace();
  const [picked, setPicked] = useState<string[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (picked.length < 2 || busy) return;
    setBusy(true);
    try {
      const where = await makePack(picked, label);
      toast(where === 'saved' ? `Pack created: ${plural(picked.length, 'slide')}` : `Pack created in this browser: ${plural(picked.length, 'slide')}. The server does not store packs yet.`);
      announce('Pack created');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the pack. Nothing was changed.');
      setBusy(false);
    }
  };
  return (
    <>
      <p className="meta" style={{ marginTop: 12 }} role="status">
        Click the slides in the order they should go. A slide can be in one pack at a time.
      </p>
      <ul className="gt-grid">
        {deckSlides.map((s) => {
          const taken = packs.of(s.id);
          const n = picked.indexOf(s.id) + 1;
          return (
            <li key={s.id}>
              <button type="button" className={`gt-tile${n ? ' is-picked' : ''}`} aria-pressed={n > 0} disabled={!!taken} onClick={() => toggle(s.id)} aria-label={`${s.title}${taken ? ' (already in a pack)' : n ? `, number ${n} in the pack` : ''}`}>
                <span className="gt-t">
                  <Thumb slide={s} />
                  {n > 0 && (
                    <span className="gt-n" aria-hidden="true">
                      {n}
                    </span>
                  )}
                </span>
                <span className="gt-title">{s.title}</span>
                {taken && <span className="meta">In a pack</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <form className="gt-bar" onSubmit={create}>
        <label className="sr-only" htmlFor="sv-gt-name">
          Pack name
        </label>
        <input id="sv-gt-name" type="text" value={label} maxLength={60} placeholder="Name this pack (optional)" onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
        <span className="meta">{picked.length < 2 ? 'Pick at least 2 slides' : plural(picked.length, 'slide')}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={picked.length < 2 || busy}>
          Create pack
        </button>
      </form>
    </>
  );
}

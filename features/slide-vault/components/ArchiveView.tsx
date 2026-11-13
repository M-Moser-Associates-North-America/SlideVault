'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { listLibrary } from '../client/api';
import { Icon } from './icons';
import { groupDecks, folderLabel, plural, type Deck } from './library';
import { StateBlock, Thumb } from './parts';
import { useWorkspace } from './state';

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; decks: Deck[] };

/**
 * Archived decks (FD-50, FD-39): every deck that has been hidden from the library, search and AI, with a
 * Restore button on each. Opened from the profile menu. Nothing here is deleted. For the MVP anyone can restore.
 */
export function ArchiveView() {
  const { runtime, openArchiveDialog, archiveDialog, openPreview } = useWorkspace();
  const { request, onSessionExpired } = runtime;
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [tries, setTries] = useState(0);
  const [text, setText] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    listLibrary({ request, onSessionExpired }, controller.signal, { onlyArchived: true })
      // Only decks the server marked archived: a server that does not know the question sends everything back unmarked.
      .then((slides) => setLoaded({ status: 'ready', decks: groupDecks(slides.filter((s) => s.provenance.archived)).sort((a, b) => a.title.localeCompare(b.title)) }))
      .catch((e: Error) => e.name !== 'AbortError' && setLoaded({ status: 'error', message: e.message }));
    return () => controller.abort();
  }, [request, onSessionExpired, tries]);

  const shown = useMemo(() => {
    if (loaded.status !== 'ready') return [];
    const q = text.trim().toLowerCase();
    return q ? loaded.decks.filter((d) => [d.title, d.clientName, d.category, String(d.year ?? '')].some((v) => v?.toLowerCase().includes(q))) : loaded.decks;
  }, [loaded, text]);

  /* Restoring asks first, in the same pop-up as archiving; when it closes the list is read again. */
  const restore = (deck: Deck) => openArchiveDialog({ deck: { id: deck.id, title: deck.title, slideCount: deck.slides.length }, restore: true });
  const dialogWas = useRef(false);
  useEffect(() => {
    if (dialogWas.current && !archiveDialog) setTries((n) => n + 1);
    dialogWas.current = !!archiveDialog;
  }, [archiveDialog]);

  return (
    <div className="sv-wrap arch-page">
      <div className="page-head">
        <div>
          <h1 className="h1" tabIndex={-1}>
            Archived decks
          </h1>
          <p className="lede">Hidden, not deleted. Restore a deck to bring it back.</p>
          {loaded.status === 'ready' && loaded.decks.length > 0 && (
            <p className="arch-count" role="status">
              {text.trim() ? `${shown.length} of ${plural(loaded.decks.length, 'archived deck')} match “${text.trim()}”.` : `${plural(loaded.decks.length, 'archived deck')}.`}
            </p>
          )}
        </div>
      </div>

      {loaded.status === 'loading' && <div className="skel" style={{ height: 120 }} aria-hidden="true" />}
      {loaded.status === 'error' && (
        <StateBlock icon="alert" title="Could not load archived decks" text={loaded.message} error>
          <button type="button" className="btn" onClick={() => setTries((n) => n + 1)}>
            Try again
          </button>
        </StateBlock>
      )}
      {loaded.status === 'ready' && loaded.decks.length === 0 && <StateBlock icon="folder" title="Nothing is archived" text="Decks you archive show up here, ready to restore." />}
      {loaded.status === 'ready' && loaded.decks.length > 0 && (
        <>
          <div className="arch-tools">
            <label className="arch-find">
              <Icon name="search" />
              <span className="sr-only">Find an archived deck</span>
              <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Find an archived deck" autoComplete="off" />
            </label>
          </div>
          <ul className="arch-rows">
            {shown.map((d) => (
              <li key={d.id} className="arch-row">
                <button type="button" className="arch-mosaic" aria-label={`Preview the slides of ${d.title}`} onClick={() => openPreview(d.slides, 0)}>
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i}>{d.slides[i] ? <Thumb slide={d.slides[i]} /> : null}</span>
                  ))}
                </button>
                <div className="arch-info">
                  <h2 className="arch-title">{d.title}</h2>
                  <p className="meta">
                    {[d.clientName, d.year, d.category].filter((x) => x !== null && x !== '').join(' · ')}
                    {' · '}
                    {plural(d.slides.length, 'slide')}
                  </p>
                  <p className="meta">
                    <Icon name="folder" className="ic-sm" /> {folderLabel(d)}
                  </p>
                </div>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => restore(d)} aria-label={`Restore deck: ${d.title}`}>
                  <Icon name="refresh" />
                  <span>Restore</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

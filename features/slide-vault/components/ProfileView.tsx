'use client';

import { ScrollRow } from './scroll-row';
import { Button, buttonClass } from './ui/Button';
import { useEffect, useRef, useState } from 'react';
import { firstNameOf } from '../client/first-name';
import { Icon } from './icons';
import { timeAgo } from './library';
import { Link, SlideCard, StateBlock } from './parts';
import { ConfirmDialog } from './TagBits';
import { useAccount, useDraft, useLibrary, useNotify } from './state';

/**
 * Profile page: the person's saved slides and their own recent activity (kept on the server when
 * there is a database, FD-18). Kept deliberately small: a proposal library for a few hundred people
 * needs this to be simple, not a second app. Who is signed in comes from the placeholder sign-in.
 */
export function ProfileView() {
  const { library } = useLibrary();
  const { drafts, loadDraft, deleteDraft, selection } = useDraft();
  const { toast } = useNotify();
  const { profile, savedIds } = useAccount();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /* Arriving from the account menu's "Saved" item: scroll to the Saved section once the page is up. */
  useEffect(() => {
    if (window.location.hash !== '#saved') return;
    const t = setTimeout(() => document.getElementById('saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => clearTimeout(t);
  }, []);
  const saved = library.status === 'ready' ? library.slides.filter((s) => savedIds.has(s.id)) : [];

  return (
    <div className="sv-wrap profile-wrap">
      <div className="page-head">
        <div>
          <h1 className="h1" tabIndex={-1}>
            My decks
          </h1>
          <p className="lede">Signed in as {firstNameOf(profile) || profile}.</p>
        </div>
      </div>

      <section className="row" id="saved">
        <div className="row-head">
          <h2 className="h2">Saved</h2>
        </div>
        {saved.length === 0 ? (
          <StateBlock icon="heart" title="No saved slides yet" text="Tap the heart on any slide to keep it here.">
            <Link className={buttonClass()} to={{ view: 'pages' }}>
              Browse slides
            </Link>
          </StateBlock>
        ) : (
          <ScrollRow as="ul" className="row-scroller">
            {saved.map((s) => (
              <li key={s.id}>
                <SlideCard slide={s} list={saved} />
              </li>
            ))}
          </ScrollRow>
        )}
      </section>

      <section className="row" id="drafts">
        <div className="row-head">
          <h2 className="h2">Working drafts</h2>
        </div>
        {drafts.length === 0 ? (
          <StateBlock icon="layers" title="No working drafts yet" text="Save your draft deck to come back to it later.">
            <Link className={buttonClass()} to={{ view: 'pages' }}>
              Browse slides
            </Link>
          </StateBlock>
        ) : (
          <ul className="draft-list">
            {drafts.map((d) => (
              <DraftRow
                key={d.id}
                name={d.name}
                meta={`${d.slideIds.length === 1 ? '1 slide' : `${d.slideIds.length} slides`} · saved ${timeAgo(d.savedAt)}`}
                title={selection.length ? 'Replaces what is in your draft deck now' : undefined}
                onOpen={() => {
                  const found = loadDraft(d);
                  toast(found === d.slideIds.length ? `Opened “${d.name}” in your draft deck` : `Opened “${d.name}”. ${d.slideIds.length - found} slide(s) are no longer in the library.`);
                }}
                onAskDelete={() => setConfirmDelete(d.id)}
              />
            ))}
          </ul>
        )}
      </section>
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete this draft?"
        kind="Working draft"
        subject={drafts.find((d) => d.id === confirmDelete)?.name ?? ''}
        lead="It will be removed from My decks. The slides themselves stay in the library."
        confirmLabel="Delete draft"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const d = drafts.find((x) => x.id === confirmDelete);
          if (d) {
            deleteDraft(d.id);
            toast(`Deleted “${d.name}”`);
          }
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}

/** One working draft. On a phone, swiping it to the left asks to delete it (the Delete button does the same). */
function DraftRow({ name, meta, title, onOpen, onAskDelete }: { name: string; meta: string; title?: string; onOpen: () => void; onAskDelete: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);
  const LIMIT = 96;
  return (
    <li
      className="draft-item"
      data-swiping={dx < 0 ? 'true' : undefined}
      style={dx ? { transform: `translateX(${dx}px)`, transition: 'none' } : undefined}
      onTouchStart={(e) => {
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchMove={(e) => {
        const s = start.current;
        if (!s) return;
        const mx = e.touches[0].clientX - s.x;
        const my = e.touches[0].clientY - s.y;
        if (Math.abs(my) > Math.abs(mx) + 6) {
          start.current = null; /* a scroll, not a swipe */
          setDx(0);
          return;
        }
        setDx(Math.max(-140, Math.min(0, mx)));
      }}
      onTouchEnd={() => {
        const passed = dx <= -LIMIT;
        start.current = null;
        setDx(0);
        if (passed) onAskDelete();
      }}
      onTouchCancel={() => {
        start.current = null;
        setDx(0);
      }}
    >
      <span className="draft-ic" aria-hidden="true">
        <Icon name="folder" />
      </span>
      <div className="draft-txt">
        <strong>{name}</strong>
        <span className="meta">{meta}</span>
      </div>
      <div className="draft-acts">
        <Button size="sm" title={title} onClick={onOpen}>
          Open in draft deck
        </Button>
        <Button variant="ghost" size="sm" onClick={onAskDelete}>
          Delete
        </Button>
      </div>
    </li>
  );
}

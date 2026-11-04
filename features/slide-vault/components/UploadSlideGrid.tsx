'use client';

import { useState } from 'react';
import type { PreviewSlide } from '../client/pptx-preview';
import { Icon } from './icons';
import { plural } from './library';
import type { TagSuggestion } from './TagField';
import { AddTagPill, LocalTagList } from './TagBits';
import type { TagSuggestionItem } from '../client/api';

const PAGE = 60;

export type SlideTags = Record<number, string[]>;

/** The slide's text without its title repeated at the start. */
const bodyOf = (s: PreviewSlide) => (s.text.startsWith(s.title) ? s.text.slice(s.title.length) : s.text).replace(/\s+/g, ' ').trim();

/** How many tags are on slides, and on how many slides. */
export function slideTagTotals(tags: SlideTags) {
  const lists = Object.values(tags).filter((t) => t.length > 0);
  return { tags: lists.reduce((n, t) => n + t.length, 0), slides: lists.length };
}

/**
 * The slides of the deck being uploaded, one card each, so each can be tagged before anything is sent.
 * Pictures come from the server after the upload, so a grey placeholder stands in for them here.
 */
export function UploadSlideGrid({
  slides,
  tags,
  onTags,
  suggestions,
  autoTags = {},
  suggested,
  disabled,
  pictures,
  drawing,
  deckTags = [],
}: {
  /** Tags suggested per slide number from similar library slides (FD-82), once the server has them */
  suggested?: Record<string, TagSuggestionItem[]>;
  /** The deck's own tags (set above the grid): shown on every card, since they apply to every slide */
  deckTags?: string[];
  /** Slide number -> picture address, once the server has drawn them */
  pictures?: Record<number, string>;
  /** The server is still drawing the pictures */
  drawing?: boolean;
  slides: PreviewSlide[];
  tags: SlideTags;
  onTags: (next: SlideTags) => void;
  suggestions: TagSuggestion[];
  disabled?: boolean;
  /** Slide tags filled in for the person, by slide number: marked on the card */
  autoTags?: Record<number, string[]>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const visible = slides.slice(0, shown);
  const allOn = selected.size === slides.length;
  /* A picture that fails to load falls back to the grey placeholder, so a card is never blank. */
  const [broken, setBroken] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState<Set<number>>(new Set());

  const toggle = (n: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const setOne = (n: number, list: string[]) => onTags({ ...tags, [n]: list });
  /* One tag onto every ticked slide, ignoring capital letters, up to the same limit as one slide. */
  const addToSelected = (tag: string) => {
    const next = { ...tags };
    for (const n of selected) {
      const have = next[n] ?? [];
      if (!have.some((t) => t.toLowerCase() === tag.toLowerCase())) next[n] = [...have, tag];
    }
    onTags(next);
  };

  return (
    <section className="upgrid" aria-labelledby="upgrid-h">
      <div className="upgrid-head">
        <div>
          <h2 id="upgrid-h" className="h2">
            Slides in this deck
          </h2>
          <p className="meta">
            {plural(slides.length, 'slide')}.{' '}
            <span aria-live="polite">
            {pictures
              ? 'The pictures are a preview, kept for a couple of hours; nothing is saved until you upload.'
              : drawing
                ? 'Drawing the slide pictures…'
                : 'Pictures are not available for this file, so each card shows the slide’s title and text. They appear after the upload.'}
            </span>
          </p>
        </div>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setSelected(allOn ? new Set() : new Set(slides.map((s) => s.number)))}>
          {allOn ? 'Clear selection' : 'Select all'}
        </button>
      </div>

      {selected.size > 0 && (
        <div className="upgrid-bulk" role="group" aria-label="Tag the selected slides">
          <strong>{plural(selected.size, 'slide')} selected</strong>
          <div className="upgrid-bulk-field">
            <AddTagPill label={`Add a tag to ${plural(selected.size, 'selected slide')}`} known={suggestions} have={[]} disabled={disabled} onAdd={addToSelected} />
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Done
          </button>
        </div>
      )}

      <ul className="upgrid-list">
        {visible.map((s) => (
          <li key={s.number} className={`upcard${selected.has(s.number) ? ' is-selected' : ''}${s.hidden ? ' is-hidden' : ''}`}>
            <div className="upcard-thumb" aria-hidden="true">
              {(() => {
                const pic = pictures?.[s.number];
                const showPic = !!pic && !broken.has(s.number);
                return (
                  <>
                    {showPic && (
                      // eslint-disable-next-line @next/next/no-img-element -- a temporary preview served by our own API, not an optimizable asset
                      <img className={loaded.has(s.number) ? 'is-loaded' : undefined} src={pic} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded((l) => new Set(l).add(s.number))} onError={() => setBroken((b) => new Set(b).add(s.number))} />
                    )}
                    {drawing || (showPic && !loaded.has(s.number)) ? <Icon name="spinner" className="spin" /> : !showPic ? <Icon name={s.hidden ? 'eyeOff' : 'layers'} /> : null}
                  </>
                );
              })()}
              <span className="upcard-num">{s.number}</span>
            </div>
            <label className="upcard-pick">
              <input type="checkbox" checked={selected.has(s.number)} disabled={disabled} onChange={() => toggle(s.number)} />
              <span className="sr-only">Select slide {s.number}: {s.title}</span>
            </label>
            <div className="upcard-body">
              <h3 className="upcard-title">{s.title}</h3>
              {s.hidden && <span className="badge">Hidden in the file</span>}
              {bodyOf(s) && <p className="upcard-text">{bodyOf(s)}</p>}
              <LocalTagList auto={autoTags[s.number]} label={`Tags for slide ${s.number}`} value={tags[s.number] ?? []} onChange={(list) => setOne(s.number, list)} inherited={deckTags} inheritedTip="Applies to the whole deck (set above)" suggestions={suggestions} suggested={suggested?.[String(s.number)]} disabled={disabled} />
            </div>
          </li>
        ))}
      </ul>
      {shown < slides.length && (
        <button type="button" className="btn upgrid-more" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, slides.length - shown)} more slides
        </button>
      )}
    </section>
  );
}

'use client';

import { useState } from 'react';
import type { PreviewSlide } from '../client/pptx-preview';
import { Icon } from './icons';
import { plural } from './library';
import { TagField, type TagSuggestion } from './TagField';

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
  disabled,
}: {
  slides: PreviewSlide[];
  tags: SlideTags;
  onTags: (next: SlideTags) => void;
  suggestions: TagSuggestion[];
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const visible = slides.slice(0, shown);
  const allOn = selected.size === slides.length;

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
            {plural(slides.length, 'slide')}. Tag any that need it, or skip this and tag later. Pictures appear after the upload; for now each card shows the slide&rsquo;s title and text.
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
            <TagField compact label={`Add a tag to ${plural(selected.size, 'selected slide')}`} value={[]} onChange={(next) => next[0] && addToSelected(next[0])} suggestions={suggestions} disabled={disabled} />
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
              <Icon name={s.hidden ? 'eyeOff' : 'layers'} />
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
              <TagField compact label={`Tags for slide ${s.number}`} value={tags[s.number] ?? []} onChange={(list) => setOne(s.number, list)} suggestions={suggestions} disabled={disabled} />
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

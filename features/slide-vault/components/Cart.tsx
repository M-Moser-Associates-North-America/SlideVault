'use client';

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Icon } from './icons';
import { downloadPlan, plural, planSummary } from './library';
import { Link, Thumb } from './parts';
import { useWorkspace } from './state';

/**
 * The cart: slides ticked anywhere on the site, in the order they will download.
 * Collapsed to a thin rail by default; opens by itself the first time a slide is added.
 */
export function Cart() {
  const { selection, updateSelection, excluded, setIncluded, setCartMin, openDownload, openPreview, announce } = useWorkspace();
  const n = selection.length;
  const included = selection.filter((s) => !excluded.has(s.id));
  const plan = downloadPlan(included);

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

  const move = (id: string, to: number) => {
    updateSelection((cur) => {
      const item = cur.find((s) => s.id === id);
      if (!item) return cur;
      const order = cur.filter((s) => s.id !== id);
      order.splice(Math.max(0, Math.min(order.length, to)), 0, item);
      return order;
    });
    announce(`${selection.find((s) => s.id === id)?.title ?? 'Slide'} moved to position ${Math.max(1, Math.min(n, to + 1))} of ${n}`);
  };

  /** Where would a drop at pointer height y land? Index among the other items, plus which line to draw. */
  const dropAt = (y: number): { index: number; id: string | null; after: boolean } => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('.ci') ?? [])].filter((li) => li.dataset.id !== dragId);
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

  const onDragOver = (e: DragEvent) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const d = dropAt(e.clientY);
    setMark(d.id ? { id: d.id, after: d.after } : null);
  };
  const onDrop = (e: DragEvent) => {
    if (!dragId) return;
    e.preventDefault();
    const id = dragId;
    const d = dropAt(e.clientY);
    setDragId(null);
    setMark(null);
    focusGrip.current = id;
    move(id, d.index);
  };

  const onGripKey = (e: KeyboardEvent, id: string, i: number) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (to < 0 || to >= n) return;
    focusGrip.current = id;
    move(id, to);
  };

  const toggleButton = (
    <button type="button" className="btn btn-ghost btn-icon btn-sm cart-tg" aria-label="Collapse slide selection to a thin rail" onClick={() => setCartMin(true)}>
      <Icon name="right" />
    </button>
  );

  const mini = (
    <div className="cart-mini">
      <button type="button" className="mini-open" aria-label={`Expand slide selection, ${plural(n, 'slide')}`} onClick={() => setCartMin(false)}>
        <Icon name="left" />
        <span className="mini-ic" aria-hidden="true">
          <Icon name="cart" />
          {n > 0 && <span className="mini-n">{n}</span>}
        </span>
        <span className="mini-t">Slide selection</span>
      </button>
      {included.length > 0 && (
        <button
          type="button"
          className="btn btn-primary btn-icon btn-sm"
          aria-label={`Download ${plural(included.length, 'slide')} as pptx`}
          onClick={() => openDownload(included)}
        >
          <Icon name="download" />
        </button>
      )}
    </div>
  );

  if (!n) {
    return (
      <>
        <div className="cart cart-empty">
          <div className="cart-top">
            <h2 className="cart-h">Slide selection</h2>
            <span className="cart-tools">{toggleButton}</span>
          </div>
          <div className="cart-empty-body">
            <span className="ce-ic" aria-hidden="true">
              <Icon name="cart" />
            </span>
            <p className="ce-t">Your slide selection is empty</p>
            <p className="meta">Hover over any slide and click + Add. You can download them together from here.</p>
          </div>
        </div>
        {mini}
      </>
    );
  }

  const none = included.length === 0;
  return (
    <>
      <div className="cart" role="region" aria-label="Slide selection">
        <div className="cart-top">
          <h2 className="cart-h">
            Slide selection<span className="count">{n}</span>
          </h2>
          <span className="cart-tools">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateSelection(() => [])}>
              Clear
            </button>
            {toggleButton}
          </span>
        </div>
        <ul
          ref={listRef}
          className="cart-items"
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setMark(null)}
        >
          {selection.map((s, i) => {
            const off = excluded.has(s.id);
            const cls = ['ci', off ? 'off' : '', dragId === s.id ? 'dragging' : '', mark?.id === s.id ? (mark.after ? 'drop-after' : 'drop-before') : ''].filter(Boolean).join(' ');
            return (
              <li
                key={s.id}
                className={cls}
                draggable
                data-id={s.id}
                onDragStart={(e) => {
                  setDragId(s.id);
                  e.dataTransfer.effectAllowed = 'move';
                  try {
                    e.dataTransfer.setData('text/plain', s.id);
                  } catch {
                    /* some browsers refuse; the drag still works from state */
                  }
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setMark(null);
                }}
              >
                <button
                  type="button"
                  className="grip"
                  data-id={s.id}
                  title="Drag to reorder"
                  aria-label={`Reorder: ${s.title}, position ${i + 1} of ${n}. Press up or down arrow to move.`}
                  onKeyDown={(e) => onGripKey(e, s.id, i)}
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
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove from slide selection: ${s.title}`} onClick={() => updateSelection((cur) => cur.filter((x) => x.id !== s.id))}>
                  <Icon name="x" />
                </button>
              </li>
            );
          })}
        </ul>
        {n > 1 && <p className="ci-hint">Drag to reorder. Slides download in this order.</p>}
        <p className="txt">
          <strong>
            {included.length} of {plural(n, 'slide')}
          </strong>{' '}
          in the download
          {included.length ? ` · ${plural(plan.files.length, 'deck')}. Downloads as ${planSummary(plan)}.` : '.'}
        </p>
        {plan.zip && (
          <div className="cart-zip">
            <span className="tipw">
              <button type="button" className="btn btn-sm" aria-disabled="true" aria-describedby="cart-combine-note" onClick={(e) => e.preventDefault()}>
                <Icon name="layers" />
                <span>Combine into one deck</span>
              </button>
              <span className="tip tip-start" aria-hidden="true">
                Coming later
              </span>
            </span>
            <span id="cart-combine-note" className="sr-only">
              Not available yet. Combining slides from different decks into one file is planned for a later phase.
            </span>
          </div>
        )}
        <div className="cart-acts">
          <button type="button" className="btn btn-sm" disabled={none} title={none ? 'Tick at least one slide in your slide selection.' : undefined} onClick={() => openPreview(included, 0)}>
            <Icon name="eye" />
            <span>Preview</span>
          </button>
          <button type="button" className="btn btn-sm btn-primary" disabled={none} title={none ? 'Tick at least one slide in your slide selection.' : undefined} onClick={() => openDownload(included)}>
            <Icon name="download" />
            <span>Download as pptx</span>
          </button>
        </div>
      </div>
      {mini}
    </>
  );
}

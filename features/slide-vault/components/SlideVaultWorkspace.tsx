'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Library, SlideRecord } from '../types';
import { useSelection } from './selection-store';
import styles from './workspace.module.css';

export type SlideVaultWorkspaceProps = {
  library: Library;
  /** Where the export request is sent; injected so a host app can route it elsewhere. */
  exportEndpoint: string;
};

type ExportState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string } | { kind: 'done'; count: number };


function matches(slide: SlideRecord, words: string[]) {
  const hay = `${slide.title}\n${slide.text}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function SlideVaultWorkspace({ library, exportEndpoint }: SlideVaultWorkspaceProps) {
  const byNumber = useMemo(() => new Map(library.slides.map((s) => [s.number, s])), [library]);
  const [query, setQuery] = useState('');
  // Kept across reloads in this browser; numbers no longer in the library are ignored.
  const [selection, updateSelection] = useSelection((n) => byNumber.has(n));
  const setSelection = (next: number[] | ((cur: number[]) => number[])) =>
    updateSelection((cur) => (typeof next === 'function' ? next(cur) : next));
  const [previewNumber, setPreviewNumber] = useState<number | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = words.length ? library.slides.filter((s) => matches(s, words)) : library.slides;
  const isSelected = (n: number) => selection.includes(n);

  const toggle = (n: number) => {
    setExportState({ kind: 'idle' });
    setSelection((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  };
  const move = (index: number, delta: -1 | 1) =>
    setSelection((cur) => {
      const next = [...cur];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });

  async function exportDeck() {
    setExportState({ kind: 'busy' });
    try {
      const res = await fetch(exportEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slideNumbers: selection }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Export failed (${res.status}).`);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'SlideVault-export.pptx';
      a.click();
      URL.revokeObjectURL(url);
      setExportState({ kind: 'done', count: selection.length });
    } catch (e) {
      setExportState({
        kind: 'error',
        message: e instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : (e as Error).message,
      });
    }
  }

  const preview = previewNumber ? byNumber.get(previewNumber) : undefined;

  return (
    <div className={styles.workspace}>
      <main className={styles.main}>
        <div className={styles.intro}>
          <div>
            <h1 className={styles.heading}>Slide library</h1>
            <p className={styles.lead}>
              {library.deck.slideCount} slides from {library.deck.fileName}
              {library.deck.hiddenCount ? ` · ${library.deck.hiddenCount} hidden in the source` : ''}
            </p>
          </div>
          <div className={styles.search}>
            <label htmlFor="sv-search" className={styles.label}>
              Search slides
            </label>
            <input
              id="sv-search"
              type="search"
              className={styles.input}
              placeholder="Titles and slide text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <p className={styles.count} aria-live="polite">
          {results.length} {results.length === 1 ? 'result' : 'results'}
          {words.length ? ` for “${query.trim()}”` : ''}
        </p>

        {results.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No slides match “{query.trim()}”</p>
            <p>Search looks for every word in slide titles and text. Try fewer or different words.</p>
            <button type="button" className={styles.secondary} onClick={() => setQuery('')}>
              Clear search
            </button>
          </div>
        ) : (
          <ul className={styles.grid}>
            {results.map((s) => (
              <li key={s.number} className={`${styles.card} ${isSelected(s.number) ? styles.cardSelected : ''}`}>
                <button type="button" className={styles.thumbButton} onClick={() => setPreviewNumber(s.number)} aria-label={`Preview slide ${s.number}: ${s.title}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- static pre-rendered thumbnails */}
                  <img src={s.preview} alt="" className={styles.thumb} loading="lazy" />
                  {s.hidden && <span className={styles.badge}>Hidden in source</span>}
                </button>
                <div className={styles.cardBody}>
                  <p className={styles.meta}>Slide {s.number}</p>
                  <h2 className={styles.cardTitle}>{s.title}</h2>
                  <div className={styles.actions}>
                    <button type="button" className={styles.secondary} onClick={() => setPreviewNumber(s.number)}>
                      Preview
                    </button>
                    <button
                      type="button"
                      className={isSelected(s.number) ? styles.secondary : styles.primary}
                      aria-pressed={isSelected(s.number)}
                      onClick={() => toggle(s.number)}
                    >
                      {isSelected(s.number) ? 'Remove' : 'Select'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      <aside className={styles.panel} aria-labelledby="sv-selection-heading">
        <div className={styles.panelHead}>
          <h2 id="sv-selection-heading" className={styles.panelTitle}>
            Selection <span className={styles.pill}>{selection.length}</span>
          </h2>
          {selection.length > 0 && (
            <button type="button" className={styles.link} onClick={() => setSelection([])}>
              Clear
            </button>
          )}
        </div>

        {selection.length === 0 ? (
          <p className={styles.panelEmpty}>Select slides from the library. Their order here becomes the order of the exported PowerPoint.</p>
        ) : (
          <ol className={styles.selectionList}>
            {selection.map((n, i) => {
              const s = byNumber.get(n)!;
              return (
                <li key={n} className={styles.selectionItem}>
                  <span className={styles.position}>{i + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.preview} alt="" className={styles.miniThumb} />
                  <span className={styles.selectionText}>
                    <span className={styles.selectionTitle}>{s.title}</span>
                    <span className={styles.meta}>Slide {s.number}</span>
                  </span>
                  <span className={styles.reorder}>
                    <button type="button" className={styles.icon} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move slide ${n} up`}>
                      ↑
                    </button>
                    <button type="button" className={styles.icon} disabled={i === selection.length - 1} onClick={() => move(i, 1)} aria-label={`Move slide ${n} down`}>
                      ↓
                    </button>
                    <button type="button" className={styles.icon} onClick={() => toggle(n)} aria-label={`Remove slide ${n} from selection`}>
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <button
          type="button"
          className={`${styles.primary} ${styles.exportButton}`}
          disabled={selection.length === 0 || exportState.kind === 'busy'}
          aria-busy={exportState.kind === 'busy'}
          onClick={exportDeck}
        >
          {exportState.kind === 'busy' ? 'Building PowerPoint…' : 'Export editable PowerPoint'}
        </button>
        <div aria-live="polite">
          {exportState.kind === 'done' && (
            <p className={styles.success}>
              Downloaded SlideVault-export.pptx with {exportState.count} {exportState.count === 1 ? 'slide' : 'slides'}.
            </p>
          )}
        </div>
        {exportState.kind === 'error' && (
          <p className={styles.error} role="alert">
            {exportState.message} Your selection is unchanged.
          </p>
        )}
        <p className={styles.note}>
          The file contains only the slides listed here, in this order, as editable PowerPoint. The source deck is never changed. Speaker notes and review comments are left out.
        </p>
      </aside>

      <PreviewDialog
        slide={preview}
        deckName={library.deck.fileName}
        selected={preview ? isSelected(preview.number) : false}
        onToggle={() => preview && toggle(preview.number)}
        onClose={() => setPreviewNumber(null)}
      />
    </div>
  );
}

function PreviewDialog({
  slide,
  deckName,
  selected,
  onToggle,
  onClose,
}: {
  slide: SlideRecord | undefined;
  deckName: string;
  selected: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (slide && !d.open) d.showModal(); // native modal: Escape closes, focus is contained and returned
    if (!slide && d.open) d.close();
  }, [slide]);

  return (
    <dialog
      ref={ref}
      className={`slidevault ${styles.dialog}`}
      data-theme="light"
      aria-labelledby="sv-preview-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {slide && (
        <div className={styles.dialogInner}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide.preview} alt={`Slide ${slide.number}: ${slide.title}`} className={styles.dialogImage} />
          <div className={styles.dialogSide}>
            <div className={styles.dialogTop}>
              <p className={styles.meta}>
                {deckName} · Slide {slide.number}
                {slide.hidden ? ' · hidden in source' : ''}
              </p>
              <button type="button" className={styles.icon} onClick={onClose} aria-label="Close preview">
                ×
              </button>
            </div>
            <h2 id="sv-preview-title" className={styles.dialogTitle}>
              {slide.title}
            </h2>
            <dl className={styles.trust}>
              <dt>Source</dt>
              <dd>
                {deckName}, slide {slide.number}
              </dd>
              <dt>Version</dt>
              <dd>Imported copy (v1)</dd>
              <dt>Owner</dt>
              <dd className={styles.unknown}>Unknown</dd>
              <dt>Approval</dt>
              <dd className={styles.unknown}>Not reviewed</dd>
              <dt>Last reviewed</dt>
              <dd className={styles.unknown}>Unknown</dd>
            </dl>
            <h3 className={styles.label}>Slide text</h3>
            <div className={styles.slideText}>{slide.text || 'This slide has no text.'}</div>
            <button type="button" className={selected ? styles.secondary : styles.primary} onClick={onToggle}>
              {selected ? 'Remove from selection' : 'Add to selection'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { searchSlides } from '../client/api';
import { useSelection } from '../client/selection-store';
import type { SlideSummary } from '../contracts/dto';
import type { SlideVaultRuntime } from '../contracts/runtime';
import { PreviewDialog } from './PreviewDialog';
import { SelectionPanel } from './SelectionPanel';
import styles from './workspace.module.css';

type Results = { status: 'loading' } | { status: 'ready'; slides: SlideSummary[] } | { status: 'error'; message: string };

const SEARCH_DELAY_MS = 200;

/** Slide-level search, results, preview and the ordered selection ("Pages" in the mockup). */
export function PagesView({ runtime, previewSlideId }: { runtime: SlideVaultRuntime; previewSlideId?: string }) {
  const [query, setQuery] = useState('');
  const { request, onSessionExpired } = runtime;
  const transport = useMemo(() => ({ request, onSessionExpired }), [request, onSessionExpired]);
  const [results, setResults] = useState<Results>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0); // bump to retry after an error
  const [selection, updateSelection] = useSelection(runtime.sessionScopeKey);

  // Search on the server; a short pause after typing avoids a request per keystroke.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchSlides(transport, query, controller.signal)
        .then((slides) => setResults({ status: 'ready', slides }))
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setResults({ status: 'error', message: e.message });
        });
    }, query ? SEARCH_DELAY_MS : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [transport, query, attempt]);

  const isSelected = (id: string) => selection.some((s) => s.id === id);
  const toggle = ({ id, title, hiddenInSource, previewPath, provenance }: SlideSummary) =>
    updateSelection((cur) =>
      cur.some((s) => s.id === id) ? cur.filter((s) => s.id !== id) : [...cur, { id, title, hiddenInSource, previewPath, provenance }],
    );
  const openPreview = (id: string) => runtime.navigate({ view: 'slide', id });
  const closePreview = () => runtime.navigate({ view: 'pages' }, { replace: true });
  const trimmed = query.trim();

  return (
    <div className={styles.workspace}>
      <main className={styles.main}>
        <div className={styles.intro}>
          <div>
            <h1 className={styles.heading}>Slides</h1>
            <p className={styles.lead}>Search every slide in the library and assemble an editable PowerPoint.</p>
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
              onChange={(e) => {
                setQuery(e.target.value);
                setResults({ status: 'loading' });
              }}
            />
          </div>
        </div>

        <p className={styles.count} aria-live="polite">
          {results.status === 'ready' &&
            `${results.slides.length} ${results.slides.length === 1 ? 'result' : 'results'}${trimmed ? ` for “${trimmed}”` : ''}`}
          {results.status === 'loading' && 'Searching…'}
        </p>

        {results.status === 'error' && (
          <div className={styles.empty} role="alert">
            <p className={styles.emptyTitle}>The library could not be loaded</p>
            <p>{results.message}</p>
            <button type="button" className={styles.secondary} onClick={() => { setResults({ status: 'loading' }); setAttempt((n) => n + 1); }}>
              Try again
            </button>
          </div>
        )}

        {results.status === 'ready' && results.slides.length === 0 && (
          <div className={styles.empty}>
            {trimmed ? (
              <>
                <p className={styles.emptyTitle}>No slides match “{trimmed}”</p>
                <p>Every word must appear in a slide’s title or text. Try fewer or different words.</p>
                <button type="button" className={styles.secondary} onClick={() => setQuery('')}>
                  Clear search
                </button>
              </>
            ) : (
              <>
                <p className={styles.emptyTitle}>The library is empty</p>
                <p>No decks have been added yet.</p>
              </>
            )}
          </div>
        )}

        {results.status === 'ready' && results.slides.length > 0 && (
          <ul className={styles.grid}>
            {results.slides.map((s) => (
              <li key={s.id} className={`${styles.card} ${isSelected(s.id) ? styles.cardSelected : ''}`}>
                <button type="button" className={styles.thumbButton} onClick={() => openPreview(s.id)} aria-label={`Preview: ${s.title}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- previews come from the injected API, not next/image */}
                  <img src={runtime.assetUrl(s.previewPath)} alt="" className={styles.thumb} loading="lazy" />
                  {s.hiddenInSource && <span className={styles.badge}>Hidden in source</span>}
                </button>
                <div className={styles.cardBody}>
                  <p className={styles.meta}>
                    {s.provenance.sourceTitle} · slide {s.provenance.slideNumber}
                  </p>
                  <h2 className={styles.cardTitle}>{s.title}</h2>
                  {s.alsoIn && (
                    <p className={styles.alsoIn} title={s.alsoIn.match === 'near' ? 'A nearly identical slide is in other decks' : 'The same slide is in other decks'}>
                      Also in {s.alsoIn.otherDeckCount} {s.alsoIn.otherDeckCount === 1 ? 'other deck' : 'other decks'}
                    </p>
                  )}
                  <div className={styles.actions}>
                    <button type="button" className={styles.secondary} onClick={() => openPreview(s.id)}>
                      Preview
                    </button>
                    <button
                      type="button"
                      className={isSelected(s.id) ? styles.secondary : styles.primary}
                      aria-pressed={isSelected(s.id)}
                      onClick={() => toggle(s)}
                    >
                      {isSelected(s.id) ? 'Remove' : 'Select'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      <SelectionPanel runtime={runtime} selection={selection} updateSelection={updateSelection} />

      <PreviewDialog
        runtime={runtime}
        slideId={previewSlideId}
        isSelected={previewSlideId ? isSelected(previewSlideId) : false}
        onToggle={toggle}
        onClose={closePreview}
      />
    </div>
  );
}

'use client';

import { useId, useState } from 'react';
import { uploadDeck } from '../client/api';
import type { DeckSummary, UploadDeckMeta } from '../contracts/dto';
import type { SlideVaultRuntime } from '../contracts/runtime';
import styles from './workspace.module.css';

type UploadState = { kind: 'idle' } | { kind: 'uploading' } | { kind: 'error'; message: string } | { kind: 'done'; deck: DeckSummary };

/** Upload screen (docs/foundry/SLIDE_RECORD.md): a .pptx goes in, gets split into slides, and shows up in the library. */
export function UploadView({ runtime }: { runtime: SlideVaultRuntime }) {
  const [file, setFile] = useState<File | null>(null);
  const [clientName, setClientName] = useState('');
  const [deckYear, setDeckYear] = useState('');
  const [category, setCategory] = useState('');
  const [bestOfTheBest, setBestOfTheBest] = useState(false);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const fieldId = useId();
  const canUpload = runtime.capabilities.has('source.upload');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setState({ kind: 'uploading' });
    const meta: UploadDeckMeta = {
      clientName: clientName.trim() || null,
      deckYear: deckYear.trim() ? Number(deckYear) : null,
      category: category.trim() || null,
      folderPath: null,
      bestOfTheBest,
    };
    try {
      const deck = await uploadDeck(runtime, file, meta);
      setState({ kind: 'done', deck });
      setFile(null);
      setClientName('');
      setDeckYear('');
      setCategory('');
      setBestOfTheBest(false);
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  }

  if (!canUpload) {
    return (
      <div className={styles.workspace}>
        <main className={styles.main}>
          <h1 className={styles.heading}>Upload</h1>
          <p className={styles.lead}>You don&apos;t have permission to upload decks.</p>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.workspace}>
      <main className={styles.main}>
        <div className={styles.intro}>
          <div>
            <h1 className={styles.heading}>Upload a deck</h1>
            <p className={styles.lead}>A .pptx goes in unchanged, gets split into slides with thumbnails, and shows up in the library.</p>
          </div>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sv-space-5)', maxWidth: 480 }}>
          <div className={styles.field}>
            <label htmlFor={`${fieldId}-file`} className={styles.label}>
              PowerPoint file (.pptx)
            </label>
            <input
              id={`${fieldId}-file`}
              type="file"
              accept=".pptx"
              className={styles.input}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor={`${fieldId}-client`} className={styles.label}>
              Client
            </label>
            <input
              id={`${fieldId}-client`}
              type="text"
              className={styles.input}
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Harbor Bank"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor={`${fieldId}-year`} className={styles.label}>
              Year
            </label>
            <input
              id={`${fieldId}-year`}
              type="number"
              className={styles.input}
              value={deckYear}
              onChange={(e) => setDeckYear(e.target.value)}
              placeholder="e.g. 2026"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor={`${fieldId}-category`} className={styles.label}>
              Category
            </label>
            <input
              id={`${fieldId}-category`}
              type="text"
              className={styles.input}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Business Proposal"
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sv-space-2)', fontSize: 'var(--sv-text-small)' }}>
            <input type="checkbox" checked={bestOfTheBest} onChange={(e) => setBestOfTheBest(e.target.checked)} />
            This is from the Best of the Best folder
          </label>

          <button type="submit" className={styles.primary} disabled={!file || state.kind === 'uploading'} aria-busy={state.kind === 'uploading'}>
            {state.kind === 'uploading' ? 'Uploading…' : 'Upload deck'}
          </button>
        </form>

        <div aria-live="polite">
          {state.kind === 'done' && (
            <div className={styles.success} style={{ marginTop: 'var(--sv-space-5)' }}>
              <p>
                &ldquo;{state.deck.title}&rdquo; uploaded — {state.deck.slideCount} {state.deck.slideCount === 1 ? 'slide' : 'slides'} ready.
              </p>
              <button type="button" className={styles.secondary} onClick={() => runtime.navigate({ view: 'pages', query: state.deck.title })}>
                Go to the library
              </button>
            </div>
          )}
        </div>
        {state.kind === 'error' && (
          <p className={styles.error} role="alert" style={{ marginTop: 'var(--sv-space-5)' }}>
            {state.message}
          </p>
        )}
      </main>
    </div>
  );
}

'use client';

import { useId, useState, type FormEvent } from 'react';
import { uploadDeck } from '../client/api';
import type { DeckSummary, UploadDeckMeta } from '../contracts/dto';
import { Icon } from './icons';
import { Link } from './parts';
import { useWorkspace } from './state';

type UploadState = { kind: 'idle' } | { kind: 'uploading' } | { kind: 'error'; message: string } | { kind: 'done'; deck: DeckSummary };

/**
 * Upload screen (docs/foundry/SLIDE_RECORD.md): a .pptx goes in unchanged, gets split into slides,
 * and shows up in the library. Uses the real POST /uploads; the library reloads when it succeeds.
 */
export function UploadView() {
  const { runtime, reloadLibrary, announce } = useWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [clientName, setClientName] = useState('');
  const [deckYear, setDeckYear] = useState('');
  const [category, setCategory] = useState('');
  const [bestOfTheBest, setBestOfTheBest] = useState(false);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [over, setOver] = useState(false);
  const fieldId = useId();
  const canUpload = runtime.capabilities.has('source.upload');
  const busy = state.kind === 'uploading';

  const pick = (f: File | null) => {
    setFile(f);
    if (state.kind !== 'uploading') setState({ kind: 'idle' });
  };

  async function submit(e: FormEvent) {
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
      announce(`Uploaded ${deck.title}, ${deck.slideCount} slides`);
      setFile(null);
      setClientName('');
      setDeckYear('');
      setCategory('');
      setBestOfTheBest(false);
      reloadLibrary();
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  }

  if (!canUpload) {
    return (
      <div className="sv-wrap upload-wrap">
        <h1 className="h1" tabIndex={-1}>
          Upload
        </h1>
        <p className="lede muted" style={{ marginTop: 4 }}>
          Only contributors can upload. Ask a contributor or curator to add your deck.
        </p>
      </div>
    );
  }

  return (
    <div className="sv-wrap upload-wrap">
      <h1 className="h1" tabIndex={-1}>
        Upload a deck
      </h1>
      <p className="lede muted" style={{ marginTop: 4 }}>
        A .pptx goes in unchanged, gets split into slides with thumbnails, and shows up in the library.
      </p>

      <form onSubmit={submit} style={{ marginTop: 14 }}>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) pick(f);
          }}
        >
          <Icon name="upload" className="ic-big" />
          <p style={{ margin: '8px 0 12px' }}>
            <strong>{file ? file.name : 'Drop a .pptx here, or choose one'}</strong>
          </p>
          <label htmlFor={`${fieldId}-file`} className="btn btn-sm">
            Choose file
          </label>
          <input id={`${fieldId}-file`} className="sr-only" type="file" accept=".pptx" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </div>

        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor={`${fieldId}-client`}>Client</label>
            <input id={`${fieldId}-client`} type="text" className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Harbor Bank" />
          </div>
          <div className="field">
            <label htmlFor={`${fieldId}-year`}>Year</label>
            <input id={`${fieldId}-year`} type="number" className="input" value={deckYear} onChange={(e) => setDeckYear(e.target.value)} placeholder="e.g. 2026" />
          </div>
          <div className="field full">
            <label htmlFor={`${fieldId}-category`}>Category</label>
            <input id={`${fieldId}-category`} type="text" className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Business Proposal" />
          </div>
          <div className="radio-row full">
            <label>
              <input type="checkbox" checked={bestOfTheBest} onChange={(e) => setBestOfTheBest(e.target.checked)} />
              This is from the Best of the Best folder
            </label>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <button type="submit" className="btn btn-primary" disabled={!file || busy} aria-busy={busy}>
            {busy ? 'Uploading…' : 'Upload deck'}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {state.kind === 'done' && (
          <div className="notice info" style={{ marginTop: 14 }}>
            <Icon name="info" />
            <span>
              {state.deck.alreadyUploaded ? `“${state.deck.title}” was already in the library` : `“${state.deck.title}” uploaded`}, {state.deck.slideCount}{' '}
              {state.deck.slideCount === 1 ? 'slide' : 'slides'} ready.
              {state.deck.addedDetails?.length ? ` Added: ${state.deck.addedDetails.join(', ')}.` : ''} <Link to={{ view: 'deck', id: state.deck.id }}>Open the deck</Link>
            </span>
          </div>
        )}
      </div>
      {state.kind === 'error' && (
        <div className="notice danger" role="alert" style={{ marginTop: 14 }}>
          <Icon name="info" />
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}

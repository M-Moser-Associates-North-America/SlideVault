'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { uploadDeck } from '../client/api';
import type { DeckSummary, UploadDeckMeta } from '../contracts/dto';
import { Icon } from './icons';
import { Link, SimFlag } from './parts';
import { simTagsFromText } from './simulation';
import { useWorkspace } from './state';

/* The AI label queue is simulated (FD-14): the first three steps are real for a real upload, the rest are shown for the demo. */
const STAGES = ['Uploaded', 'Splitting into slides', 'Creating thumbnails', 'Suggesting labels (AI)', 'Grouping near-duplicates', 'Ready for review'];
const REAL_STEPS = 3;
const SAMPLE = {
  name: 'Sample: regional expansion pitch',
  slides: 5,
  tags: ['cover', 'problem', 'concept', 'cost', 'team'],
};
type QueueItem = {
  id: number;
  name: string;
  step: number;
  real: boolean;
  deckId?: string;
  slides: number;
  tags: string[];
};

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
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const running = queue.some((q) => q.step < STAGES.length);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setQueue((cur) => cur.map((q) => (q.step < STAGES.length ? { ...q, step: q.step + 1 } : q))), 800);
    return () => clearInterval(t);
  }, [running]);
  const addToQueue = (item: Omit<QueueItem, 'id'>) => setQueue((cur) => [...cur, { ...item, id: cur.length + 1 }]);
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
      addToQueue({
        name: deck.title,
        step: REAL_STEPS,
        real: true,
        deckId: deck.id,
        slides: deck.slideCount,
        tags: simTagsFromText(`${deck.title} ${meta.category ?? ''}`, meta.category),
      });
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
          Only Editors and Curators can upload. Switch Access at the top right to try it.
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
        A .pptx goes in unchanged, gets split into slides with thumbnails, and shows up in the library. New slides arrive as Suggested until a Curator approves them.
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

      <div className="row-flex" style={{ margin: '24px 0 10px', justifyContent: 'space-between' }}>
        <h2 className="h2" style={{ margin: 0 }}>
          Queue <SimFlag />
        </h2>
        <button
          type="button"
          className="btn btn-sm"
          disabled={running}
          onClick={() =>
            addToQueue({
              name: SAMPLE.name,
              step: 0,
              real: false,
              slides: SAMPLE.slides,
              tags: SAMPLE.tags,
            })
          }
        >
          <Icon name="sparkle" />
          <span>Preview the AI steps</span>
        </button>
      </div>
      <p className="meta" style={{ marginBottom: 10 }}>
        The orange steps are simulated: no AI runs yet. “Preview the AI steps” uses a sample and uploads nothing.
      </p>
      <ul className="queue">
        {queue.length === 0 && <li className="meta">Nothing in the queue yet.</li>}
        {[...queue].reverse().map((q) => {
          const done = q.step >= STAGES.length;
          return (
            <li key={q.id}>
              <strong>{q.name}</strong>
              <div className="qsteps">
                {STAGES.map((st, i) => (
                  <span key={st} className={`${i < q.step ? 'done' : i === q.step ? 'now' : ''}${i >= REAL_STEPS ? ' sim-step' : ''}`}>
                    {i < q.step && <Icon name="check" className="ic-sm" />}
                    {st}
                  </span>
                ))}
              </div>
              {done && (
                <p className="meta" style={{ marginTop: 8 }}>
                  {q.slides} {q.slides === 1 ? 'slide' : 'slides'} added. In the real build they arrive as Suggested. AI labels suggested (simulated):{' '}
                  {q.tags.length ? q.tags.join(', ') : 'none'}.{' '}
                  {q.real && q.deckId ? <Link to={{ view: 'deck', id: q.deckId }}>Open the deck</Link> : 'Sample only: nothing was added to the library.'}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

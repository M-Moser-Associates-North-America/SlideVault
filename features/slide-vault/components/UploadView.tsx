'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { addTag, listLibrary, listTags, uploadDeck } from '../client/api';
import { readDeckPreview, type DeckPreview } from '../client/pptx-preview';
import type { DeckSummary, UploadDeckMeta } from '../contracts/dto';
import { Icon } from './icons';
import { plural } from './library';
import { Link } from './parts';
import { useWorkspace } from './state';
import { TagField, type TagSuggestion } from './TagField';
import { UploadConfirmDialog, type UploadSummary } from './UploadConfirmDialog';
import { slideTagTotals, UploadSlideGrid, type SlideTags } from './UploadSlideGrid';

/* The kinds of deck M Moser keeps (the folders the library is sorted into). */
const CATEGORIES = ['SME', 'IDD', 'MSA', 'Business Proposal', 'Design Consultancy', 'RFP'];

type Reading = { kind: 'none' } | { kind: 'reading'; done: number; total: number } | { kind: 'ready'; preview: DeckPreview } | { kind: 'failed'; message: string };
type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; step: string; done?: number; total?: number }
  | { kind: 'error'; message: string }
  | { kind: 'done'; deck: DeckSummary; tagNote: string | null };

/** A bar for progress: filled to done / total, or sliding back and forth when the length isn't known. */
function Bar({ label, done, total }: { label: string; done?: number; total?: number }) {
  const known = total !== undefined && total > 0 && done !== undefined;
  const pct = known ? Math.round((done / total) * 100) : undefined;
  return (
    <div className="upbar-wrap">
      <p className="upbar-label">{label}</p>
      <div className={`upbar${known ? '' : ' is-indeterminate'}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={known ? { width: `${pct}%` } : undefined} />
      </div>
    </div>
  );
}

/**
 * Upload screen (docs/foundry/SLIDE_RECORD.md): choose a .pptx, see its slides, tag the deck and any slide,
 * then upload it all in one go after a confirmation. The browser reads the file first (nothing is sent
 * until the person confirms); the server then splits it into slides with pictures. Uses the real POST /uploads.
 */
export function UploadView() {
  const { runtime, reloadLibrary, announce } = useWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState<Reading>({ kind: 'none' });
  const [clientName, setClientName] = useState('');
  const [deckYear, setDeckYear] = useState('');
  const [category, setCategory] = useState('');
  const [otherCategory, setOtherCategory] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [slideTags, setSlideTags] = useState<SlideTags>({});
  const [known, setKnown] = useState<TagSuggestion[]>([]);
  const [bestOfTheBest, setBestOfTheBest] = useState(false);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [confirming, setConfirming] = useState(false);
  const [over, setOver] = useState(false);
  const otherRef = useRef<HTMLInputElement>(null);
  const readToken = useRef(0);
  const fieldId = useId();
  const canUpload = runtime.capabilities.has('source.upload');
  const busy = state.kind === 'uploading';
  const preview = reading.kind === 'ready' ? reading.preview : null;
  const ready = !!file && reading.kind !== 'reading';

  /* Tags already in use, most used first, so a new deck reuses the words the library already has. */
  useEffect(() => {
    let live = true;
    listTags(runtime).then((t) => live && setKnown(t), () => {});
    return () => {
      live = false;
    };
  }, [runtime]);

  const pick = (f: File | null) => {
    setFile(f);
    setSlideTags({});
    if (state.kind !== 'uploading') setState({ kind: 'idle' });
    const token = ++readToken.current;
    if (!f) {
      setReading({ kind: 'none' });
      return;
    }
    setReading({ kind: 'reading', done: 0, total: 0 });
    readDeckPreview(f, (done, total) => {
      if (token === readToken.current) setReading({ kind: 'reading', done, total });
    }).then(
      (p) => token === readToken.current && setReading({ kind: 'ready', preview: p }),
      (e) => token === readToken.current && setReading({ kind: 'failed', message: (e as Error).message }),
    );
  };

  const deckTitle = preview?.title ?? file?.name.replace(/\.pptx$/i, '') ?? '';
  const totals = slideTagTotals(slideTags);
  const summary: UploadSummary | null = file
    ? {
        title: deckTitle,
        details: [clientName.trim(), deckYear.trim(), category.trim()].filter(Boolean).join(' · '),
        slideCount: preview ? preview.slides.length : null,
        hiddenCount: preview ? preview.slides.filter((s) => s.hidden).length : 0,
        bestOfTheBest,
        deckTags: tags,
        slideTags: totals.tags,
        taggedSlides: totals.slides,
      }
    : null;

  /* After the deck exists: its tags, then each slide's, matched by slide number. Says in words what happened. */
  async function saveTags(deck: DeckSummary): Promise<string | null> {
    if (tags.length === 0 && totals.tags === 0) return null;
    if (deck.alreadyUploaded) return 'Tags were not added because this deck was already in the library. Open it to tag it.';
    const ops: { on: 'deck' | 'slide'; id: string; tag: string }[] = tags.map((tag) => ({ on: 'deck', id: deck.id, tag }));
    let skipped = '';
    if (totals.tags > 0 && preview) {
      setState({ kind: 'uploading', step: 'Finding the slides…' });
      const slides = (await listLibrary(runtime, undefined, { includeHidden: true }).catch(() => [])).filter((s) => s.provenance.sourceId === deck.id);
      const byNumber = new Map(slides.map((s) => [s.provenance.slideNumber, s.id]));
      if (slides.length === preview.slides.length && byNumber.size === slides.length) {
        for (const [n, list] of Object.entries(slideTags)) {
          const id = byNumber.get(Number(n));
          if (id) for (const tag of list) ops.push({ on: 'slide', id, tag });
        }
      } else {
        skipped = ` Slide tags were not added: the slides didn't line up with your file (${plural(slides.length, 'slide')} found, ${plural(preview.slides.length, 'slide')} expected). Open the deck to tag them.`;
      }
    }
    let saved = 0;
    for (const op of ops) {
      setState({ kind: 'uploading', step: 'Adding tags', done: saved, total: ops.length });
      try {
        if (!(await addTag(runtime, op.on, op.id, op.tag))) return saved ? `Added ${saved} of ${ops.length} tags; this server can't save the rest yet.${skipped}` : `Tags can't be saved yet: this server has no tag route. Your deck is uploaded without them.${skipped}`;
        saved++;
      } catch {
        return `Added ${saved} of ${ops.length} tags. The rest didn't save; open the deck to add them.${skipped}`;
      }
    }
    const decks = ops.filter((o) => o.on === 'deck').length;
    const onSlides = ops.length - decks;
    const added = [decks && plural(decks, 'deck tag'), onSlides && plural(onSlides, 'slide tag')].filter(Boolean).join(' and ');
    return ops.length ? `Tags added: ${added}.${skipped}` : skipped.trim() || null;
  }

  /* The form only asks for the confirmation; nothing is sent until it is given. */
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file && ready) setConfirming(true);
  };

  async function upload() {
    if (!file) return;
    setConfirming(false);
    setState({ kind: 'uploading', step: 'Uploading and splitting into slides…' });
    const meta: UploadDeckMeta = {
      clientName: clientName.trim() || null,
      deckYear: deckYear.trim() ? Number(deckYear) : null,
      category: category.trim() || null,
      folderPath: null,
      bestOfTheBest,
    };
    try {
      const deck = await uploadDeck(runtime, file, meta);
      const tagNote = await saveTags(deck);
      setState({ kind: 'done', deck, tagNote });
      announce(`Uploaded ${deck.title}, ${deck.slideCount} slides`);
      setFile(null);
      setReading({ kind: 'none' });
      setClientName('');
      setDeckYear('');
      setCategory('');
      setOtherCategory(false);
      setTags([]);
      setSlideTags({});
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
            if (f && !busy) pick(f);
          }}
        >
          <Icon name="upload" className="ic-big" />
          <p style={{ margin: '8px 0 12px' }}>
            <strong>{file ? file.name : 'Drop a .pptx here, or choose one'}</strong>
          </p>
          <label htmlFor={`${fieldId}-file`} className="btn btn-sm">
            {file ? 'Choose a different file' : 'Choose file'}
          </label>
          <input id={`${fieldId}-file`} className="sr-only" type="file" accept=".pptx" disabled={busy} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </div>

        <div aria-live="polite">
          {reading.kind === 'reading' && <Bar label={reading.total ? `Reading your deck: slide ${reading.done} of ${reading.total}` : 'Reading your deck…'} done={reading.done} total={reading.total} />}
          {reading.kind === 'failed' && (
            <div className="notice info" style={{ marginTop: 14 }}>
              <Icon name="info" />
              <span>We couldn&rsquo;t show this deck&rsquo;s slides here. {reading.message} You can still upload it, and tag its slides afterwards from the deck page.</span>
            </div>
          )}
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
          <div className="field full" role="group" aria-labelledby={`${fieldId}-category`}>
            <span id={`${fieldId}-category`} className="field-label">
              Category <span className="field-opt">optional</span>
            </span>
            <div className="catpills">
              {CATEGORIES.map((c) => {
                const on = !otherCategory && category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    className="catpill"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => {
                      setOtherCategory(false);
                      setCategory(on ? '' : c);
                    }}
                  >
                    {on && <Icon name="check" className="ic-sm" />}
                    {c}
                  </button>
                );
              })}
              <button
                type="button"
                className="catpill"
                aria-pressed={otherCategory}
                disabled={busy}
                onClick={() => {
                  const next = !otherCategory;
                  setOtherCategory(next);
                  setCategory('');
                  if (next) setTimeout(() => otherRef.current?.focus(), 0);
                }}
              >
                {otherCategory && <Icon name="check" className="ic-sm" />}
                Other
              </button>
            </div>
            {otherCategory && (
              <input ref={otherRef} type="text" className="input catother" aria-label="Other category" value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} placeholder="Name the category" />
            )}
          </div>
          <TagField label="Deck tags" hint="Words people might search for, like a sector or topic. They apply to every slide in the deck. Press Enter or comma after each." value={tags} onChange={setTags} suggestions={known} disabled={busy} />
          <div className="radio-row full">
            <label>
              <input type="checkbox" checked={bestOfTheBest} onChange={(e) => setBestOfTheBest(e.target.checked)} />
              Part of the Best of the Best collection
            </label>
          </div>
        </div>

        {preview && <UploadSlideGrid slides={preview.slides} tags={slideTags} onTags={setSlideTags} suggestions={known} disabled={busy} />}

        <div className="upsubmit">
          {busy ? (
            <Bar label={state.step} done={state.done} total={state.total} />
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!ready}>
              Upload deck
            </button>
          )}
          {!file && <p className="meta">Choose a file to continue.</p>}
        </div>
      </form>

      <UploadConfirmDialog open={confirming} summary={summary} onCancel={() => setConfirming(false)} onConfirm={upload} />

      <div aria-live="polite">
        {state.kind === 'done' && (
          <div className="notice info" style={{ marginTop: 14 }}>
            <Icon name="info" />
            <span>
              {state.deck.alreadyUploaded ? `“${state.deck.title}” was already in the library` : `“${state.deck.title}” uploaded`}, {state.deck.slideCount} {state.deck.slideCount === 1 ? 'slide' : 'slides'} ready.
              {state.deck.addedDetails?.length ? ` Added: ${state.deck.addedDetails.join(', ')}.` : ''}
              {state.tagNote ? ` ${state.tagNote}` : ''} <Link to={{ view: 'deck', id: state.deck.id }}>Open the deck</Link>
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

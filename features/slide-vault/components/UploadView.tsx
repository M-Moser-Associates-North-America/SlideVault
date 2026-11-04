'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { addTag, listLibrary, listTags, previewUpload, uploadDeck } from '../client/api';
import { setUploadDraft } from '../client/upload-draft-store';
import { guessFromFileName, yearFromTitleSlide } from '../client/deck-details-guess';
import { readDeckPreview, type DeckPreview } from '../client/pptx-preview';
import type { DeckSummary, UploadDeckMeta, UploadPreview } from '../contracts/dto';
import { Icon } from './icons';
import { plural } from './library';
import { Link } from './parts';
import { useWorkspace } from './state';
import { TagField, type TagSuggestion } from './TagField';
import { UploadConfirmDialog, type UploadSummary } from './UploadConfirmDialog';
import { slideTagTotals, UploadSlideGrid, type SlideTags } from './UploadSlideGrid';

/* The kinds of deck M Moser keeps (the folders the library is sorted into). */
const CATEGORIES = ['SME', 'IDD', 'MSA', 'Business Proposal', 'Design Consultancy', 'RFP'];

type DetailKey = 'client' | 'year' | 'category';
const DETAIL_LABEL: Record<DetailKey, string> = { client: 'Client', year: 'Year', category: 'Category' };
const list = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : (items[0] ?? ''));

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
  /* Categories, in the order picked: the first is the deck's main category, the rest are saved as deck tags. */
  const [picked, setPicked] = useState<string[]>([]);
  /* Categories the person typed with "Other": they join the pills and stay until removed. */
  const [custom, setCustom] = useState<string[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [slideTags, setSlideTags] = useState<SlideTags>({});
  const [known, setKnown] = useState<TagSuggestion[]>([]);
  const [bestOfTheBest, setBestOfTheBest] = useState(false);
  /* Which details we filled in for the person, and where from. A field leaves this list the moment they edit it. */
  const [auto, setAuto] = useState<Partial<Record<DetailKey, string>>>({});
  /* What we looked for in the file the person just chose: shown in words, so an empty field never looks like a mistake. */
  const [looked, setLooked] = useState<DetailKey[]>([]);
  /* Set when the person tries to upload with Client or Year missing: errors show, and clear as they fix each one. */
  const [tried, setTried] = useState(false);
  /* The server draws each slide as a picture (FD-54). It only keeps them in a temporary folder; nothing is stored. */
  const [pics, setPics] = useState<{ kind: 'none' | 'drawing' | 'unavailable' } | { kind: 'ready'; data: UploadPreview }>({ kind: 'none' });
  const picsAbort = useRef<AbortController | null>(null);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [confirming, setConfirming] = useState(false);
  const [over, setOver] = useState(false);
  const otherRef = useRef<HTMLInputElement>(null);
  const otherBtnRef = useRef<HTMLButtonElement>(null);
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
      picsAbort.current?.abort();
      setPics({ kind: 'none' });
      setReading({ kind: 'none' });
      return;
    }
    /* A new file is a new deck: fill what its name says, and clear what belonged to the last one. */
    const guess = guessFromFileName(f.name);
    setClientName(guess.client ?? '');
    setDeckYear(guess.year ?? '');
    setPicked(guess.category ? [guess.category] : []);
    setCustom([]);
    setOtherOpen(false);
    setOtherText('');
    setAuto(guess.source);
    setTried(false);
    setLooked(['client', 'year', 'category']);
    picsAbort.current?.abort();
    setPics({ kind: 'none' });
    if (state.kind !== 'uploading') {
      const ctrl = new AbortController();
      picsAbort.current = ctrl;
      setPics({ kind: 'drawing' });
      previewUpload(runtime, f, ctrl.signal).then(
        (data) => token === readToken.current && setPics(data ? { kind: 'ready', data } : { kind: 'unavailable' }),
        () => token === readToken.current && setPics({ kind: 'unavailable' }),
      );
    }
    setReading({ kind: 'reading', done: 0, total: 0 });
    readDeckPreview(f, (done, total) => {
      if (token === readToken.current) setReading({ kind: 'reading', done, total });
    }).then(
      (p) => {
        if (token !== readToken.current) return;
        setReading({ kind: 'ready', preview: p });
        /* The file name had no year: try the title slide, but never over something the person typed meanwhile. */
        const year = !guess.year ? yearFromTitleSlide(p) : null;
        if (year) {
          setDeckYear((y) => (y ? y : year));
          setAuto((a) => ({ ...a, year: 'the title slide' }));
        }
      },
      (e) => token === readToken.current && setReading({ kind: 'failed', message: (e as Error).message }),
    );
  };

  const deckTitle = preview?.title ?? file?.name.replace(/\.pptx$/i, '') ?? '';
  const totals = slideTagTotals(slideTags);
  const yearNumber = Number(deckYear);
  const yearOk = Number.isInteger(yearNumber) && yearNumber >= 1900 && yearNumber <= 2099;
  const clientError = tried && !clientName.trim() ? 'Please add the client.' : null;
  const yearError = tried && !yearOk ? (deckYear.trim() ? 'Please enter a four-digit year, like 2026.' : 'Please add the year.') : null;
  const missingNow = picked.length === 0;
  /* The extra categories travel as deck tags (the library keeps one main category per deck); no duplicates, whatever the capitals. */
  const deckTags = [...tags, ...picked.slice(1).filter((c) => !tags.some((t) => t.toLowerCase() === c.toLowerCase()))];
  const summary: UploadSummary | null = file
    ? {
        title: deckTitle,
        details: [clientName.trim(), deckYear.trim(), picked.join(' + ')].filter(Boolean).join(' · '),
        slideCount: preview ? preview.slides.length : null,
        hiddenCount: preview ? preview.slides.filter((s) => s.hidden).length : 0,
        bestOfTheBest,
        incomplete: missingNow,
        deckTags,
        slideTags: totals.tags,
        taggedSlides: totals.slides,
      }
    : null;

  /* After the deck exists: its tags, then each slide's, matched by slide number. Says in words what happened. */
  async function saveTags(deck: DeckSummary): Promise<string | null> {
    if (deckTags.length === 0 && totals.tags === 0) return null;
    if (deck.alreadyUploaded) return 'Tags were not added because this deck was already in the library. Open it to tag it.';
    const ops: { on: 'deck' | 'slide'; id: string; tag: string }[] = deckTags.map((tag) => ({ on: 'deck', id: deck.id, tag }));
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

  /* A change by the person always wins: that field is no longer "filled in by us". */
  const edit = (key: DetailKey, set: (v: string) => void, value: string) => {
    set(value);
    touched(key);
  };
  const touched = (key: DetailKey) => {
    setAuto((a) => {
      if (!(key in a)) return a;
      const rest = { ...a };
      delete rest[key];
      return rest;
    });
    setLooked((l) => l.filter((k) => k !== key));
  };
  const toggleCategory = (c: string) => {
    const on = picked.includes(c);
    setPicked((l) => (on ? l.filter((x) => x !== c) : [...l, c]));
    /* A category the person typed is theirs to remove; a standard one just switches off. */
    if (on && custom.includes(c)) setCustom((l) => l.filter((x) => x !== c));
    touched('category');
  };
  const addOther = () => {
    const name = otherText.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!name) return;
    const existing = [...CATEGORIES, ...custom].find((c) => c.toLowerCase() === name.toLowerCase());
    const use = existing ?? name;
    if (!existing) setCustom((l) => [...l, use]);
    setPicked((l) => (l.includes(use) ? l : [...l, use]));
    touched('category');
    setOtherText('');
    setOtherOpen(false); /* the box shows only while Other is pressed; press it again for the next one */
    announce(`${use} added to the categories`);
    setTimeout(() => otherBtnRef.current?.focus(), 0);
  };
  const hintFor = (key: DetailKey) =>
    auto[key] ? `Filled in from ${auto[key]}. Check it and change it if it's wrong.` : looked.includes(key) ? `We couldn't find this in the file. Please add it yourself.` : null;
  const filled = (Object.keys(auto) as DetailKey[]).map((k) => DETAIL_LABEL[k].toLowerCase());
  const notFound = looked.filter((k) => !(k in auto)).map((k) => DETAIL_LABEL[k].toLowerCase());

  /* Anything here that would be lost on leaving: tells the sign-out question, and the browser's own "Leave site?" prompt. */
  const draftBits = [clientName.trim(), deckYear.trim(), picked.length ? picked.join(' + ') : '', deckTags.length ? plural(deckTags.length, 'deck tag') : '', totals.tags ? plural(totals.tags, 'slide tag') : ''].filter(Boolean);
  const hasDraft = !!file || draftBits.length > 0;
  const draftLabel = [file ? deckTitle : '', ...draftBits].filter(Boolean).join(' · ') || 'Upload';
  useEffect(() => {
    setUploadDraft(hasDraft ? { label: draftLabel, uploading: busy } : null);
  }, [hasDraft, draftLabel, busy]);
  useEffect(() => () => setUploadDraft(null), []);
  useEffect(() => {
    if (!hasDraft) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; /* browsers show their own wording; this only switches the prompt on */
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDraft]);

  /* The form only asks for the confirmation; nothing is sent until it is given. */
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file || !ready) return;
    if (!clientName.trim() || !yearOk) {
      setTried(true);
      document.getElementById(`${fieldId}-${!clientName.trim() ? 'client' : 'year'}`)?.focus();
      return;
    }
    setConfirming(true);
  };

  async function upload() {
    if (!file) return;
    setConfirming(false);
    setState({ kind: 'uploading', step: 'Uploading and splitting into slides…' });
    const meta: UploadDeckMeta = {
      clientName: clientName.trim() || null,
      deckYear: deckYear.trim() ? Number(deckYear) : null,
      category: picked[0] ?? null,
      folderPath: null,
      bestOfTheBest,
    };
    try {
      const deck = await uploadDeck(runtime, file, meta);
      const tagNote = await saveTags(deck);
      setState({ kind: 'done', deck, tagNote });
      announce(`Uploaded ${deck.title}, ${deck.slideCount} slides`);
      setFile(null);
      picsAbort.current?.abort();
      setPics({ kind: 'none' });
      setReading({ kind: 'none' });
      picsAbort.current?.abort();
      setPics({ kind: 'none' });
      setClientName('');
      setDeckYear('');
      setPicked([]);
      setCustom([]);
      setOtherOpen(false);
      setOtherText('');
      setAuto({});
      setLooked([]);
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

      <form onSubmit={submit} noValidate style={{ marginTop: 14 }}>
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

        <div aria-live="polite">
          {file && reading.kind !== 'reading' && (filled.length > 0 || notFound.length > 0) && (
            <div className="notice info" style={{ marginTop: 14 }}>
              <Icon name="info" />
              <span className={notFound.length > 0 ? 'up-todo' : 'up-ok'}>
                {filled.length > 0 && `We filled in ${list(filled)} from your file. Please check ${filled.length > 1 ? 'them' : 'it'}; you can change anything. `}
                {notFound.length > 0 && (filled.length || notFound.length < 3 ? `We couldn't find ${list(notFound)}: please add ${notFound.length > 1 ? 'those' : 'that'} yourself.` : `We couldn't read the client, year or category from this file, so the details below are incomplete. Please fill them in yourself.`)}
              </span>
            </div>
          )}
        </div>

        <p className="field-hint" style={{ marginTop: 14 }}>
          <span className="req" aria-hidden="true">*</span> Required
        </p>
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor={`${fieldId}-client`}>
              Client <span className="req" aria-hidden="true">*</span>
            </label>
            <input id={`${fieldId}-client`} type="text" className="input" value={clientName} onChange={(e) => edit('client', setClientName, e.target.value)} placeholder="e.g. Harbor Bank" required aria-required="true" aria-invalid={clientError ? true : undefined} aria-describedby={clientError || hintFor('client') ? `${fieldId}-client-hint` : undefined} />
            {(clientError || hintFor('client')) && <p id={`${fieldId}-client-hint`} className={`field-hint${clientError || !auto.client ? ' is-missing' : ' is-auto'}`}>{clientError ?? hintFor('client')}</p>}
          </div>
          <div className="field">
            <label htmlFor={`${fieldId}-year`}>
              Year <span className="req" aria-hidden="true">*</span>
            </label>
            <input id={`${fieldId}-year`} type="text" inputMode="numeric" autoComplete="off" maxLength={4} className="input" value={deckYear} onChange={(e) => edit('year', setDeckYear, e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="e.g. 2026" required aria-required="true" aria-invalid={yearError ? true : undefined} aria-describedby={yearError || hintFor('year') ? `${fieldId}-year-hint` : undefined} />
            {(yearError || hintFor('year')) && <p id={`${fieldId}-year-hint`} className={`field-hint${yearError || !auto.year ? ' is-missing' : ' is-auto'}`}>{yearError ?? hintFor('year')}</p>}
          </div>
          <div className="field full" role="group" aria-labelledby={`${fieldId}-category`}>
            <span id={`${fieldId}-category`} className="field-label">
              Category <span className="field-opt">optional</span>
            </span>
            <div className="catpills">
              {[...CATEGORIES, ...custom].map((c) => {
                const on = picked.includes(c);
                return (
                  <button key={c} type="button" className="catpill" aria-pressed={on} disabled={busy} onClick={() => toggleCategory(c)}>
                    {on && <Icon name="check" className="ic-sm" />}
                    {c}
                  </button>
                );
              })}
              <button
                ref={otherBtnRef}
                type="button"
                className="catpill"
                aria-pressed={otherOpen}
                disabled={busy}
                onClick={() => {
                  const next = !otherOpen;
                  setOtherOpen(next);
                  setOtherText('');
                  if (next) setTimeout(() => otherRef.current?.focus(), 0);
                }}
              >
                {otherOpen && <Icon name="check" className="ic-sm" />}
                Other
              </button>
            </div>
            {otherOpen && (
              <div className="catother-row">
                <input
                  ref={otherRef}
                  type="text"
                  className="input catother"
                  aria-label="Other category name"
                  value={otherText}
                  maxLength={60}
                  onChange={(e) => setOtherText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault(); /* Enter adds the category; it never submits the upload form from here */
                      addOther();
                    }
                  }}
                  placeholder="Name the category, then press Enter"
                />
                <button type="button" className="btn btn-sm" disabled={!otherText.trim()} onClick={addOther}>
                  Add
                </button>
              </div>
            )}
            <p className="field-hint">Pick all that apply. The first one you pick is the main category; any others are saved as deck tags so they&rsquo;re still searchable.</p>
            {hintFor('category') && <p className={`field-hint${auto.category ? ' is-auto' : ' is-missing'}`}>{hintFor('category')}</p>}
          </div>
          <TagField label="Deck tags" hint="Words people might search for, they apply to every slide in the deck." value={tags} onChange={setTags} suggestions={known} disabled={busy} />
          <div className="radio-row full">
            <label>
              <input type="checkbox" checked={bestOfTheBest} onChange={(e) => setBestOfTheBest(e.target.checked)} />
              Part of the Best of the Best collection
            </label>
          </div>
        </div>

        {pics.kind === 'ready' && pics.data.alreadyUploadedAs && (
          <div className="notice info" style={{ marginTop: 14 }}>
            <Icon name="info" />
            <span>This exact file is already in the library as &ldquo;{pics.data.alreadyUploadedAs}&rdquo;. Uploading it again won&rsquo;t add a copy.</span>
          </div>
        )}
        {preview && <UploadSlideGrid deckTags={deckTags} pictures={pics.kind === 'ready' ? Object.fromEntries(pics.data.slides.map((x) => [x.number, runtime.assetUrl(x.previewPath)])) : undefined} drawing={pics.kind === 'drawing'} slides={preview.slides} tags={slideTags} onTags={setSlideTags} suggestions={known} disabled={busy} />}

        <div className="upsubmit">
          {busy ? (
            <Bar label={state.step} done={state.done} total={state.total} />
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!ready}>
              Upload deck
            </button>
          )}
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

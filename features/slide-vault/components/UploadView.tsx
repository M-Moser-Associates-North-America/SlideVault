'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { addTag, listLibrary, listTags, previewTagSuggestions, previewUpload, suggestUploadDetails, uploadAiAvailable, uploadDeck, type TagSuggestionItem } from '../client/api';
import { setUploadDraft } from '../client/upload-draft-store';
import { guessFromFileName, yearFromTitleSlide } from '../client/deck-details-guess';
import { readDeckPreview, type DeckPreview } from '../client/pptx-preview';
import type { DeckSummary, UploadDeckMeta, UploadPreview } from '../contracts/dto';
import { Icon } from './icons';
import { plural } from './library';
import { Link } from './parts';
import { useWorkspace } from './state';
import { SuggestedTagChips } from './TagBits';
import { TagField, type TagSuggestion } from './TagField';
import { UploadConfirmDialog, type UploadSummary } from './UploadConfirmDialog';
import { slideTagTotals, UploadSlideGrid, type SlideTags } from './UploadSlideGrid';

/* "Fill the rest with AI" adds this many suggested tags to each slide (the rest stay as chips to add one by one). */
const AI_TAGS_PER_SLIDE = 2;

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
  /* Tags suggested from similar library slides once the server has read the file (FD-82): for the deck, and per slide number. */
  const [sugg, setSugg] = useState<{ deck: TagSuggestionItem[]; slides: Record<string, TagSuggestionItem[]> }>({ deck: [], slides: {} });
  /* "Fill the rest with AI" (FD-23): offered only when the server has an AI for it. */
  const [aiOk, setAiOk] = useState(false);
  const [aiState, setAiState] = useState<{ kind: 'idle' | 'reading' } | { kind: 'done'; note: string }>({ kind: 'idle' });
  /* "Fill the rest with AI" also adds the suggested tags once they have arrived (they take a few seconds on a big deck). */
  /* The tags filled in for the person, and by what: marked on screen, with the same "please check" line as the other filled-in details. */
  const [filledTags, setFilledTags] = useState<{ source: 'ai' | 'similar'; deck: string[]; slides: Record<number, string[]> } | null>(null);
  const wantAiTags = useRef(false);
  const suggested = useRef<{ ready: boolean; items: { deck: TagSuggestionItem[]; slides: Record<string, TagSuggestionItem[]> } }>({ ready: false, items: { deck: [], slides: {} } });
  const lastTags = useRef<{ deck: string[]; slides: SlideTags }>({ deck: [], slides: {} });
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
    const ctrl = new AbortController();
    uploadAiAvailable(runtime, ctrl.signal).then((v) => !ctrl.signal.aborted && setAiOk(v));
    return () => ctrl.abort();
  }, [runtime]);

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
    setSugg({ deck: [], slides: {} });
    suggested.current = { ready: false, items: { deck: [], slides: {} } };
    wantAiTags.current = false;
    setFilledTags(null);
    setAiState({ kind: 'idle' });
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
        (data) => {
          if (token !== readToken.current) return;
          setPics(data ? { kind: 'ready', data } : { kind: 'unavailable' });
          /* Then the tag suggestions, which take a few seconds for a big deck: after the pictures, never before them. */
          if (data) previewTagSuggestions(runtime, data.token, ctrl.signal).then(
            (s) => {
              if (token !== readToken.current) return;
              setSugg(s);
              suggested.current = { ready: true, items: s };
              if (wantAiTags.current) addSuggestedTags(s);
            },
            () => {
              if (token !== readToken.current) return;
              suggested.current = { ready: true, items: { deck: [], slides: {} } };
              if (wantAiTags.current) addSuggestedTags({ deck: [], slides: {} });
            },
          );
        },
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

  /* "Fill the rest with AI" also adds tags: the ones the AI reads from the slides (FD-85), or, if it gives none, the ones
     suggested from similar slides, which arrive a few seconds after the file is read, so this waits for them if not here yet. Nothing is saved
     until Upload, each tag can be removed like any other, and the note asks the person to check them (Alina's rule). */
  const addSuggestedTags = (items: { deck: TagSuggestionItem[]; slides: Record<string, TagSuggestionItem[]> }, source: 'ai' | 'similar' = 'similar') => {
    wantAiTags.current = false;
    const has = (list: string[], t: string) => list.some((x) => x.toLowerCase() === t.toLowerCase());
    const now = lastTags.current;
    const deckAdd = items.deck.map((x) => x.tag).filter((t) => !has(now.deck, t));
    const slideAdd: SlideTags = {};
    let slideN = 0;
    for (const [key, list] of Object.entries(items.slides)) {
      const n = Number(key);
      const mine = now.slides[n] ?? [];
      const add = list.map((x) => x.tag).filter((t) => !has(mine, t) && !has(now.deck, t) && !has(deckAdd, t)).slice(0, AI_TAGS_PER_SLIDE);
      if (add.length) {
        slideAdd[n] = add;
        slideN += add.length;
      }
    }
    if (deckAdd.length) setTags((cur) => [...cur, ...deckAdd.filter((t) => !has(cur, t))]);
    if (slideN) setSlideTags((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(slideAdd).map(([n, add]) => [n, [...(cur[Number(n)] ?? []), ...add.filter((t) => !has(cur[Number(n)] ?? [], t))]])) }));
    if (deckAdd.length + slideN > 0) setFilledTags({ source, deck: deckAdd, slides: slideAdd });
    const note = deckAdd.length + slideN > 0 ? `Added ${plural(deckAdd.length, 'deck tag')} and ${plural(slideN, 'slide tag')} ${source === 'ai' ? 'the AI read from your slides' : 'from similar slides'}. Please check them; nothing is saved until you upload.` : 'No tag suggestions for this deck yet.';
    setAiState((s) => (s.kind === 'done' ? { kind: 'done', note: `${s.note} ${note}` } : s));
    announce(note);
  };
  const askForSuggestedTags = () => {
    if (suggested.current.ready) addSuggestedTags(suggested.current.items);
    else wantAiTags.current = true;
  };

  /* Asks the server's AI for the details still empty; never overwrites what's there. Each value says it came from AI, to check. */
  const fillWithAi = async () => {
    if (!file) return;
    const token = readToken.current;
    setAiState({ kind: 'reading' });
    const got = await suggestUploadDetails(runtime, file, { ai: true, tags: true }).catch(() => null);
    if (token !== readToken.current) return;
    if (!got) {
      setAiState({ kind: 'done', note: "The AI couldn't read this file just now. Please fill in the rest yourself." });
      askForSuggestedTags();
      return;
    }
    const from = (src: string) => (src === 'ai' ? 'the AI (please check)' : src);
    const added: string[] = [];
    const s = got.suggestions;
    if (!clientName.trim() && s.client) {
      setClientName(s.client.value);
      setAuto((a) => ({ ...a, client: from(s.client!.source) }));
      added.push('client');
    }
    if (!deckYear.trim() && s.year) {
      setDeckYear(String(s.year.value));
      setAuto((a) => ({ ...a, year: from(s.year!.source) }));
      added.push('year');
    }
    if (picked.length === 0 && s.category) {
      const name = CATEGORIES.find((c) => c.toLowerCase() === s.category!.value.toLowerCase()) ?? s.category.value;
      if (!CATEGORIES.includes(name)) setCustom((c) => (c.includes(name) ? c : [...c, name]));
      setPicked([name]);
      setAuto((a) => ({ ...a, category: from(s.category!.source) }));
      added.push('category');
    }
    if (s.bestOfTheBest?.value && !bestOfTheBest) setBestOfTheBest(true);
    const note = got.readerNote ?? (added.length ? `Filled in ${list(added)}. Please check ${added.length > 1 ? 'them' : 'it'}.` : 'Nothing more could be read from this file. Please fill in the rest yourself.');
    setAiState({ kind: 'done', note });
    announce(note);
    // The AI read the slides for tags too: add them. If it gave none, fall back to the tags suggested from similar slides.
    if (got.tags && (got.tags.deck.length || Object.keys(got.tags.slides).length)) {
      const fromAi = got.tags;
      setSugg((cur) => ({
        deck: [...fromAi.deck, ...cur.deck.filter((x) => !fromAi.deck.some((y) => y.tag.toLowerCase() === x.tag.toLowerCase()))],
        slides: Object.fromEntries([...new Set([...Object.keys(cur.slides), ...Object.keys(fromAi.slides)])].map((n) => [n, [...(fromAi.slides[n] ?? []), ...(cur.slides[n] ?? []).filter((x) => !(fromAi.slides[n] ?? []).some((y) => y.tag.toLowerCase() === x.tag.toLowerCase()))]])),
      }));
      addSuggestedTags(fromAi, 'ai');
    } else askForSuggestedTags();
  };
  const missingDetails = !clientName.trim() || !deckYear.trim() || picked.length === 0;

  const deckTitle = preview?.title ?? file?.name.replace(/\.pptx$/i, '') ?? '';
  const totals = slideTagTotals(slideTags);
  const yearNumber = Number(deckYear);
  const yearOk = Number.isInteger(yearNumber) && yearNumber >= 1900 && yearNumber <= 2099;
  const clientError = tried && !clientName.trim() ? 'Please add the client.' : null;
  const yearError = tried && !yearOk ? (deckYear.trim() ? 'Please enter a four-digit year, like 2026.' : 'Please add the year.') : null;
  const missingNow = picked.length === 0;
  /* The extra categories travel as deck tags (the library keeps one main category per deck); no duplicates, whatever the capitals. */
  const deckTags = [...tags, ...picked.slice(1).filter((c) => !tags.some((t) => t.toLowerCase() === c.toLowerCase()))];
  /* Only what is still there: a tag the person removed is no longer "filled in". */
  const autoDeck = filledTags ? filledTags.deck.filter((t) => tags.some((x) => x.toLowerCase() === t.toLowerCase())) : [];
  const autoSlideN = filledTags ? Object.entries(filledTags.slides).reduce((n, [k, list]) => n + list.filter((t) => (slideTags[Number(k)] ?? []).some((x) => x.toLowerCase() === t.toLowerCase())).length, 0) : 0;
  const autoSaid = filledTags?.source === 'ai' ? 'Filled in from the AI (please check).' : 'Filled in from similar slides (please check).';
  useEffect(() => {
    lastTags.current = { deck: deckTags, slides: slideTags };
  });
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
        filledIn: autoDeck.length + autoSlideN,
        filledInBy: filledTags?.source ?? null,
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

        {aiOk && file && reading.kind !== 'reading' && (missingDetails || aiState.kind !== 'idle') && (
          <div className="up-ai" aria-live="polite">
            {aiState.kind === 'done' ? (
              <p className="field-hint">{aiState.note}</p>
            ) : (
              <button type="button" className="btn btn-sm btn-ai" disabled={busy || aiState.kind === 'reading'} onClick={() => void fillWithAi()}>
                <Icon name="sparkle" className="ic-sm" />
                {aiState.kind === 'reading' ? 'Reading the file…' : <>Fill the rest with <b>AI</b></>}
              </button>
            )}
          </div>
        )}

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
          <TagField label="Deck tags" hint="Words people might search for, they apply to every slide in the deck." value={tags} onChange={setTags} suggestions={known} disabled={busy} auto={autoDeck} />
          {autoDeck.length > 0 && <p className="field-hint is-auto full">{autoSaid} Remove any that don&rsquo;t fit.</p>}
          {sugg.deck.length > 0 && (
            <div className="full">
              <SuggestedTagChips label="Suggested deck tags" suggestions={sugg.deck} have={deckTags} disabled={busy} onAdd={(t) => setTags((x) => (x.some((y) => y.toLowerCase() === t.toLowerCase()) ? x : [...x, t]))} />
            </div>
          )}
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
        {preview && autoSlideN > 0 && <p className="field-hint is-auto">{autoSaid} They are marked with a sparkle on the slides.</p>}
        {preview && <UploadSlideGrid autoTags={filledTags?.slides} deckTags={deckTags} pictures={pics.kind === 'ready' ? Object.fromEntries(pics.data.slides.map((x) => [x.number, runtime.assetUrl(x.previewPath)])) : undefined} drawing={pics.kind === 'drawing'} slides={preview.slides} tags={slideTags} onTags={setSlideTags} suggestions={known} suggested={sugg.slides} disabled={busy} />}

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

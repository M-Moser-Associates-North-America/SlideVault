'use client';

import { useEffect, useRef, useState } from 'react';
import type { SlideSummary, StoryboardResult, StoryboardSection, StoryFeedbackVerdict, StoryRole } from '../contracts/dto';
import { buildStory, sendStoryFeedback, speechAvailable, transcribe } from '../client/api';
import { ROLE_CHOICES, useStoryRole } from '../client/role-store';
import { takeHandedOffBrief } from '../client/story-handoff';
import { startRecording, type Recording } from '../client/wav-recorder';
import { Icon } from './icons';
import { Link, SlideCard, Thumb, useCartToggle } from './parts';
import { useWorkspace } from './state';
import './storyboard.css';

/**
 * Storyboard tab (docs/DECISIONS.md FD-22, FD-24): a client situation in, a story of the library's
 * slides out, part by part, client first. The AI's questions come as a chat the person can answer
 * by talking or typing, and every slide asks "Right for this part?" so the next storyboard for a
 * similar brief is better. Slides use the same card as Home: click to preview, tick to add.
 */

const EXAMPLES = [
  'A hospital group is merging three campuses. Clinical staff are burnt out, and the board worries about cost overruns after a failed project last year. We need a proposal outline that tells one story across all three sites.',
  'A law firm is moving floors because half its lawyers now work from home. The RFP asks for firm history, process, team CVs, case studies and fees.',
  'A bank is consolidating two offices into one. The CFO wants savings; staff are worried about losing their own desks.',
];

type Chat = { who: 'ai' | 'you'; text: string };
const two = (n: number) => String(n).padStart(2, '0');

export function StoryboardView() {
  const { runtime, updateSelection, toast, announce, profile } = useWorkspace();
  const { role } = useStoryRole(profile);
  const roleLabel = ROLE_CHOICES.find((c) => c.role === role)?.label ?? null;
  // A brief typed in search arrives here when the person chose "Build a story instead".
  const [situation, setSituation] = useState(() => takeHandedOffBrief() ?? '');
  const [read, setRead] = useState(true);
  const [phase, setPhase] = useState<'start' | 'building' | 'ready' | 'error'>('start');
  const [error, setError] = useState('');
  const [story, setStory] = useState<StoryboardResult | null>(null);
  const [answers, setAnswers] = useState('');
  const [chat, setChat] = useState<Chat[]>([]);
  const [elapsed, setElapsed] = useState(0);
  /** The AI has answered: "Preparing your results" shows for a moment before the story appears */
  const [preparing, setPreparing] = useState(false);
  const before = useRef<'start' | 'ready'>('start');
  /** "Useful / Not right / No match", keyed "role:slideId" or "role:_part"; shared by the board and the detail */
  const [said, setSaid] = useState<Record<string, StoryFeedbackVerdict>>({});
  function say(role: StoryRole, slideId: string | null, verdict: StoryFeedbackVerdict) {
    if (!story) return;
    setSaid((cur) => ({ ...cur, [`${role}:${slideId ?? '_part'}`]: verdict }));
    sendStoryFeedback(runtime, { role, slideId, verdict, topics: story.topics, by: story.role }).catch(() => toast("Couldn't save that. Please try again."));
  }
  const abort = useRef<AbortController | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (phase !== 'building') return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function run(withAnswers: string) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    before.current = story ? 'ready' : 'start';
    setElapsed(0);
    setPreparing(false);
    setPhase('building');
    announce('Building your story. This can take a minute.');
    try {
      const result = await buildStory(runtime, situation.trim(), { read, answers: withAnswers, role }, controller.signal);
      setPreparing(true);
      await new Promise((r) => setTimeout(r, PREPARE_MS));
      if (controller.signal.aborted) return;
      setPreparing(false);
      setSaid({});
      setStory(result);
      setPhase('ready');
      setChat((c) => {
        const next = [...c];
        if (withAnswers) next.push({ who: 'ai', text: 'Thanks. I rebuilt the story with that.' });
        else if (result.questions.length) next.push({ who: 'ai', text: 'Here is a first story. To make it sharper:' }, ...result.questions.map((q) => ({ who: 'ai' as const, text: q })));
        else next.push({ who: 'ai', text: 'Here is a first story. Tell me anything else about the client and I will sharpen it.' });
        return next;
      });
      announce(`Story ready: ${result.sections.length} parts.`);
      requestAnimationFrame(() => headRef.current?.focus());
    } catch (e) {
      if (controller.signal.aborted) return;
      setError((e as Error).message);
      setPhase('error');
    }
  }

  function reply(text: string) {
    const t = text.trim();
    if (!t) return;
    const all = [answers, t].filter(Boolean).join('\n');
    setAnswers(all);
    setChat((c) => [...c, { who: 'you', text: t }]);
    void run(all);
  }

  /** The loading screen's close button: stop waiting and go back to where the person was. */
  function cancel() {
    abort.current?.abort();
    setPreparing(false);
    setPhase(before.current);
    announce('Stopped.');
  }

  function startOver() {
    abort.current?.abort();
    setStory(null);
    setChat([]);
    setAnswers('');
    setPhase('start');
  }

  const ordered = story ? story.sections.flatMap((s) => s.items.map((i) => i.slide)) : [];
  function addStory() {
    if (!story) return;
    // The lead slide of each part, in story order.
    const leads = story.sections.map((s) => s.items[0]?.slide).filter((s): s is SlideSummary => !!s);
    updateSelection((cur) => [...cur, ...leads.filter((l) => !cur.some((c) => c.id === l.id))]);
    toast(`Added the story's ${leads.length} lead slides to the draft deck, in story order`);
  }

  const loading = phase === 'building' && <LoadingDialog elapsed={elapsed} preparing={preparing} onClose={cancel} />;

  if (phase === 'start' || phase === 'error' || (phase === 'building' && !story))
    return (
      <div className="sv-wrap sb">
        <BackHome />
        <p className="sb-eyebrow">Storyboard</p>
        <h1 className="h1 sb-title" tabIndex={-1}>
          Start with the client, not the archive.
        </h1>
        <p className="lede muted sb-lede">Describe the client&apos;s situation: paste the brief, your notes or a ChatGPT outline, or just talk. SlideVault builds the story from your own slides, part by part, and says why each slide belongs.</p>
        <div className="sb-compose">
          <label htmlFor="sb-situation" className="sr-only">
            The client&apos;s situation
          </label>
          <textarea id="sb-situation" value={situation} onChange={(e) => setSituation(e.target.value)} rows={6} placeholder="Who is the client, what's happening, what worries them, and what would a win look like?" />
          <div className="sb-compose-row">
            <MicButton onText={(t) => setSituation((s) => [s.trim(), t].filter(Boolean).join(' '))} />
            <label className="sb-toggle">
              <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
              Let the AI read it <span className="muted">(about a minute)</span>
            </label>
            <button type="button" className="btn btn-primary" disabled={situation.trim().length < 20} onClick={() => void run('')}>
              <Icon name="sparkle" />
              Build my story
            </button>
          </div>
        </div>
        <p className="sb-role-line">
          {roleLabel ? (
            <>
              Tuned for <b>{roleLabel}</b>.{' '}
            </>
          ) : (
            <>Tell us how you build proposals and every story is tuned to your role. </>
          )}
          <Link className="btn-link" to={{ view: 'profile' }}>
            {roleLabel ? 'Change' : 'Set it in My decks'}
          </Link>
        </p>
        {phase === 'error' && (
          <div className="notice danger" role="alert" style={{ marginTop: 16 }}>
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        )}
        <div className="sb-examples">
          <p className="sb-label">Try an example</p>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="sb-example" onClick={() => setSituation(ex)}>
              {ex}
            </button>
          ))}
        </div>
        {loading}
      </div>
    );

  return (
    <div className="sv-wrap sb">
      <BackHome />
      <header className="sb-board-head">
        <div>
          <p className="sb-eyebrow">SlideVault / M Moser Associates</p>
          <h1 className="sb-board-title" tabIndex={-1} ref={headRef}>
            <b>Client-first</b> proposal story
          </h1>
          {story?.summary && <p className="lede muted sb-lede">{story.summary}</p>}
        </div>
        {story && (
          <div className="sb-board-meta">
            <p>
              <span className="sb-accent">{story.reader === 'model' ? 'Read by AI' : 'Standard story order'}</span> · {story.sections.length} parts
              {story.role && <> · For {ROLE_CHOICES.find((c) => c.role === story.role)?.label}</>}
            </p>
            <div className="sb-head-actions">
              <button type="button" className="btn" onClick={addStory}>
                <Icon name="plus" />
                Add the story to the draft deck
              </button>
              <button type="button" className="btn btn-ghost" onClick={startOver}>
                Start over
              </button>
            </div>
          </div>
        )}
      </header>
      {story?.readerNote && (
        <div className="notice info">
          <Icon name="info" />
          <span>{story.readerNote}</span>
        </div>
      )}

      {story && <Board story={story} list={ordered} said={said} onSay={say} />}
      <div className="sb-layout">
        <div className="sb-story" aria-busy={phase === 'building'}>
          {story && (
            <>
              <h2 className="sb-detail-h">Every option, part by part</h2>
              {story.sections.map((s, i) => (
                <Part key={s.role} n={i + 1} section={s} list={ordered} said={said} onSay={say} />
              ))}
            </>
          )}
        </div>
        <ChatPanel chat={chat} busy={phase === 'building'} onSend={reply} />
      </div>
      <p className="sb-board-foot">Slides come from your library and are shown as they are. Proof marked needed has no slide yet.</p>
      {loading}
    </div>
  );
}

/** How long "Understanding your brief" shows before it is ticked off; reading starts the moment the brief is sent. */
const UNDERSTAND_S = 3;
/** How long "Preparing your results" shows once the AI has answered, so the last step is seen. */
const PREPARE_MS = 700;
const LOADING_STEPS = ['Understanding your brief', 'Matching relevant projects', 'Preparing your results'];
/**
 * While a step is the one working, its words change every few seconds, like a person thinking out
 * loud, so a long AI call never looks stuck. Each line says something the storyboard really does.
 */
const STEP_THOUGHTS: string[][] = [
  ['Understanding your brief', 'Picking out what matters to this client'],
  [
    'Matching relevant projects',
    'Reading slides across every deck',
    "Finding the client's story",
    'Weighing proof for each part',
    'Checking Best of the Best',
    'Looking for work like this',
    'Lining up the strongest slides',
    'Still matching relevant projects',
  ],
  ['Preparing your results'],
];
const THOUGHT_S = 3;

/**
 * The loading screen (Schiffon's design, 21 Oct): one calm card while the AI works. The steps
 * follow the real call: the brief is understood first, matching runs for as long as the AI takes,
 * and preparing shows when the answer is back. No percentage: the length of the call is unknown.
 */
/** The working step's changing words, with how long it has been going (screen readers hear the step once). */
function Thought({ step, elapsed }: { step: number; elapsed: number }) {
  const lines = STEP_THOUGHTS[step];
  const since = step === 1 ? Math.max(0, elapsed - UNDERSTAND_S) : elapsed;
  const line = lines[Math.floor(since / THOUGHT_S) % lines.length];
  return (
    <>
      <span className="sr-only">{LOADING_STEPS[step]}</span>
      <span key={line} className="sb-thought" aria-hidden="true">
        {line}…
      </span>
      {step === 1 && elapsed >= 5 && (
        <span className="sb-thought-time" aria-hidden="true">
          {elapsed}s
        </span>
      )}
    </>
  );
}

/** The Storyboard opens from beside the search bar, not a tab, so it says how to get back. */
function BackHome() {
  return (
    <Link className="btn-link sb-back" to={{ view: 'pages' }}>
      <Icon name="back" className="ic-sm" />
      Back to Home
    </Link>
  );
}

function LoadingDialog({ elapsed, preparing, onClose }: { elapsed: number; preparing: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  const active = preparing ? 2 : elapsed < UNDERSTAND_S ? 0 : 1;
  return (
    <div className="sb-load-backdrop">
      <div
        className="sb-load"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sb-load-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="sb-load-head">
          <span className="sb-load-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 7v14" />
              <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
            </svg>
          </span>
          <span className="sb-load-brand">
            <b>SlideVault</b>
            <span>Proposal library</span>
          </span>
          <button ref={closeRef} type="button" className="sb-load-close" aria-label="Stop and close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="sb-load-body">
          <span className="sb-load-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 10c0-2.5 3.4-4 7.5-4s7.5 1.5 7.5 4z" />
              <path d="M4.5 13.5h15" />
              <path d="M4.5 17h15" />
            </svg>
          </span>
          <h2 id="sb-load-title" className="sb-load-title">
            Finding the right slides
          </h2>
          <p className="sb-load-sub">Looking across projects for the ideas that fit your brief.</p>
          <span className="sb-load-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <p className="sb-load-working">Working on your search...</p>
        </div>
        <ol className="sb-load-steps">
          {LOADING_STEPS.map((label, i) => (
            <li key={label} className={i < active ? 'is-done' : i === active ? 'is-active' : 'is-todo'} aria-current={i === active ? 'step' : undefined}>
              <span className="sb-load-step-ic" aria-hidden="true">
                {i < active && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="m8.5 12 2.5 2.5 4.5-5" />
                  </svg>
                )}
              </span>
              <span className="sr-only">{i < active ? 'Done: ' : i === active ? 'Now: ' : 'Next: '}</span>
              {i === active ? <Thought step={i} elapsed={elapsed} /> : label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

type Say = (role: StoryRole, slideId: string | null, verdict: StoryFeedbackVerdict) => void;

/**
 * The story as a board (Schiffon's "Proof-led proposal story" design): one framed card per part,
 * in order, its lead slide as the picture, then the part's number, heading, what it must show,
 * where the slide came from, and Useful / Not right / No match. A part with no slide shows the
 * "proof needed" frame.
 */
function Board({ story, list, said, onSay }: { story: StoryboardResult; list: SlideSummary[]; said: Record<string, StoryFeedbackVerdict>; onSay: Say }) {
  const total = two(story.sections.length);
  return (
    <ol className="sb-board">
      {story.sections.map((s, i) => (
        <BoardCard key={s.role} n={i + 1} total={total} section={s} list={list} said={said} onSay={onSay} />
      ))}
    </ol>
  );
}

function BoardCard({ n, total, section, list, said, onSay }: { n: number; total: string; section: StoryboardSection; list: SlideSummary[]; said: Record<string, StoryFeedbackVerdict>; onSay: Say }) {
  const { openPreview } = useWorkspace();
  const { isSelected, set } = useCartToggle();
  const lead = section.items[0];
  const verdict = lead ? said[`${section.role}:${lead.slide.id}`] : undefined;
  const none = said[`${section.role}:_part`];
  const picked = lead ? isSelected(lead.slide.id) : false;
  return (
    <li className="sb-card">
      <div className="sb-frame">
        <div className="sb-frame-top">
          <span>{section.label}</span>
          <span className="sb-accent">MM / SV</span>
        </div>
        {lead ? (
          <button
            type="button"
            className="sb-frame-pic"
            aria-label={`Preview: ${lead.slide.title}`}
            onClick={() => openPreview(list, Math.max(0, list.findIndex((x) => x.id === lead.slide.id)))}
          >
            <Thumb slide={lead.slide} />
          </button>
        ) : (
          <div className="sb-frame-pic sb-frame-gap" aria-label="Proof needed: no slide yet">
            <span>
              Proof
              <br />
              needed
            </span>
          </div>
        )}
        <div className="sb-frame-bottom">
          <span>SlideVault / Storyboard</span>
          <span>
            {two(n)} — {total}
          </span>
        </div>
      </div>
      <h3 className="sb-card-title">
        <span className="sb-n">{two(n)}</span> {section.title}
      </h3>
      <p className="sb-card-need">{section.need}</p>
      {lead && (
        <p className="sb-card-why">
          <b>Why this slide:</b> {lead.why || 'It does this part’s job in the library’s words.'}
          <br />
          <span className="muted">
            From {lead.slide.provenance.sourceTitle}, slide {lead.slide.provenance.slideNumber}
          </span>
        </p>
      )}
      {/* What kind of evidence the lead slide is: about this client's brief, or a fit for this part of any story */}
      <p className={`sb-tag${section.gap ? ' is-needed' : ''}`}>{section.gap ? 'Proof needed' : lead?.reasons.brief.length ? 'Matches the brief' : 'Fits the story'}</p>
      {lead && (
        <div className="sb-card-actions">
          <button type="button" className={`sb-chip${picked ? ' is-on' : ''}`} aria-pressed={picked} onClick={() => set(lead.slide, !picked)}>
            {picked ? 'In draft deck' : '+ Add'}
          </button>
          {verdict || none ? (
            <span className="sb-thanks">{none ? 'Noted: no match.' : verdict === 'useful' ? 'Marked useful.' : 'Noted: not right.'}</span>
          ) : (
            <>
              <button type="button" className="sb-chip" onClick={() => onSay(section.role, lead.slide.id, 'useful')}>
                Useful
              </button>
              <button type="button" className="sb-chip" onClick={() => onSay(section.role, lead.slide.id, 'not-right')}>
                Not right
              </button>
              <button type="button" className="sb-chip" onClick={() => onSay(section.role, null, 'nothing-fits')}>
                No match
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Part({ n, section, list, said, onSay }: { n: number; section: StoryboardSection; list: SlideSummary[]; said: Record<string, StoryFeedbackVerdict>; onSay: Say }) {
  return (
    <section className="sb-part" aria-labelledby={`sb-p${n}`}>
      <div className="sb-part-head">
        <span className="sb-n">{two(n)}</span>
        <span className="sb-label">{section.label}</span>
      </div>
      <h3 className="h2 sb-part-title" id={`sb-p${n}`}>
        {section.title}
      </h3>
      <p className="sb-need">
        <b>This part must show:</b> {section.need.replace(/^Show /, '').replace(/\.$/, '')}.
      </p>
      {section.gap ? (
        <div className="sb-gap">
          <Icon name="alert" />
          <div>
            <b>Proof needed</b>
            <p>No slide in the library proves this part yet. A new slide is needed here.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid sb-grid">
            {section.items.map(({ slide, why }) => (
              <div key={slide.id} className="sb-item">
                <SlideCard slide={slide} list={list} why={why} />
                <p className="sb-from">
                  <Icon name="file" className="ic-sm" />
                  <span>
                    From <b>{slide.provenance.sourceTitle}</b>, slide {slide.provenance.slideNumber}
                  </span>
                </p>
                <Feedback verdict={said[`${section.role}:${slide.id}`]} onSay={(v) => onSay(section.role, slide.id, v)} />
              </div>
            ))}
          </div>
          {said[`${section.role}:_part`] ? (
            <p className="sb-thanks">Thanks. We&apos;ll look for better proof for this part.</p>
          ) : (
            <button type="button" className="btn btn-link sb-none" onClick={() => onSay(section.role, null, 'nothing-fits')}>
              None of these fit this part
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Feedback({ verdict, onSay }: { verdict?: StoryFeedbackVerdict; onSay: (v: StoryFeedbackVerdict) => void }) {
  if (verdict) return <p className="sb-thanks">{verdict === 'useful' ? 'Marked useful. Thanks.' : 'Noted. It will rank lower for briefs like this.'}</p>;
  return (
    <div className="sb-feedback" role="group" aria-label="Right for this part of the story?">
      <span>Right for this part?</span>
      <button type="button" className="btn btn-xs" onClick={() => onSay('useful')}>
        <Icon name="check" className="ic-sm" />
        Useful
      </button>
      <button type="button" className="btn btn-xs btn-ghost" onClick={() => onSay('not-right')}>
        <Icon name="x" className="ic-sm" />
        Not right
      </button>
    </div>
  );
}

function ChatPanel({ chat, busy, onSend }: { chat: Chat[]; busy: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [chat.length]);
  const send = () => {
    onSend(text);
    setText('');
  };
  return (
    <aside className="sb-chat" aria-label="Talk to the storyboard">
      <p className="sb-label">Talk to the storyboard</p>
      <div className="sb-msgs" aria-live="polite">
        {chat.length === 0 && <p className="muted">The AI&apos;s questions will appear here.</p>}
        {chat.map((m, i) => (
          <p key={i} className={`sb-msg sb-msg-${m.who}`}>
            {m.text}
          </p>
        ))}
        {busy && chat.length > 0 && <p className="sb-msg sb-msg-ai sb-typing" aria-label="Working">…</p>}
        <div ref={end} />
      </div>
      <div className="sb-chat-row">
        <label htmlFor="sb-reply" className="sr-only">
          Your answer
        </label>
        <textarea
          id="sb-reply"
          rows={2}
          value={text}
          disabled={busy}
          placeholder="Answer, or tell it more…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <MicButton onText={(t) => onSend(t)} disabled={busy} />
        <button type="button" className="btn btn-primary btn-icon" aria-label="Send" disabled={busy || !text.trim()} onClick={send}>
          <Icon name="right" />
        </button>
      </div>
    </aside>
  );
}

/** Talk instead of type: records on this device and sends it only to the app's own speech service. */
function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const { runtime, toast } = useWorkspace();
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<'idle' | 'listening' | 'hearing'>('idle');
  const rec = useRef<Recording | null>(null);
  useEffect(() => {
    void speechAvailable(runtime).then(setAvailable);
    return () => rec.current?.cancel();
  }, [runtime]);
  if (!available) return null;

  async function toggle() {
    if (state === 'listening' && rec.current) {
      setState('hearing');
      try {
        const text = await transcribe(runtime, await rec.current.stop());
        if (text) onText(text);
        else toast("Didn't catch that. Try again a little closer to the mic.");
      } catch (e) {
        toast((e as Error).message);
      } finally {
        rec.current = null;
        setState('idle');
      }
      return;
    }
    try {
      rec.current = await startRecording(() => void toggle());
      setState('listening');
    } catch {
      toast('The microphone is blocked. Allow it in the browser to talk instead of type.');
    }
  }

  return (
    <button
      type="button"
      className={`btn sb-mic${state === 'listening' ? ' is-on' : ''}`}
      aria-pressed={state === 'listening'}
      disabled={disabled || state === 'hearing'}
      onClick={() => void toggle()}
    >
      <Icon name={state === 'hearing' ? 'spinner' : 'mic'} />
      {state === 'listening' ? 'Listening… tap to stop' : state === 'hearing' ? 'Writing it down…' : 'Talk'}
    </button>
  );
}

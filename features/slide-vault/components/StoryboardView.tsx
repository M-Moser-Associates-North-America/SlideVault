'use client';

import { useEffect, useRef, useState } from 'react';
import type { SlideSummary, StoryBeat, StoryboardResult, StoryFeedbackVerdict, StoryRole } from '../contracts/dto';
import { buildStory, sendStoryFeedback, speechAvailable, transcribe } from '../client/api';
import { ROLE_CHOICES, useStoryRole } from '../client/role-store';
import { takeHandedOffBrief } from '../client/story-handoff';
import { useSavedStories } from '../client/story-store';
import { startRecording, type Recording } from '../client/wav-recorder';
import { Icon } from './icons';
import { Link, Thumb } from './parts';
import { useWorkspace } from './state';
import './storyboard.css';

/**
 * Storyboard (docs/DECISIONS.md FD-22, FD-24, FD-30; Schiffon's design, 23 Oct): a client's brief
 * in, the client's story out, told slide by slide like the deck it will become. The parts of the
 * story (challenge, approach, proof...) only order it behind the scenes; the page shows the story:
 * a title, then each beat's slide, what it matches in the brief, what to say and why it is there.
 * Clicking a slide shows every other slide behind that beat. Keep, swap and remove teach the next
 * storyboard for a similar brief.
 */

const EXAMPLES = [
  { label: 'Three campuses merging', brief: 'A hospital group is merging three campuses. Clinical staff are burnt out, and the board worries about cost overruns after a failed project last year. We need a proposal outline that tells one story across all three sites.' },
  { label: 'Law firm moving floors', brief: 'A law firm is moving floors because half its lawyers now work from home. The RFP asks for firm history, process, team CVs, case studies and fees.' },
  { label: 'Two offices into one', brief: 'A bank is consolidating two offices into one. The CFO wants savings; staff are worried about losing their own desks.' },
];

const two = (n: number) => String(n).padStart(2, '0');

export function StoryboardView() {
  const { runtime, updateSelection, toast, announce, profile } = useWorkspace();
  const { role, setRole } = useStoryRole(profile);
  // A brief typed in search arrives here when the person chose "Build a story instead".
  const [situation, setSituation] = useState(() => takeHandedOffBrief() ?? '');
  const [phase, setPhase] = useState<'start' | 'building' | 'ready' | 'error'>('start');
  const [error, setError] = useState('');
  const [story, setStory] = useState<StoryboardResult | null>(null);
  const [beats, setBeats] = useState<StoryBeat[]>([]);
  const [answers, setAnswers] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const { stories: saved, save } = useSavedStories(profile);
  /** What the person said about each slide in this story, keyed "role:slideId" */
  const [said, setSaid] = useState<Record<string, StoryFeedbackVerdict>>({});
  const before = useRef<'start' | 'ready'>('start');
  const abort = useRef<AbortController | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (phase !== 'building') return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  function say(role: StoryRole, slideId: string, verdict: StoryFeedbackVerdict) {
    if (!story) return;
    setSaid((cur) => ({ ...cur, [`${role}:${slideId}`]: verdict }));
    sendStoryFeedback(runtime, { role, slideId, verdict, topics: story.topics, by: story.role }).catch(() => toast("Couldn't save that. Please try again."));
  }

  function show(result: StoryboardResult) {
    setStory(result);
    setBeats(result.beats);
    setSaid({});
    setPhase('ready');
    requestAnimationFrame(() => headRef.current?.focus());
  }

  async function run(withAnswers: string) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    before.current = story ? 'ready' : 'start';
    setElapsed(0);
    setPhase('building');
    announce('Composing your story. This can take a couple of minutes.');
    try {
      const result = await buildStory(runtime, situation.trim(), { read: true, answers: withAnswers, role }, controller.signal);
      if (controller.signal.aborted) return;
      show(result);
      save({ at: Date.now(), brief: situation.trim(), result });
      announce(`Story ready: ${result.title}.`);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError((e as Error).message);
      setPhase('error');
    }
  }

  function sharpen(text: string) {
    const t = text.trim();
    if (!t) return;
    const all = [answers, t].filter(Boolean).join('\n');
    setAnswers(all);
    void run(all);
  }

  function cancel() {
    abort.current?.abort();
    setPhase(before.current);
    announce('Stopped.');
  }

  function startOver() {
    abort.current?.abort();
    setStory(null);
    setBeats([]);
    setAnswers('');
    setPhase('start');
  }

  function addStory() {
    const leads = beats.map((b) => b.lead.slide);
    updateSelection((cur) => [...cur, ...leads.filter((l) => !cur.some((c) => c.id === l.id))]);
    toast(`Added the story's ${leads.length} slides to the draft deck, in story order`);
  }

  /** Lead the beat with another of its slides: the old lead was not right here, the new one is. */
  function swap(i: number, to: SlideSummary) {
    const beat = beats[i];
    const next = beat.more.find((m) => m.slide.id === to.id);
    if (!next) return;
    say(beat.role, beat.lead.slide.id, 'not-right');
    say(beat.role, to.id, 'useful');
    setBeats((cur) => cur.map((b, j) => (j === i ? { ...b, lead: next, more: [b.lead, ...b.more.filter((m) => m !== next)] } : b)));
  }

  function remove(i: number) {
    const beat = beats[i];
    say(beat.role, beat.lead.slide.id, 'not-right');
    setBeats((cur) => cur.filter((_, j) => j !== i));
    announce(`Removed “${beat.title}” from the story.`);
  }

  if (phase === 'building') return <Composing elapsed={elapsed} onStop={cancel} />;

  if (phase !== 'ready' || !story)
    return (
      <div className="sv-wrap sb">
        <BackHome />
        <p className="sb-eyebrow">Storyboard</p>
        <h1 className="h1 sb-title" tabIndex={-1}>
          Start with the client, not the archive.
        </h1>
        <p className="lede muted sb-lede">Describe the client&apos;s situation: paste the brief, your notes or an outline, or just talk. SlideVault tells their story with your own slides.</p>
        <div className="sb-compose">
          <label htmlFor="sb-situation" className="sr-only">
            The client&apos;s situation
          </label>
          <textarea id="sb-situation" value={situation} onChange={(e) => setSituation(e.target.value)} rows={5} placeholder="Who is the client, what's happening, what worries them, and what would a win look like?" />
          <div className="sb-compose-row">
            <MicButton onText={(t) => setSituation((s) => [s.trim(), t].filter(Boolean).join(' '))} />
            {/* The same setting as in My decks (FD-25), picked right here. */}
            <p className="sb-role-line">
              <label htmlFor="sb-role-pick">Tuned for</label>{' '}
              <select id="sb-role-pick" className="sb-role-pick" value={role ?? ''} onChange={(e) => setRole((e.target.value || null) as typeof role)}>
                <option value="">Everyone</option>
                {ROLE_CHOICES.map((c) => (
                  <option key={c.role} value={c.role}>
                    {c.label}
                  </option>
                ))}
              </select>
            </p>
          </div>
        </div>
        <div className="sb-start-row">
          <div className="sb-chips" role="group" aria-label="Try an example">
            {EXAMPLES.map((ex) => (
              <button key={ex.label} type="button" className="sb-chip" aria-pressed={situation === ex.brief} onClick={() => setSituation(ex.brief)}>
                {ex.label}
              </button>
            ))}
          </div>
          <button type="button" className="sb-pull" disabled={situation.trim().length < 20} onClick={() => void run('')}>
            Pull the story <Icon name="right" className="ic-sm" />
          </button>
        </div>
        {phase === 'error' && (
          <div className="notice danger" role="alert" style={{ marginTop: 16 }}>
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        )}
        {saved.length > 0 && (
          <section className="sb-stories" aria-labelledby="sb-stories-h">
            <h2 className="sb-label" id="sb-stories-h">
              Stories
            </h2>
            <ul>
              {saved.map((s) => (
                <li key={s.at}>
                  <button
                    type="button"
                    className="sb-story-link"
                    onClick={() => {
                      setSituation(s.brief);
                      show(s.result);
                    }}
                  >
                    <span className="sb-story-name">{s.result.title}</span>
                    <span className="sb-story-sub">{s.result.summary}</span>
                    <span className="sb-story-count">{s.result.beats.reduce((n, b) => n + 1 + b.more.length, 0)} slides</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );

  const deck = beats.flatMap((b) => [b.lead.slide, ...b.more.map((m) => m.slide)]);
  return (
    <div className="sv-wrap sb">
      <BackHome />
      <header className="sb-story-head">
        <h1 className="sb-story-title" tabIndex={-1} ref={headRef}>
          {story.title}
        </h1>
        {story.summary && !story.summary.startsWith(story.title.replace(/…$/, '')) && <p className="sb-story-summary">{story.summary}</p>}
        <div className="sb-head-actions">
          <button type="button" className="sb-add" onClick={addStory}>
            <Icon name="plus" className="ic-sm" />
            Add the story to the draft deck
          </button>
          <button type="button" className="sb-text-btn" onClick={startOver}>
            Start over
          </button>
        </div>
      </header>
      {story.readerNote && (
        <div className="notice info">
          <Icon name="info" />
          <span>{story.readerNote}</span>
        </div>
      )}
      <ol className="sb-beats">
        {beats.map((b, i) => (
          <Beat key={`${b.role}:${b.lead.slide.id}`} n={i + 1} beat={b} deck={deck} said={said} onKeep={() => say(b.role, b.lead.slide.id, 'useful')} onSwap={(to) => swap(i, to)} onRemove={() => remove(i)} />
        ))}
      </ol>
      {beats.length === 0 && <p className="muted">Every slide was removed. Start over, or tell it more below.</p>}
      <Sharpen questions={story.questions} onSend={sharpen} />
    </div>
  );
}

/** One moment of the story: its slide large, what it matches, what to say, and why it's here. */
function Beat({ n, beat, deck, said, onKeep, onSwap, onRemove }: { n: number; beat: StoryBeat; deck: SlideSummary[]; said: Record<string, StoryFeedbackVerdict>; onKeep: () => void; onSwap: (to: SlideSummary) => void; onRemove: () => void }) {
  const { openPreview } = useWorkspace();
  const [open, setOpen] = useState(false);
  const { lead, more } = beat;
  const kept = said[`${beat.role}:${lead.slide.id}`] === 'useful';
  const preview = (s: SlideSummary) => openPreview(deck, Math.max(0, deck.findIndex((x) => x.id === s.id)));
  const id = `sb-beat-${n}`;
  return (
    <li className="sb-beat" aria-labelledby={id}>
      <h2 className="sb-beat-title" id={id}>
        <span className="sb-n">{two(n)}</span> {beat.title}
      </h2>
      <button
        type="button"
        className="sb-beat-pic"
        aria-expanded={more.length ? open : undefined}
        aria-label={more.length ? `${lead.slide.title}: show the ${more.length} other slides behind this` : `Preview: ${lead.slide.title}`}
        onClick={() => (more.length ? setOpen((o) => !o) : preview(lead.slide))}
      >
        <Thumb slide={lead.slide} />
        {more.length > 0 && <span className="sb-beat-more">+{more.length}</span>}
      </button>
      <div className="sb-beat-caption">
        <span>
          {lead.slide.provenance.sourceTitle}, slide {lead.slide.provenance.slideNumber}
        </span>
        {beat.matches.length > 0 && <span className="sb-accent">Matches {beat.matches.map((m) => `“${m}”`).join(', ')}</span>}
      </div>
      {open && (
        <ul className="sb-beat-set" aria-label="Every slide behind this moment">
          {[lead, ...more].map(({ slide }) => (
            <li key={slide.id}>
              <button type="button" className="sb-set-pic" aria-label={`Preview: ${slide.title}`} onClick={() => preview(slide)}>
                <Thumb slide={slide} />
              </button>
              {slide.id === lead.slide.id ? (
                <span className="sb-set-note">Leading</span>
              ) : (
                <button type="button" className="sb-text-btn" onClick={() => onSwap(slide)}>
                  Lead with this
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {beat.narration && <p className="sb-beat-say">{beat.narration}</p>}
      <p className="sb-beat-why">
        <b>Why this slide</b> — {beat.why}
      </p>
      <div className="sb-beat-actions">
        <button type="button" className="sb-icon-btn" aria-pressed={kept} onClick={onKeep} disabled={kept}>
          <Icon name="check" className="ic-sm" />
          {kept ? 'Kept' : 'Keep'}
        </button>
        {more.length > 0 && (
          <button type="button" className="sb-icon-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <Icon name="swap" className="ic-sm" />
            Swap
          </button>
        )}
        <button type="button" className="sb-icon-btn" onClick={onRemove}>
          <Icon name="x" className="ic-sm" />
          Remove
        </button>
      </div>
    </li>
  );
}

/** What the story doesn't know yet; answering rebuilds it. Typed or spoken. */
function Sharpen({ questions, onSend }: { questions: string[]; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const send = () => {
    onSend(text);
    setText('');
  };
  return (
    <section className="sb-sharpen" aria-labelledby="sb-sharpen-h">
      <h2 className="sb-label" id="sb-sharpen-h">
        Make it sharper
      </h2>
      {questions.length > 0 && (
        <ul className="sb-questions">
          {questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      )}
      <div className="sb-sharpen-row">
        <label htmlFor="sb-reply" className="sr-only">
          Tell it more about the client
        </label>
        <textarea
          id="sb-reply"
          rows={2}
          value={text}
          placeholder="Answer, or tell it more about the client…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <MicButton onText={onSend} />
        <button type="button" className="btn btn-primary btn-icon" aria-label="Rebuild the story" disabled={!text.trim()} onClick={send}>
          <Icon name="right" />
        </button>
      </div>
    </section>
  );
}

/**
 * While the story is composed: the steps the storyboard really takes, in order, ticked off as the
 * usual time for each passes; the last stays open until the story is back. No percentage: how long
 * the AI takes is unknown, so the time so far is shown instead.
 */
const STEPS: { label: string; until: number }[] = [
  { label: 'Reading the brief', until: 4 },
  { label: 'Searching the archive', until: 10 },
  { label: 'Matching slides to the brief', until: 40 },
  { label: 'Sequencing the story', until: 70 },
  { label: 'Writing the narration', until: Infinity },
];
function Composing({ elapsed, onStop }: { elapsed: number; onStop: () => void }) {
  const active = STEPS.findIndex((s) => elapsed < s.until);
  const stopRef = useRef<HTMLButtonElement>(null);
  useEffect(() => stopRef.current?.focus(), []);
  return (
    <div className="sv-wrap sb">
      <BackHome />
      <section className="sb-composing" aria-labelledby="sb-composing-h" aria-busy="true" onKeyDown={(e) => e.key === 'Escape' && onStop()}>
        <p className="sb-eyebrow">Composing</p>
        <h1 className="sb-composing-title" id="sb-composing-h" aria-live="polite">
          {STEPS[active].label}
        </h1>
        <ol className="sb-steps">
          {STEPS.map((s, i) => (
            <li key={s.label} className={i < active ? 'is-done' : i === active ? 'is-active' : 'is-todo'} aria-current={i === active ? 'step' : undefined}>
              <span className="sb-step-n">{two(i + 1)}</span>
              <span className="sb-step-label">{s.label}</span>
              <span className="sb-step-state">{i < active ? 'Done' : i === active ? '…' : ''}</span>
            </li>
          ))}
        </ol>
        <div className="sb-progress" aria-hidden="true">
          <i style={{ width: `${((active + 0.5) / STEPS.length) * 100}%` }} />
        </div>
        <div className="sb-composing-foot">
          <span>{elapsed}s · usually about two minutes</span>
          <button ref={stopRef} type="button" className="sb-text-btn" onClick={onStop}>
            Stop
          </button>
        </div>
      </section>
    </div>
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

/** Talk instead of type: records on this device and sends it only to the app's own speech service. Icon only. */
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

  const label = state === 'listening' ? 'Listening: tap to stop' : state === 'hearing' ? 'Writing it down' : 'Talk instead of typing';
  return (
    <button type="button" className={`btn btn-icon sb-mic${state === 'listening' ? ' is-on' : ''}`} aria-label={label} title={label} aria-pressed={state === 'listening'} disabled={disabled || state === 'hearing'} onClick={() => void toggle()}>
      <Icon name={state === 'hearing' ? 'spinner' : 'mic'} />
    </button>
  );
}

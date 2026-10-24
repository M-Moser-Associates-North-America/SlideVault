'use client';

import { useEffect, useRef, useState } from 'react';
import type { SlideSummary, StoryBeat, StoryboardResult, StoryFeedbackVerdict, StoryRole } from '../contracts/dto';
import { buildStory, sendStoryFeedback, speechAvailable, transcribe } from '../client/api';
import { ROLE_CHOICES, useStoryRole } from '../client/role-store';
import { takeHandedOffBrief } from '../client/story-handoff';
import { useSavedStories } from '../client/story-store';
import { startRecording, type Recording } from '../client/wav-recorder';
import { Icon } from './icons';
import { plural } from './library';
import { Link, Thumb } from './parts';
import { useWorkspace } from './state';
import './storyboard.css';

/**
 * Storyboard (docs/DECISIONS.md FD-22, FD-24, FD-30; Schiffon's design, 23 Oct): a client's brief
 * in, the client's story out, told slide by slide like the deck it will become. The parts of the
 * story (challenge, approach, proof...) only order it behind the scenes; the page shows the story:
 * a title, then each beat's slide, what it matches in the brief, what to say and why it is there.
 * The "+2" on a slide opens the slides behind that beat. Useful / Not useful teach the next
 * storyboard for a similar brief.
 */

const two = (n: number) => String(n).padStart(2, '0');

export function StoryboardView() {
  const { runtime, updateSelection, toast, announce, profile } = useWorkspace();
  const { role, setRole } = useStoryRole(profile);
  // A brief typed in search arrives here when the person chose "Build a story instead".
  const [situation, setSituation] = useState(() => takeHandedOffBrief() ?? '');
  const [phase, setPhase] = useState<'start' | 'building' | 'ready' | 'error'>('start');
  const [error, setError] = useState('');
  const [story, setStory] = useState<StoryboardResult | null>(null);
  const [answers, setAnswers] = useState('');
  const [elapsed, setElapsed] = useState(0);
  // Stories are kept per person for later; the start page stays simple, so they aren't listed here.
  const { save } = useSavedStories(profile);
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
    setSaid({});
    setPhase('ready');
    requestAnimationFrame(() => headRef.current?.focus());
  }

  async function run(withAnswers: string, mode?: 'retrieve' | 'reimagine') {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    before.current = story ? 'ready' : 'start';
    setElapsed(0);
    setPhase('building');
    announce('Composing your story. This can take a couple of minutes.');
    try {
      const result = await buildStory(runtime, situation.trim(), { read: true, answers: withAnswers, role, mode }, controller.signal);
      if (controller.signal.aborted) return;
      show(result);
      if (result.mode !== 'retrieve') save({ at: Date.now(), brief: situation.trim(), result });
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
    setAnswers('');
    setPhase('start');
  }

  function addStory() {
    // A new story adds each beat's lead slide; a retold deck (FD-32) adds every slide, in the deck's own order.
    const byPage = (a: SlideSummary, b: SlideSummary) => (a.provenance.sourceId === b.provenance.sourceId ? a.provenance.slideNumber - b.provenance.slideNumber : 0);
    const picked = !story ? [] : story.mode === 'reimagine' ? story.beats.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide).sort(byPage)) : story.beats.map((b) => b.lead.slide);
    updateSelection((cur) => [...cur, ...picked.filter((l) => !cur.some((c) => c.id === l.id))]);
    toast(`Added the story's ${picked.length} slides to the draft deck, in story order`);
  }

  if (phase === 'building') return <Composing elapsed={elapsed} onStop={cancel} />;

  if (phase !== 'ready' || !story)
    return (
      <div className="sv-wrap sb">
        <BackHome />
        <p className="sb-eyebrow">Storyboard</p>
        <h1 className="sb-board-title" tabIndex={-1}>
          <b>Start with the client,</b> not the archive.
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
            <button type="button" className="sb-pull" disabled={situation.trim().length < 20} onClick={() => void run('')}>
              Pull the story
              <Icon name="right" className="ic-sm" />
            </button>
          </div>
        </div>
        {phase === 'error' && (
          <div className="notice danger" role="alert" style={{ marginTop: 16 }}>
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        )}
      </div>
    );

  // An existing deck asked for as it was (FD-31): open it whole, or tell its story better.
  if (story.mode === 'retrieve' && story.deck)
    return (
      <div className="sv-wrap sb">
        <BackHome />
        <header className="sb-story-head">
          <p className="sb-eyebrow">From your library</p>
          <h1 className="sb-board-title" tabIndex={-1} ref={headRef}>
            {story.deck.title}
          </h1>
          <p className="sb-story-summary">The original deck, as it was saved: {plural(story.deck.slideCount, 'slide')}.</p>
          <div className="sb-head-actions">
            <Link className="sb-add" to={{ view: 'deck', id: story.deck.id }}>
              Open the original
            </Link>
            <button type="button" className="sb-add" onClick={() => void run(answers, 'reimagine')}>
              <Icon name="sparkle" className="ic-sm" />
              Tell its story better
            </button>
            <button type="button" className="sb-text-btn" onClick={startOver}>
              Start over
            </button>
          </div>
        </header>
      </div>
    );
  const beats = story.beats;
  const deck = beats.flatMap((b) => [b.lead.slide, ...b.more.map((m) => m.slide)]);
  return (
    <div className="sv-wrap sb">
      <BackHome />
      <header className="sb-story-head">
        <h1 className="sb-board-title" tabIndex={-1} ref={headRef}>
          {story.title}
        </h1>
        {/* The story in one line: what every beat below is building towards */}
        {story.thesis ? (
          <p className="sb-story-summary sb-thesis">{story.thesis}</p>
        ) : (
          story.summary && !story.summary.startsWith(story.title.replace(/…$/, '')) && <p className="sb-story-summary">{story.summary}</p>
        )}
        {story.context && story.context.length > 0 && (
          <p className="sb-story-from">
            Using what we already made for them:{' '}
            {story.context.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ', '}
                <Link to={{ view: 'deck', id: d.id }}>{d.title}</Link>
              </span>
            ))}
            .
          </p>
        )}
        {story.mode === 'reimagine' && story.deck && (
          <p className="sb-story-from">
            Retold from <Link to={{ view: 'deck', id: story.deck.id }}>{story.deck.title}</Link>, using all {story.deck.slideCount} of its slides.
          </p>
        )}
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
          <Beat key={`${b.role}:${b.lead.slide.id}`} n={i + 1} beat={b} deck={deck} said={said} onSay={(id, v) => say(b.role, id, v)} />
        ))}
      </ol>
      <Sharpen questions={story.questions} onSend={sharpen} />
    </div>
  );
}

/**
 * One moment of the story: its slide large, what it matches, what to say, and why it's here. The
 * slides behind it open from the "+2" on the picture. Useful / Not useful on any of them teaches the
 * next storyboard for a similar brief (FD-24).
 */
function Beat({ n, beat, deck, said, onSay }: { n: number; beat: StoryBeat; deck: SlideSummary[]; said: Record<string, StoryFeedbackVerdict>; onSay: (slideId: string, v: StoryFeedbackVerdict) => void }) {
  const { openPreview } = useWorkspace();
  const [open, setOpen] = useState(false);
  const { lead, more } = beat;
  const preview = (s: SlideSummary) => openPreview(deck, Math.max(0, deck.findIndex((x) => x.id === s.id)));
  const id = `sb-beat-${n}`;
  const verdict = (slideId: string) => said[`${beat.role}:${slideId}`];
  return (
    <li className={`sb-beat${beat.kind ? ` is-${beat.kind}` : ''}`} aria-labelledby={id}>
      {/* Retold decks (FD-32): pages kept as the original had them, and slides offered from other decks */}
      {beat.kind && <p className="sb-kind">{beat.kind === 'required' ? 'Kept as is' : 'Suggested addition'}</p>}
      {beat.bridge && <p className="sb-bridge">{beat.bridge}</p>}
      <h2 className="sb-beat-title" id={id}>
        <span className="sb-n">{two(n)}</span> {beat.title}
      </h2>
      <div className="sb-beat-frame">
        <button type="button" className="sb-beat-pic" aria-label={`Preview: ${lead.slide.title}`} onClick={() => preview(lead.slide)}>
          <Thumb slide={lead.slide} />
        </button>
        {more.length > 0 && (
          <button type="button" className="sb-beat-more" aria-expanded={open} aria-label={open ? 'Hide the other slides' : `Show ${more.length} more slides`} onClick={() => setOpen((o) => !o)}>
            +{more.length}
          </button>
        )}
      </div>
      <div className="sb-beat-caption">
        <span>
          {lead.slide.provenance.sourceTitle}, slide {lead.slide.provenance.slideNumber}
        </span>
        {beat.matches.length > 0 && <span className="sb-accent">Matches {beat.matches.map((m) => `“${m}”`).join(', ')}</span>}
      </div>
      <Verdict value={verdict(lead.slide.id)} onSay={(v) => onSay(lead.slide.id, v)} />
      {open && (
        <ul className="sb-beat-set" aria-label="More slides for this moment">
          {more.map(({ slide }) => (
            <li key={slide.id}>
              <button type="button" className="sb-set-pic" aria-label={`Preview: ${slide.title}`} onClick={() => preview(slide)}>
                <Thumb slide={slide} />
              </button>
              <Verdict value={verdict(slide.id)} onSay={(v) => onSay(slide.id, v)} small />
            </li>
          ))}
        </ul>
      )}
      {beat.narration && <p className="sb-beat-say">{beat.narration}</p>}
      <p className="sb-beat-why">
        <b>Why this slide</b> — {beat.why}
      </p>
    </li>
  );
}

/** Useful / Not useful on one slide; once said, it stays said for this story. */
function Verdict({ value, onSay, small }: { value?: StoryFeedbackVerdict; onSay: (v: StoryFeedbackVerdict) => void; small?: boolean }) {
  return (
    <div className={`sb-verdict${small ? ' is-small' : ''}`} role="group" aria-label="Was this slide useful?">
      <button type="button" className="sb-icon-btn" aria-pressed={value === 'useful'} disabled={!!value} onClick={() => onSay('useful')}>
        <Icon name="check" className="ic-sm" />
        Useful
      </button>
      <button type="button" className="sb-icon-btn" aria-pressed={value === 'not-right'} disabled={!!value} onClick={() => onSay('not-right')}>
        <Icon name="x" className="ic-sm" />
        Not useful
      </button>
    </div>
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

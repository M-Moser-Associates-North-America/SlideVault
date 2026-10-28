'use client';

import { useEffect, useRef, useState } from 'react';
import type { SlideSummary, StoryBeat, StoryboardResult, StoryFeedbackVerdict, StoryRole } from '../contracts/dto';
import { buildStory, refineStory, sendStoryFeedback } from '../client/api';
import { ROLE_CHOICES, useStoryRole } from '../client/role-store';
import { takeHandedOffBrief } from '../client/story-handoff';
import { useSavedStories } from '../client/story-store';
import { Icon } from './icons';
import { plural } from './library';
import { MicButton } from './MicButton';
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
  // Pull the story always looks ready (like the Storyboard button on Home); too short a brief says so instead.
  const [tooShort, setTooShort] = useState(false);
  const situationRef = useRef<HTMLTextAreaElement>(null);
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
  const toldNotSaved = useRef(false);
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
    sendStoryFeedback(runtime, { role, slideId, verdict, topics: story.topics, by: story.role })
      .then(({ saved }) => {
        // Said once per story: with learning off, the mark shows but teaches nothing (FD-37).
        if (!saved && !toldNotSaved.current) {
          toldNotSaved.current = true;
          toast('Not saved: learning from your activity is off. You can turn it on in Settings.');
        }
      })
      .catch(() => toast("Couldn't save that. Please try again."));
  }

  /** The conversation about the story on screen (FD-43): what you said and what it did */
  const [chat, setChat] = useState<{ who: 'you' | 'app'; text: string }[]>([]);
  const [talking, setTalking] = useState(false);

  function show(result: StoryboardResult) {
    setStory(result);
    setSaid({});
    setChat([]);
    setPhase('ready');
    requestAnimationFrame(() => headRef.current?.focus());
  }

  async function run(withAnswers: string, mode?: 'retrieve' | 'reimagine' | 'build') {
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

  /** A message about the story on screen: it continues the story, keeping the slides marked Useful. */
  async function talk(text: string) {
    const t = text.trim();
    if (!t || !story || talking) return;
    setChat((c) => [...c, { who: 'you', text: t }]);
    setTalking(true);
    const pinned = Object.entries(said)
      .filter(([, v]) => v === 'useful')
      .map(([k]) => k.slice(k.indexOf(':') + 1));
    try {
      const result = await refineStory(runtime, {
        situation: situation.trim(),
        message: t,
        pinned,
        role,
        beats: story.beats.map((b) => ({ role: b.role, kind: b.kind, title: b.title, bridge: b.bridge, narration: b.narration, why: b.why, matches: b.matches, slideIds: [b.lead, ...b.more].map((i) => i.slide.id) })),
      });
      if (result.story) setStory(result.story);
      else if (result.beats) setStory({ ...story, beats: result.beats });
      setChat((c) => [...c, { who: 'app', text: result.reply }]);
      announce(result.reply);
    } catch (e) {
      setChat((c) => [...c, { who: 'app', text: (e as Error).message || "Couldn't change the story right now. Please try again." }]);
    } finally {
      setTalking(false);
    }
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
    setChat([]);
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
          <textarea id="sb-situation" ref={situationRef} value={situation} aria-describedby={tooShort ? 'sb-too-short' : undefined} onChange={(e) => {
              setSituation(e.target.value);
              if (e.target.value.trim().length >= 20) setTooShort(false);
            }} rows={5} placeholder="Who is the client, what's happening, what worries them, and what would a win look like?" />
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
            {/* Clear like Tuned for beside it; lights up orange as Start planning story on hover, focus and tap. */}
            <button type="button" className="sb-pull" aria-label="Pull the story" onClick={() => {
                if (situation.trim().length < 20) {
                  setTooShort(true);
                  situationRef.current?.focus();
                  return;
                }
                void run('');
              }}>
              <span className="sb-pull-swap" aria-hidden="true">
                <span className="sb-pull-1">Pull the story</span>
                <span className="sb-pull-2">Start planning story</span>
              </span>
              <Icon name="right" className="ic-sm" />
            </button>
          </div>
        </div>
        {tooShort && (
          <p className="sb-too-short" id="sb-too-short" role="alert">
            Describe the client&apos;s situation in a sentence or more, then pull the story.
          </p>
        )}
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
  // Asked for a deck the library doesn't have (FD-34): say so, and offer a new story instead.
  if (story.mode === 'retrieve' && story.missing)
    return (
      <div className="sv-wrap sb">
        <BackHome />
        <header className="sb-story-head">
          <p className="sb-eyebrow">From your library</p>
          <h1 className="sb-board-title" tabIndex={-1} ref={headRef}>
            {story.title}
          </h1>
          <p className="sb-story-summary">Nothing in the library matches that{story.missing.name ? ` name` : ' year'}. You can build a new story for them from the slides we do have.</p>
          <div className="sb-head-actions">
            <button type="button" className="sb-add" onClick={() => void run(answers, 'build')}>
              <Icon name="sparkle" className="ic-sm" />
              Build a new story instead
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
        {story.family && (
          <p className="sb-story-from">
            Told from the {story.family.slides} slides that belong together: {story.family.title}.
          </p>
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
      {/* The story's last words: what the client gets */}
      {story.close && <p className="sb-close">{story.close}</p>}
      <Conversation questions={story.questions} chat={chat} busy={talking} onSend={(t) => void talk(t)} />
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

/**
 * Talk to the story (FD-43): react to it the way you would to a colleague ("these two were useful,
 * now look for X and Y", "drop the fees", "shorter") and it continues from what's on screen. Its
 * questions open the conversation; each answer says what it did. Typed or spoken.
 */
function Conversation({ questions, chat, busy, onSend }: { questions: string[]; chat: { who: 'you' | 'app'; text: string }[]; busy: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [chat.length, busy]);
  const send = () => {
    if (!text.trim() || busy) return;
    onSend(text);
    setText('');
  };
  return (
    <section className="sb-sharpen" aria-labelledby="sb-sharpen-h">
      <h2 className="sb-label" id="sb-sharpen-h">
        Talk to your story
      </h2>
      <div className="sb-talk" aria-live="polite">
        {questions.map((q) => (
          <p key={q} className="sb-msg sb-msg-app">
            {q}
          </p>
        ))}
        {chat.map((m, i) => (
          <p key={i} className={`sb-msg sb-msg-${m.who}`}>
            {m.text}
          </p>
        ))}
        {busy && <p className="sb-msg sb-msg-app sb-working">Working on it…</p>}
        <div ref={end} />
      </div>
      <div className="sb-sharpen-row">
        <label htmlFor="sb-reply" className="sr-only">
          Tell it what to change
        </label>
        <textarea
          id="sb-reply"
          rows={2}
          value={text}
          disabled={busy}
          placeholder="These were useful. Now look for… / Drop… / Shorter / Tell it more about the client"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <MicButton onText={onSend} disabled={busy} />
        <button type="button" className="btn btn-primary btn-icon" aria-label="Send" disabled={busy || !text.trim()} onClick={send}>
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

/* Home and Create sit on the same level, so Home stands apart; the trail is Create › Storyboard. */
function BackHome() {
  return (
    <div className="crumbs sb-crumbs">
      <Link className="sb-crumb-home" to={{ view: 'pages' }}>
        <Icon name="back" className="ic-sm" />
        Home
      </Link>
      <nav aria-label="Breadcrumb">
        <ol>
          <li>
            <Link to={{ view: 'create' }}>Create</Link>
          </li>
          <li>
            <span aria-current="page">Storyboard</span>
          </li>
        </ol>
      </nav>
    </div>
  );
}


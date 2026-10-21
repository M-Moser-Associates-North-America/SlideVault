'use client';

import { useEffect, useRef, useState } from 'react';
import type { SlideSummary, StoryboardResult, StoryboardSection, StoryFeedbackVerdict } from '../contracts/dto';
import { buildStory, sendStoryFeedback, speechAvailable, transcribe } from '../client/api';
import { startRecording, type Recording } from '../client/wav-recorder';
import { Icon } from './icons';
import { SlideCard } from './parts';
import { useWorkspace } from './state';
import './storyboard.css';

/**
 * Storyboard tab (docs/DECISIONS.md FD-22, FD-24): a client situation in, a story of the library's
 * slides out, part by part, client first. The AI's questions come as a chat the person can answer
 * by talking or typing, and every slide asks "Right for this part?" so the next storyboard for a
 * similar brief is better. Slides use the same card as Home: click to preview, tick to add.
 */

/** The story order, shown while the AI works so the wait already looks like the result. */
const PARTS = ["The client's challenge", 'Our insight', 'Our approach', "Proof we've done this", 'Why M Moser', 'What the client gets'];
const STEPS = ['Reading the situation', 'Shaping the story', 'Finding slides for each part'];
const EXAMPLES = [
  'A hospital group is merging three campuses. Clinical staff are burnt out, and the board worries about cost overruns after a failed project last year. We need a proposal outline that tells one story across all three sites.',
  'A law firm is moving floors because half its lawyers now work from home. The RFP asks for firm history, process, team CVs, case studies and fees.',
  'A bank is consolidating two offices into one. The CFO wants savings; staff are worried about losing their own desks.',
];

type Chat = { who: 'ai' | 'you'; text: string };
const two = (n: number) => String(n).padStart(2, '0');

export function StoryboardView() {
  const { runtime, updateSelection, toast, announce } = useWorkspace();
  const [situation, setSituation] = useState('');
  const [read, setRead] = useState(true);
  const [phase, setPhase] = useState<'start' | 'building' | 'ready' | 'error'>('start');
  const [error, setError] = useState('');
  const [story, setStory] = useState<StoryboardResult | null>(null);
  const [answers, setAnswers] = useState('');
  const [chat, setChat] = useState<Chat[]>([]);
  const [elapsed, setElapsed] = useState(0);
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
    setElapsed(0);
    setPhase('building');
    announce('Building your story. This can take a minute.');
    try {
      const result = await buildStory(runtime, situation.trim(), { read, answers: withAnswers }, controller.signal);
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

  if (phase === 'start' || phase === 'error')
    return (
      <div className="sv-wrap sb">
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
      </div>
    );

  return (
    <div className="sv-wrap sb">
      <div className="sb-head">
        <div>
          <p className="sb-eyebrow">Storyboard</p>
          <h1 className="h1 sb-title" tabIndex={-1} ref={headRef}>
            {phase === 'building' && !story ? 'Building your story' : 'Your story'}
          </h1>
          {story?.summary && <p className="lede muted sb-lede">{story.summary}</p>}
        </div>
        {story && (
          <div className="sb-head-actions">
            <span className="badge">{story.reader === 'model' ? 'Read by AI' : 'Standard story order'}</span>
            <button type="button" className="btn" onClick={addStory}>
              <Icon name="plus" />
              Add the story to the draft deck
            </button>
            <button type="button" className="btn btn-ghost" onClick={startOver}>
              Start over
            </button>
          </div>
        )}
      </div>
      {story?.readerNote && (
        <div className="notice info">
          <Icon name="info" />
          <span>{story.readerNote}</span>
        </div>
      )}

      <div className="sb-layout">
        <div className="sb-story" aria-busy={phase === 'building'}>
          {phase === 'building' && <Building elapsed={elapsed} />}
          {phase !== 'building' && story?.sections.map((s, i) => <Part key={s.role} n={i + 1} section={s} list={ordered} topics={story.topics} />)}
        </div>
        <ChatPanel chat={chat} busy={phase === 'building'} onSend={reply} />
      </div>
    </div>
  );
}

/** The wait looks like the result: the six parts, in order, with a light moving down the story. */
function Building({ elapsed }: { elapsed: number }) {
  const step = Math.min(STEPS.length - 1, Math.floor(elapsed / 12));
  return (
    <div className="sb-building">
      <p className="sb-status" aria-live="polite">
        <span className="sb-pulse" aria-hidden="true" />
        {STEPS[step]}… <span className="muted">{elapsed}s</span>
      </p>
      {elapsed >= 15 && <p className="muted sb-wait">Still working. On this laptop the AI usually takes under a minute and a half.</p>}
      {PARTS.map((label, i) => (
        <div key={label} className="sb-part sb-part-ghost" style={{ animationDelay: `${i * 0.6}s` }}>
          <div className="sb-part-head">
            <span className="sb-n">{two(i + 1)}</span>
            <span className="sb-label">{label}</span>
          </div>
          <div className="sb-ghost-row" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      ))}
    </div>
  );
}

function Part({ n, section, list, topics }: { n: number; section: StoryboardSection; list: SlideSummary[]; topics: string[] }) {
  const { runtime, toast } = useWorkspace();
  const [said, setSaid] = useState<Record<string, StoryFeedbackVerdict>>({});
  const send = (slideId: string | null, verdict: StoryFeedbackVerdict) => {
    setSaid((s) => ({ ...s, [slideId ?? '_part']: verdict }));
    sendStoryFeedback(runtime, { role: section.role, slideId, verdict, topics }).catch(() => toast("Couldn't save that. Please try again."));
  };
  return (
    <section className="sb-part" aria-labelledby={`sb-p${n}`}>
      <div className="sb-part-head">
        <span className="sb-n">{two(n)}</span>
        <span className="sb-label">{section.label}</span>
      </div>
      <h2 className="h2 sb-part-title" id={`sb-p${n}`}>
        {section.title}
      </h2>
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
                <Feedback verdict={said[slide.id]} onSay={(v) => send(slide.id, v)} />
              </div>
            ))}
          </div>
          {said._part ? (
            <p className="sb-thanks">Thanks. We&apos;ll look for better proof for this part.</p>
          ) : (
            <button type="button" className="btn btn-link sb-none" onClick={() => send(null, 'nothing-fits')}>
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

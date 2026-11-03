'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { sendSearchFeedback } from '../client/api';
import { EngageUnavailable, useEngagement, type EngageApi } from '../client/engage-store';
import { currentStoryRole } from '../client/role-store';
import { demoTagsOn } from '../client/tag-store';
import type { SlideComment, SlideDetail, SlideSummary } from '../contracts/dto';
import { Icon } from './icons';
import { plural } from './library';
import { profileInitials, useWorkspace } from './state';
import { ConfirmDialog } from './TagBits';

/* Reddit-style actions on a slide (FD-72): ▲ net score ▼, comments, Share. Quiet grey pills that turn
   orange on hover. Votes and comments only show once the server sends them, so nobody is offered a
   button that does nothing; Share works today. */

const MAX_COMMENT = 1000;
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** The up / down pill. A vote on a slide you found by searching also teaches that search (Useful / Not relevant, FD-59). */
function VotePill({ slide, engage, small }: { slide: SlideSummary; engage: EngageApi; small?: boolean }) {
  const { runtime, toast, query, search } = useWorkspace();
  const v = engage.votes;
  const searched = search.status === 'ready' ? query.trim() : '';
  /* No vote counts from the server yet: the same arrows still teach the search you came from. */
  if (!v) return searched && !demoTagsOn() ? <FeedbackPill slide={slide} searched={searched} small={small} /> : null;
  const cast = async (value: 1 | -1) => {
    const next = v.myVote === value ? 0 : value;
    try {
      await engage.vote(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work. Please try again.');
      return;
    }
    /* Only for people who turned on learning (the server says so); a failure here is never shown. */
    if (next !== 0 && searched && !demoTagsOn()) {
      sendSearchFeedback(runtime, { query: searched, slideId: slide.id, verdict: next === 1 ? 'useful' : 'not-relevant', by: currentStoryRole() }).catch(() => undefined);
    }
  };
  return (
    <div className={`votepill${small ? ' is-small' : ''}`} role="group" aria-label="Rate this slide">
      <button type="button" className="vp is-up" aria-pressed={v.myVote === 1} aria-label="Upvote: this slide is useful" data-tip="Useful" onClick={() => void cast(1)}>
        <Icon name="up" />
      </button>
      <span className="vp-n" aria-live="polite" title={`${plural(v.up, 'up vote')} · ${plural(v.down, 'down vote')}`}>
        {v.up - v.down}
        <span className="sr-only"> net votes</span>
      </span>
      <button type="button" className="vp is-down" aria-pressed={v.myVote === -1} aria-label="Downvote: this slide is not relevant" data-tip="Not relevant" onClick={() => void cast(-1)}>
        <Icon name="dn" />
      </button>
    </div>
  );
}

/** Just the vote pill, small, for a result card: vote counts when the server has them, else Useful / Not relevant on a search result. */
export function CardVotes({ slide }: { slide: SlideSummary }) {
  const { runtime, query, search } = useWorkspace();
  const engage = useEngagement(runtime, slide);
  if (!engage.votes && !(search.status === 'ready' && query.trim())) return null;
  return <VotePill slide={slide} engage={engage} small />;
}

/* Useful / Not relevant on a search result (FD-59, FD-77, FD-81): the answer per search and slide,
   shared by the card, the preview and the slide page. The browser remembers what it sent (also after a
   reload), so the same answer is never sent twice; changing your mind takes the old click back first,
   and clicking the lit arrow again takes it back. Nobody is named, so this is also what stops one
   person counting twice. */
type Answer = 0 | 1 | -1;
const answers = new Map<string, { shown: Answer; sent: Answer }>();
const answerListeners = new Set<() => void>();
const onAnswers = (cb: () => void) => (answerListeners.add(cb), () => void answerListeners.delete(cb));
let toldOptedOut = false;
let toldThanks = false;
const MEMORY = 'slidevault:search-answers';
const MEMORY_MAX = 400;
const answerKey = (searched: string, slideId: string) => `${searched.trim().toLowerCase().replace(/\s+/g, ' ')}|${slideId}`;

/** What this browser already sent, kept between visits (a private window or blocked storage just forgets). */
function remembered(): Record<string, Answer> {
  try {
    return JSON.parse(localStorage.getItem(MEMORY) ?? '{}') as Record<string, Answer>;
  } catch {
    return {};
  }
}
function remember(key: string, sent: Answer) {
  try {
    const all = remembered();
    delete all[key];
    if (sent !== 0) all[key] = sent;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MEMORY_MAX))) delete all[k];
    localStorage.setItem(MEMORY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the tab still remembers */
  }
}
function answerFor(key: string) {
  let a = answers.get(key);
  if (!a) {
    const sent = remembered()[key] ?? 0;
    a = { shown: sent, sent };
    answers.set(key, a);
  }
  return a;
}

/**
 * The same arrows, without counts or names: ▲ Useful, ▼ Not relevant for the search you came from.
 * The server keeps it only for people who turned on "learn from my activity", with the search's
 * words and no name; it teaches the search and, through it, the storyboard (FD-75).
 */
function FeedbackPill({ slide, searched, small }: { slide: SlideSummary; searched: string; small?: boolean }) {
  const { runtime, toast } = useWorkspace();
  const key = answerKey(searched, slide.id);
  const shown = useSyncExternalStore(onAnswers, () => answerFor(key).shown, () => 0);
  const cast = (value: 1 | -1) => {
    const now = answerFor(key);
    const next: Answer = now.shown === value ? 0 : value;
    const by = currentStoryRole();
    const verdict = (a: 1 | -1) => (a === 1 ? 'useful' : 'not-relevant') as 'useful' | 'not-relevant';
    const take = now.sent !== 0 && now.sent !== next ? sendSearchFeedback(runtime, { query: searched, slideId: slide.id, verdict: verdict(now.sent), by, undo: true }) : null;
    const give = next !== 0 && next !== now.sent;
    const sentAfter: Answer = give ? next : next === 0 ? 0 : now.sent;
    answers.set(key, { shown: next, sent: sentAfter });
    answerListeners.forEach((l) => l());
    if (!take && !give) return;
    take?.catch(() => undefined);
    if (!give) return remember(key, sentAfter);
    sendSearchFeedback(runtime, { query: searched, slideId: slide.id, verdict: verdict(next as 1 | -1), by }).then(
      (r) => {
        if (r && r.saved) {
          remember(key, next);
          if (!toldThanks) {
            toldThanks = true;
            toast('Thanks. Search will use this for similar searches.');
          }
        } else if (r && !r.saved) {
          answers.set(key, { shown: next, sent: 0 }); /* nothing was saved, so nothing to take back later */
          if (!toldOptedOut) {
            toldOptedOut = true;
            toast('Not saved: learning from your activity is off. You can turn it on in Settings.');
          }
        }
      },
      () => undefined,
    );
  };
  /* The Storyboard's Useful / Not useful row (same classes): ticks and crosses, small capitals, one on each side of a card. */
  return (
    <div className={`sb-verdict fb-verdict${small ? ' is-small' : ''}`} role="group" aria-label="Is this slide useful for your search?">
      <button type="button" className="sb-icon-btn" aria-pressed={shown === 1} aria-label="Useful for this search" data-tip="Useful: ranks this slide higher in similar searches." data-tip-pos={small ? 'up start' : undefined} onClick={() => cast(1)}>
        <Icon name="check" className="ic-sm" />
        Useful
      </button>
      <button type="button" className="sb-icon-btn" aria-pressed={shown === -1} aria-label="Not useful for this search" data-tip="Not useful: ranks this slide lower in similar searches." data-tip-pos={small ? 'up end' : undefined} onClick={() => cast(-1)}>
        <Icon name="x" className="ic-sm" />
        Not useful
      </button>
    </div>
  );
}

/** Copies a link to the slide's page. Only people signed in at M Moser can open it, so it is safe to paste in a chat or an email. */
export function useShareSlide(slideId: string) {
  const { runtime, toast } = useWorkspace();
  return async () => {
    const path = runtime.hrefFor?.({ view: 'slide', id: slideId });
    if (!path) return toast("This page can't make a link here.");
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. Anyone signed in at M Moser can open it.');
    } catch {
      toast(`Copy this link: ${url}`); /* clipboard blocked: show it instead */
    }
  };
}

/** Share as a small icon button, for the corner of the preview next to its close button. */
export function ShareIconButton({ slideId }: { slideId: string }) {
  const share = useShareSlide(slideId);
  return (
    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Share: copy a link to this slide" data-tip="Copy link" data-tip-pos="end" onClick={() => void share()}>
      <Icon name="share" />
    </button>
  );
}

/** The full bar: vote pill, comments, Share (the slide page has Share in its Use this slide card instead: noShare). */
export function SlideActions({ slide, commentsOpen, onComments, noShare }: { slide: SlideSummary; commentsOpen?: boolean; onComments: () => void; noShare?: boolean }) {
  const { runtime } = useWorkspace();
  const engage = useEngagement(runtime, slide);
  const share = useShareSlide(slide.id);
  return (
    <div className="slide-actions" role="group" aria-label="Slide actions">
      <VotePill slide={slide} engage={engage} />
      {engage.commentCount !== undefined && (
        <button type="button" className="actpill" aria-expanded={!!commentsOpen} onClick={onComments}>
          <Icon name="comment" />
          <span>{engage.commentCount}</span>
          <span className="sr-only"> comments</span>
        </button>
      )}
      {!noShare && (
        <button type="button" className="actpill" onClick={() => void share()} data-tip="Copy a link to this slide">
          <Icon name="share" />
          <span>Share</span>
        </button>
      )}
    </div>
  );
}

/** The slide page: the bar, and the comments opening under it. */
export function SlideEngagement({ slide, loaded }: { slide: SlideSummary; loaded?: SlideDetail | null }) {
  const [open, setOpen] = useState(false);
  const merged = loaded ? { ...slide, votes: loaded.votes ?? slide.votes, commentCount: loaded.commentCount ?? slide.commentCount } : slide;
  return (
    <>
      <SlideActions slide={merged} commentsOpen={open} onComments={() => setOpen((o) => !o)} noShare />
      {open && <CommentsSection slide={merged} />}
    </>
  );
}

/** The preview: the same bar without Share (that is an icon beside the close button), with the comments opening right below it. */
export function PreviewActions({ slide }: { slide: SlideSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SlideActions slide={slide} commentsOpen={open} onComments={() => setOpen((o) => !o)} noShare />
      {open && <CommentsSection slide={slide} />}
    </>
  );
}

/* ---------------------------------------------------------------- Comments */

function CommentsSection({ slide }: { slide: SlideSummary }) {
  const { runtime, profile, toast, announce } = useWorkspace();
  const engage = useEngagement(runtime, slide, true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<SlideComment | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const list = engage.comments;
  const trimmed = text.trim();
  const fail = (e: unknown) => toast(e instanceof EngageUnavailable || e instanceof Error ? e.message : 'That did not work. Please try again.');

  const post = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await engage.comment(trimmed, profile ?? 'You');
      setText('');
      announce('Comment added');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault(); /* Enter posts, like Instagram; Shift+Enter adds a line */
      void post();
    }
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
  }, [text]);
  const remove = async (c: SlideComment) => {
    setAsking(null);
    try {
      await engage.removeComment(c.id);
      announce('Comment deleted');
    } catch (e) {
      fail(e);
    }
  };

  return (
    <section className="comments" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="h3">
        Comments
      </h2>
      <div className="composer">
        <span className="avatar" aria-hidden="true">
          {profileInitials(profile ?? 'You')}
        </span>
        <div className="composer-box">
          <label htmlFor={`${id}-t`} className="sr-only">
            Add a comment
          </label>
          <textarea ref={box} id={`${id}-t`} rows={1} maxLength={MAX_COMMENT} value={text} disabled={busy} placeholder="Add a comment…" onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          {trimmed && (
            <button type="button" className="composer-post" disabled={busy} onClick={() => void post()}>
              Post
            </button>
          )}
        </div>
      </div>
      <ul className="comment-list">
        {list === undefined ? (
          <li className="meta">Loading comments…</li>
        ) : list.length === 0 ? (
          <li className="meta">No comments yet. Say how you used this slide, or what to watch for.</li>
        ) : (
          list.map((c) => (
            <li key={c.id} className="comment">
              <span className="avatar" aria-hidden="true">
                {profileInitials(c.author)}
              </span>
              <div>
                <p className="comment-head">
                  <b>{c.author}</b> <span className="meta">· {when(c.at)}</span>
                  {c.author === profile && (
                    <button type="button" className="btn-link comment-del" onClick={() => setAsking(c)}>
                      Delete
                    </button>
                  )}
                </p>
                <p className="comment-text">{c.text}</p>
              </div>
            </li>
          ))
        )}
      </ul>
      <ConfirmDialog
        open={!!asking}
        title="Delete this comment?"
        kind="Your comment"
        subject={asking ? (asking.text.length > 90 ? `${asking.text.slice(0, 90)}…` : asking.text) : ''}
        detail={asking ? when(asking.at) : undefined}
        lead="Everyone will stop seeing it. This can't be undone."
        confirmLabel="Delete comment"
        onCancel={() => setAsking(null)}
        onConfirm={() => asking && void remove(asking)}
      />
    </section>
  );
}

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { SlideComment, SlideSummary, SlideVotes } from '../contracts/dto';
import { addComment, deleteComment, listComments, voteSlide, type Transport } from './api';
import { demoTagsOn } from './tag-store';

/**
 * Votes and comments on a whole slide (FD-72), shared by the card, the preview and the slide page so a
 * vote made in one place shows in all of them. Reddit style: one up and one down per person, shown
 * as a net number; comments are flat plain text.
 *
 * The server routes are asked for, not built yet. Until a slide arrives with `votes`, nothing here
 * shows, so nobody is offered a button that does nothing. ?demotags=1 in the address shows pretend
 * votes and comments that you can use, kept in this browser tab only.
 */
type Entry = { votes?: SlideVotes; comments?: SlideComment[]; count?: number };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const put = (id: string, patch: Entry) => {
  entries.set(id, { ...entries.get(id), ...patch });
  listeners.forEach((l) => l());
};

export class EngageUnavailable extends Error {}

/* ---------------------------------------------------------------- Pretend data (?demotags=1) */

const PEOPLE = ['Priya Shah', 'Sam Lee', 'Maya Chen', 'Jordan Ellis'];
const SAYS = ['Used this in the Toronto pitch, worked well.', 'Needs the 2026 numbers before it goes out.', 'Great opener for a first meeting.', 'Check the logos are current.'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11);
const demoVotes = (id: string): SlideVotes => ({ up: 2 + (hash(id) % 90), down: hash(id + 'd') % 7, myVote: 0 });
const demoComments = (id: string): SlideComment[] =>
  Array.from({ length: hash(id + 'c') % 4 }, (_, i) => ({ id: `demo-c-${id}-${i}`, text: SAYS[(hash(id) + i) % SAYS.length], author: PEOPLE[(hash(id) + i) % PEOPLE.length], at: new Date(Date.UTC(2026, 9, 24 + i)).toISOString() }));

/* ---------------------------------------------------------------- The hook */

export type EngageApi = {
  /** Undefined until the server counts votes: then the vote buttons stay out of sight */
  votes: SlideVotes | undefined;
  /** Undefined until the server has comments */
  commentCount: number | undefined;
  /** Loaded only when asked for (the slide page) */
  comments: SlideComment[] | undefined;
  vote: (value: 1 | -1 | 0) => Promise<void>;
  comment: (text: string, who: string) => Promise<void>;
  removeComment: (id: string) => Promise<void>;
};

export function useEngagement(runtime: Transport, slide: SlideSummary, loadComments = false): EngageApi {
  const id = slide.id;
  const entry = useSyncExternalStore(subscribe, () => entries.get(id), () => undefined);
  const demo = typeof window !== 'undefined' && demoTagsOn();
  const votes = entry?.votes ?? slide.votes ?? (demo ? demoVotes(id) : undefined);
  const comments = entry?.comments ?? (demo ? demoComments(id) : undefined);
  const commentCount = comments?.length ?? entry?.count ?? slide.commentCount;

  useEffect(() => {
    if (!loadComments || demo || entries.get(id)?.comments) return;
    const controller = new AbortController();
    listComments(runtime, id, controller.signal).then(
      (list) => list && put(id, { comments: list }),
      () => {},
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadComments, demo, id]);

  return useMemo<EngageApi>(
    () => ({
      votes,
      commentCount,
      comments,
      async vote(value) {
        const now = votes ?? { up: 0, down: 0, myVote: 0 as const };
        const next: SlideVotes = {
          up: now.up - (now.myVote === 1 ? 1 : 0) + (value === 1 ? 1 : 0),
          down: now.down - (now.myVote === -1 ? 1 : 0) + (value === -1 ? 1 : 0),
          myVote: value,
        };
        put(id, { votes: next }); /* shown at once; put back below if the server can't take it */
        if (demo) return;
        try {
          const saved = await voteSlide(runtime, id, value);
          if (!saved) throw new EngageUnavailable("Voting isn't available yet: the server doesn't count votes.");
          put(id, { votes: saved });
        } catch (e) {
          put(id, { votes: now });
          throw e;
        }
      },
      async comment(text, who) {
        const have = comments ?? [];
        if (demo) return put(id, { comments: [...have, { id: `demo-c-${id}-${Date.now()}`, text, author: who, at: new Date().toISOString() }] });
        const saved = await addComment(runtime, id, text);
        if (!saved) throw new EngageUnavailable("Comments can't be saved yet: this server has no comment route.");
        put(id, { comments: [...have, saved] });
      },
      async removeComment(commentId) {
        const have = comments ?? [];
        if (!demo && !(await deleteComment(runtime, id, commentId))) throw new EngageUnavailable("Comments can't be deleted yet: this server has no comment route.");
        put(id, { comments: have.filter((c) => c.id !== commentId) });
      },
    }),
    [votes, commentCount, comments, demo, runtime, id],
  );
}

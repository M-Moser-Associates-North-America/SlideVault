'use client';

import { useEffect, useRef } from 'react';
import { handOffBrief, looksLikeBrief } from '../client/story-handoff';
import { clearStoryHint, dismissStoryHint, registerStoryButton, useDismissedStoryHint, useStoryButtonShown } from '../client/story-hint';
import { useTipSeen } from '../client/tip-store';
import { useTourOpen } from '../client/tour-store';
import { Button } from './ui/Button';
import { Icon } from './icons';
import { useWorkspace } from './state';
import { useWorkspacePhoneUpright } from './size';
import './storyboard.css';

/**
 * The way into the Storyboard (FD-24), placed beside the search bar instead of a tab of its own.
 * Search is for "I know the slide I want"; this is for "I have a client situation". When what's
 * typed in search reads like a brief, the button lights up and offers to build a story from it,
 * carrying the words over so nothing is typed twice.
 */
export function StoryLauncher({ part = 'all' }: { part?: 'all' | 'button' | 'hint' }) {
  const { query, runtime } = useWorkspace();
  const readsAsBrief = looksLikeBrief(query);
  /* The suggestion (the glow and the hint) is off for words the person has waved away or already taken to the Storyboard. */
  const dismissedWords = useDismissedStoryHint();
  const brief = readsAsBrief && dismissedWords !== query.trim();
  /* Once the words are not the ones that were waved away, the suggestion is back for next time (typing the same sentence again later too). */
  useEffect(() => {
    if (dismissedWords && dismissedWords !== query.trim()) clearStoryHint();
  }, [dismissedWords, query]);
  /* The "New" badge stays until the Storyboard has been opened once in this browser. */
  const opened = useTipSeen('storyboard-opened');
  const touring = useTourOpen();
  const open = () => {
    opened.dismiss();
    if (readsAsBrief) handOffBrief(query);
    dismissStoryHint(query);
    runtime.navigate({ view: 'story' });
  };
  /* Tapping or clicking anywhere else, or pressing Escape, puts the hint away. */
  const hintRef = useRef<HTMLDivElement>(null);
  /* Where the hint shows: with the button on a wide screen ('all'); as a callout beside the button when the button is in the filter row (tablets, a phone on its
     side); as the quiet line under the search when there is no button to point at (a results page) or no room beside it (a phone held upright). */
  const upright = useWorkspacePhoneUpright();
  const buttonShown = useStoryButtonShown();
  useEffect(() => (part === 'button' ? registerStoryButton() : undefined), [part]);
  const showingHint = brief && (part === 'all' || (part === 'button' && !upright) || (part === 'hint' && (upright || !buttonShown)));
  useEffect(() => {
    if (!showingHint) return;
    const away = (e: PointerEvent) => {
      const el = e.target as Element | null;
      /* Not a tap inside the hint itself, inside a pop-up window (the "Search with AI?" question, for one), or into a text box (the person is still typing). */
      if (hintRef.current?.contains(el) || el?.closest?.('dialog, input, textarea, select')) return;
      dismissStoryHint(query);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissStoryHint(query);
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
    };
  }, [showingHint, query]);
  const pill = part === 'button';
  const descId = pill ? 'sb-launch-desc-pill' : 'sb-launch-desc';
  return (
    <div className={`sb-launch${pill ? ' is-pill' : ''}${part === 'hint' ? ' is-hint-only' : ''}`}>
      {part !== 'hint' && (
      <button type="button" className={`btn sb-launch-btn${brief ? ' is-glow' : ''}`} onClick={open} aria-describedby={brief ? `${descId} sb-launch-hint` : descId}>
        <Icon name="sparkle" />
        <span className="sb-swap">
          <span className="sb-swap1">Storyboard</span>
          <span className="sb-swap2" aria-hidden="true">
            Build with AI
          </span>
        </span>
        <span id={descId} className="sr-only">
          Build with AI
        </span>
        {!opened.seen && !touring && <span className="sb-new">New</span>}
      </button>
      )}
      {showingHint && (
        <div className="sb-launch-hint" id="sb-launch-hint" role="status" ref={hintRef}>
          <span className="sb-hint-text">
            <Icon name="sparkle" className="ic-sm" />
            <span className="sb-hint-full">This sounds like a client brief.</span>
            <span className="sb-hint-short">Client brief?</span>
          </span>
          {/* Beside the Storyboard button the words only point at it (the button is the thing to press); on their own, with no button here, they are the link. */}
          {part === 'hint' ? (
            <Button variant="link" onClick={open}>
              Build a story instead
            </Button>
          ) : (
            <span className="sb-hint-go">Build a story instead</span>
          )}
        </div>
      )}
    </div>
  );
}

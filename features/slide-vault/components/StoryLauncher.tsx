'use client';

import { handOffBrief, looksLikeBrief } from '../client/story-handoff';
import { useTipSeen } from '../client/tip-store';
import { useTourOpen } from '../client/tour-store';
import { Icon } from './icons';
import { useWorkspace } from './state';
import './storyboard.css';

/**
 * The way into the Storyboard (FD-24), placed beside the search bar instead of a tab of its own.
 * Search is for "I know the slide I want"; this is for "I have a client situation". When what's
 * typed in search reads like a brief, the button lights up and offers to build a story from it,
 * carrying the words over so nothing is typed twice.
 */
export function StoryLauncher() {
  const { query, runtime } = useWorkspace();
  const brief = looksLikeBrief(query);
  /* The "New" badge stays until the Storyboard has been opened once in this browser. */
  const opened = useTipSeen('storyboard-opened');
  const touring = useTourOpen();
  const open = () => {
    opened.dismiss();
    if (brief) handOffBrief(query);
    runtime.navigate({ view: 'story' });
  };
  return (
    <div className="sb-launch">
      <button type="button" className={`btn sb-launch-btn${brief ? ' is-glow' : ''}`} onClick={open} aria-describedby={brief ? 'sb-launch-hint' : undefined}>
        <Icon name="sparkle" />
        Storyboard
        {!opened.seen && !touring && <span className="sb-new">New</span>}
      </button>
      {brief && (
        <p className="sb-launch-hint" id="sb-launch-hint" role="status">
          <Icon name="sparkle" className="ic-sm" />
          This sounds like a client brief.{' '}
          <button type="button" className="btn-link" onClick={open}>
            Build a story instead
          </button>
        </p>
      )}
    </div>
  );
}

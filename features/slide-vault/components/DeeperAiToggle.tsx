'use client';

import { useId } from 'react';
import { useWorkspace } from './state';

/**
 * "AI search" (FD-79): off until the person turns it on. When on, a search written as a sentence or a
 * question is read by an AI model; a short one asks first (the note on the results page). Only offered
 * when the server has an AI reader set up. Looks and behaves like the hidden-slides switch beside it,
 * with "AI" in letters because the sparkle already means Storyboard.
 */
export function DeeperAiToggle() {
  const { aiAvailable, deeperAi, setDeeperAi } = useWorkspace();
  const tipId = useId();
  if (!aiAvailable) return null;
  return (
    <span className="hid-wrap">
      <button type="button" role="switch" aria-checked={deeperAi} aria-label="Deeper AI search" aria-describedby={tipId} className={`hid-toggle ai-toggle${deeperAi ? ' on' : ''}`} onClick={() => setDeeperAi(!deeperAi)}>
        <span className="ai-mark" aria-hidden="true">
          AI
        </span>
      </button>
      <span className="hid-tip" role="tooltip" id={tipId}>
        <strong>{deeperAi ? 'AI search: on' : 'AI search: off'}</strong>
        <span>{deeperAi ? 'AI helps read your search. Click to turn off.' : 'Click to let AI help read your search.'}</span>
      </span>
    </span>
  );
}

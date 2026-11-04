'use client';

import { useId } from 'react';
import { Icon } from './icons';
import { useWorkspace } from './state';

/**
 * "Deeper AI search" (FD-79): off until the person turns it on. When on, a sentence or a question
 * they submit is read by an AI model; shorter searches stay on the regular rules (the results page
 * says so). Only offered when the server has an AI reader set up. Looks and behaves like the
 * hidden-slides switch beside it.
 */
export function DeeperAiToggle() {
  const { aiAvailable, deeperAi, setDeeperAi } = useWorkspace();
  const tipId = useId();
  if (!aiAvailable) return null;
  return (
    <span className="hid-wrap">
      <button type="button" role="switch" aria-checked={deeperAi} aria-label="Deeper AI search" aria-describedby={tipId} className={`hid-toggle${deeperAi ? ' on' : ''}`} onClick={() => setDeeperAi(!deeperAi)}>
        <Icon name="sparkle" />
      </button>
      <span className="hid-tip" role="tooltip" id={tipId}>
        <strong>{deeperAi ? 'Deeper AI search: on' : 'Deeper AI search: off'}</strong>
        <span>{deeperAi ? 'An AI reads searches written as a sentence or a question. Click to turn it off.' : 'Click to have an AI read searches written as a sentence or a question. Your search words are sent to the AI service; slides are not.'}</span>
      </span>
    </span>
  );
}

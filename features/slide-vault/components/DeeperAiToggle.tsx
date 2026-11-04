'use client';

import { useId } from 'react';
import { useWorkspace } from './state';

/**
 * "Search with AI" (FD-79): a checkbox at the start of the filter row, off until the person ticks it, then
 * remembered on this device. Ticked, a search written as a sentence or a question is read by an AI model; a
 * short one asks first (the note on the results page). Only offered when the server has an AI reader set up.
 */
export function DeeperAiToggle() {
  const { aiAvailable, deeperAi, setDeeperAi } = useWorkspace();
  const tipId = useId();
  if (!aiAvailable) return null;
  return (
    <span className="hid-wrap ai-check-wrap">
      <label className="ai-check">
        <input type="checkbox" checked={deeperAi} aria-describedby={tipId} onChange={(e) => setDeeperAi(e.target.checked)} />
        <span>
          Search with <b>AI</b>
        </span>
      </label>
      <span className="hid-tip ai-tip" role="tooltip" id={tipId}>
        AI helps read longer searches.
      </span>
    </span>
  );
}

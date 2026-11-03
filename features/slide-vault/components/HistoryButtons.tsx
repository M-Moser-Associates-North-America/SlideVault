'use client';

import { Icon } from './icons';
import { useWorkspace } from './state';

/**
 * Back and Forward at the top right of the tabs row (laptop and tablet; phones use the phone's own
 * back gesture, which follows the same history). The host owns the history, so these only call it.
 */
export function HistoryButtons() {
  const { runtime } = useWorkspace();
  const h = runtime.history;
  if (!h) return null;
  return (
    <div className="hist-btns" role="group" aria-label="History">
      <button type="button" className="hist-btn" aria-label="Back" data-tip="Back" data-tip-pos="end" disabled={!h.canGoBack} onClick={h.back}>
        <Icon name="left" />
      </button>
      <button type="button" className="hist-btn" aria-label="Forward" data-tip="Forward" data-tip-pos="end" disabled={!h.canGoForward} onClick={h.forward}>
        <Icon name="right" />
      </button>
    </div>
  );
}

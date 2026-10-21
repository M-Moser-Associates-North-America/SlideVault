'use client';

import { useRef, useState } from 'react';
import { useTipSeen } from '../client/tip-store';
import { useTourOpen } from '../client/tour-store';
import { backdropClose, useDialogOpen } from './Dialogs';
import { Icon } from './icons';
import { useWorkspace } from './state';

/** Shown until the server says how long it keeps activity. */
export const RETENTION_FALLBACK_DAYS = 90;

/** `first`: asked once after sign-in. `on` and `off`: from the checkbox in My decks. */
export type OptInMode = 'first' | 'on' | 'off';

/**
 * Asks before activity tracking is turned on or off, and says plainly what happens to the data.
 * Nothing changes until the person presses the main button; Escape, the backdrop and the other
 * button leave things as they were.
 */
export function ActivityOptInDialog({ mode, onClose }: { mode: OptInMode | null; onClose: () => void }) {
  const { runtime, setActivityOptIn, activityRetentionDays, toast } = useWorkspace();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  useDialogOpen(ref, mode !== null);
  const days = activityRetentionDays ?? RETENTION_FALLBACK_DAYS;
  const turningOff = mode === 'off';

  const confirm = async () => {
    setBusy(true);
    try {
      await setActivityOptIn(!turningOff);
      toast(turningOff ? 'Personalization is off. Your history was deleted.' : 'Personalization is on.');
      onClose();
    } catch {
      toast('Could not change that setting. Nothing was changed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const close = () => !busy && onClose();

  return (
    <dialog ref={ref} className="slidevault sv-dialog" data-theme={runtime.theme} aria-labelledby="sv-optin-title" onClose={close} onClick={backdropClose(close)}>
      {mode && (
        <>
          <div className="dlg-head">
            <h2 id="sv-optin-title">{turningOff ? 'Turn off personalization?' : 'Personalize my Vault?'}</h2>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={close}>
              <Icon name="x" />
            </button>
          </div>
          <div className="dlg-body">
            {turningOff ? (
              <p>Your history is deleted now. This can’t be undone.</p>
            ) : (
              <>
                <p>Use what you open, save and download to tailor your rows.</p>
                <p className="meta" style={{ marginTop: 6 }}>
                  Private to you. Kept {days} days. Turn it off any time in Settings.
                </p>
              </>
            )}
          </div>
          <div className="dlg-foot">
            <button type="button" className="btn" onClick={close} disabled={busy}>
              {mode === 'first' ? 'Not now' : turningOff ? 'Keep it on' : 'Keep it off'}
            </button>
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy}>
              {busy ? 'Saving…' : turningOff ? 'Turn off and delete my history' : 'Turn on'}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

/**
 * The one-time question after signing in. It waits until the quick tour has been seen so the two
 * never stack, and it only appears when the server can keep the setting. Answering "Not now" (or
 * closing it) is remembered in this browser only; nothing is sent anywhere.
 */
export function ActivityOptInAsk() {
  const { profile, activityOptedIn } = useWorkspace();
  const { seen: asked, dismiss } = useTipSeen('activity-ask');
  const { seen: toured } = useTipSeen('tour');
  const touring = useTourOpen();
  const show = !!profile && activityOptedIn === false && !asked && toured && !touring;
  return <ActivityOptInDialog mode={show ? 'first' : null} onClose={dismiss} />;
}

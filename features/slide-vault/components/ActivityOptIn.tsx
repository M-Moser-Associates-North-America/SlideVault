'use client';

import { Button } from './ui/Button';
import { useEffect, useRef, useState } from 'react';
import { useTipSeen } from '../client/tip-store';
import { useTourOpen } from '../client/tour-store';
import { backdropClose, useDialogOpen } from './Dialogs';
import { Icon } from './icons';
import { useAccount, useNotify, useRuntime } from './state';

/** Shown until the server says how long it keeps activity. */
export const RETENTION_FALLBACK_DAYS = 90;

/** `first`: asked once after sign-in. `on` and `off`: from the checkbox in My decks. */
export type OptInMode = 'first' | 'on' | 'off';

/**
 * Asks before activity tracking is turned on or off, and says plainly what happens to the data.
 * Nothing changes until the person presses the main button; Escape, the backdrop and the other
 * button leave things as they were. Once it has changed, the same card says so (Personalization is
 * on / off) until the person presses Done, so the answer is confirmed on screen, not in a toast.
 */
export function ActivityOptInDialog({ mode, onClose }: { mode: OptInMode | null; onClose: () => void }) {
  const { runtime } = useRuntime();
  const { toast } = useNotify();
  const { setActivityOptIn, activityRetentionDays } = useAccount();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  /** Set once the change is saved: the card stays open and says what happened. */
  const [done, setDone] = useState<'on' | 'off' | null>(null);
  useDialogOpen(ref, mode !== null || done !== null);
  const days = activityRetentionDays ?? RETENTION_FALLBACK_DAYS;
  const turningOff = mode === 'off';

  const confirm = async () => {
    setBusy(true);
    try {
      await setActivityOptIn(!turningOff);
      setDone(turningOff ? 'off' : 'on');
    } catch {
      toast('Could not change that setting. Nothing was changed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setDone(null);
    onClose();
  };

  return (
    <dialog ref={ref} className="slidevault sv-dialog" data-theme={runtime.theme} aria-labelledby="sv-optin-title" onClose={close} onClick={backdropClose(close)}>
      {done ? (
        <>
          <div className="dlg-head">
            <h2 id="sv-optin-title">{done === 'on' ? 'Personalization is on' : 'Personalization is off'}</h2>
            <Button variant="ghost" iconOnly size="sm" aria-label="Close" onClick={close}>
              <Icon name="x" />
            </Button>
          </div>
          <div className="dlg-body" role="status">
            {done === 'on' ? (
              <>
                <p>
                  <Icon name="check" className="ic-sm" /> Your Vault will use what you open, save and download to tailor your rows.
                </p>
                <p className="meta" style={{ marginTop: 6 }}>
                  Private to you. Kept {days} days. Turn it off any time in Settings.
                </p>
              </>
            ) : (
              <p>
                <Icon name="check" className="ic-sm" /> Your history was deleted. Nothing more is recorded.
              </p>
            )}
          </div>
          <div className="dlg-foot">
            <Button variant="primary" onClick={close} autoFocus>
              Done
            </Button>
          </div>
        </>
      ) : (
        mode && (
          <>
            <div className="dlg-head">
              <h2 id="sv-optin-title">{turningOff ? 'Turn off personalization?' : 'Personalize my Vault?'}</h2>
              <Button variant="ghost" iconOnly size="sm" aria-label="Close" onClick={close}>
                <Icon name="x" />
              </Button>
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
              <Button  onClick={close} disabled={busy}>
                {mode === 'first' ? 'Not now' : turningOff ? 'Keep it on' : 'Keep it off'}
              </Button>
              <Button variant="primary" onClick={confirm} disabled={busy}>
                {busy ? 'Saving…' : turningOff ? 'Turn off and delete my history' : 'Turn on'}
              </Button>
            </div>
          </>
        )
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
  const { profile, activityOptedIn } = useAccount();
  const { seen: asked, dismiss } = useTipSeen('activity-ask');
  const { seen: toured } = useTipSeen('tour');
  const touring = useTourOpen();
  const eligible = !!profile && activityOptedIn === false && !asked && toured && !touring;
  /* Not at the same moment as the tour ends: a short pause first. */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!eligible) return;
    const t = setTimeout(() => setReady(true), 3000);
    return () => clearTimeout(t);
  }, [eligible]);
  return <ActivityOptInDialog mode={eligible && ready ? 'first' : null} onClose={dismiss} />;
}

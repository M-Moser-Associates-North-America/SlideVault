'use client';

import { useEffect, useRef, useState } from 'react';
import { speechStatus, transcribe, type SpeechStatus } from '../client/api';
import { startRecording, type Recording } from '../client/wav-recorder';
import { Icon } from './icons';
import { useWorkspace } from './state';

/** Talk instead of type: records on this device and sends it only to the app's own speech service. Icon only. */
export function MicButton({ onText, disabled, className = 'btn btn-icon sb-mic', showWhenOff }: { onText: (text: string) => void; disabled?: boolean; className?: string; showWhenOff?: boolean }) {
  const { runtime, toast } = useWorkspace();
  const [status, setStatus] = useState<SpeechStatus>('off');
  const [state, setState] = useState<'idle' | 'listening' | 'hearing'>('idle');
  const rec = useRef<Recording | null>(null);
  useEffect(() => {
    void speechStatus(runtime).then(setStatus);
    return () => rec.current?.cancel();
  }, [runtime]);
  if (status === 'down') {
    /* Set up, but the speech service isn't answering (it stops when the computer restarts). Shown
       greyed out everywhere so it's clear it needs starting; a tap checks again. */
    const recheck = async () => {
      const now = await speechStatus(runtime);
      setStatus(now);
      if (now === 'down') toast("Voice isn't answering on this computer right now. Type for now, or start the voice service and tap again.");
    };
    return (
      <button type="button" className={className} aria-disabled="true" aria-label="Talk instead of typing (voice isn't answering right now)" data-tip="Voice isn't answering right now" data-tip-pos="end" onClick={() => void recheck()}>
        <Icon name="mic" />
      </button>
    );
  }
  if (status === 'off') {
    /* Home shows it greyed out until talking is set up here; the Storyboard hides it. */
    if (!showWhenOff) return null;
    return (
      <button type="button" className={className} aria-disabled="true" aria-label="Talk instead of typing (not set up here yet)" data-tip="Voice search isn't set up here yet" data-tip-pos="end" onClick={() => toast("Voice search isn't set up here yet. For now, type your search.")}>
        <Icon name="mic" />
      </button>
    );
  }

  async function toggle() {
    if (state === 'listening' && rec.current) {
      setState('hearing');
      try {
        const text = await transcribe(runtime, await rec.current.stop());
        if (text) onText(text);
        else toast("Didn't catch that. Try again a little closer to the mic.");
      } catch (e) {
        toast((e as Error).message);
        void speechStatus(runtime).then(setStatus);
      } finally {
        rec.current = null;
        setState('idle');
      }
      return;
    }
    try {
      rec.current = await startRecording(() => void toggle());
      setState('listening');
    } catch {
      toast('The microphone is blocked. Allow it in the browser to talk instead of type.');
    }
  }

  const label = state === 'listening' ? 'Listening: tap to stop' : state === 'hearing' ? 'Writing it down' : 'Talk instead of typing';
  return (
    <button type="button" className={`${className}${state === 'listening' ? ' is-on' : ''}`} aria-label={label} title={label} aria-pressed={state === 'listening'} disabled={disabled || state === 'hearing'} onClick={() => void toggle()}>
      <Icon name={state === 'hearing' ? 'spinner' : 'mic'} />
    </button>
  );
}

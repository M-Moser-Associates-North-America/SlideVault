'use client';

import { useEffect, useRef, useState } from 'react';
import { speechAvailable, transcribe } from '../client/api';
import { startRecording, type Recording } from '../client/wav-recorder';
import { Icon } from './icons';
import { useWorkspace } from './state';

/** Talk instead of type: records on this device and sends it only to the app's own speech service. Icon only. */
export function MicButton({ onText, disabled, className = 'btn btn-icon sb-mic', showWhenOff }: { onText: (text: string) => void; disabled?: boolean; className?: string; showWhenOff?: boolean }) {
  const { runtime, toast } = useWorkspace();
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<'idle' | 'listening' | 'hearing'>('idle');
  const rec = useRef<Recording | null>(null);
  useEffect(() => {
    void speechAvailable(runtime).then(setAvailable);
    return () => rec.current?.cancel();
  }, [runtime]);
  if (!available) {
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

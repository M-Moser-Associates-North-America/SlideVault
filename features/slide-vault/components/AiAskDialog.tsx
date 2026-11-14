'use client';

import { useEffect, useRef } from 'react';
import { useDialogOpen } from './Dialogs';
import { Icon } from './icons';
import { useRuntime, useSearch } from './state';

/**
 * Asked before a short search is run with "Search with AI" ticked (FD-79). A card in the middle of the screen
 * over a faded page, like the tour. Nothing is searched until it is answered: Yes sends the words to the AI,
 * No (or Escape, or a click outside) uses the regular search, which does not call the AI at all.
 */
export function AiAskDialog() {
  const { runtime } = useRuntime();
  const { aiAsk, aiAskKind, answerAiAsk } = useSearch();
  const ref = useRef<HTMLDialogElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  useDialogOpen(ref, !!aiAsk);
  useEffect(() => {
    if (aiAsk) yesRef.current?.focus();
  }, [aiAsk]);
  const no = () => answerAiAsk(false);
  const long = aiAskKind === 'long';
  return (
    <dialog
      ref={ref}
      className="slidevault sv-dialog ai-ask"
      data-theme={runtime.theme}
      aria-labelledby="sv-ai-ask-title"
      onCancel={(e) => {
        e.preventDefault();
        no();
      }}
      onClick={(e) => e.target === e.currentTarget && no()}
    >
      <div className="ai-ask-body">
        <span className="ai-ask-ic" aria-hidden="true">
          <Icon name="sparkle" />
        </span>
        <h2 id="sv-ai-ask-title">{long ? 'Search this with AI?' : 'Use AI for this search?'}</h2>
        <p className="ai-ask-words">“{aiAsk}”</p>
        <p className="ai-ask-text">
          {long
            ? 'This looks like a longer request, which the AI handles well. Choosing Yes also ticks “Search with AI”.'
            : 'Regular search usually handles short searches well. The AI works best on longer requests. Use it anyway?'}
        </p>
      </div>
      <div className="dlg-foot ai-ask-foot">
        <button type="button" className="btn btn-ghost" onClick={no}>
          {long ? 'No, regular search' : 'No, search normally'}
        </button>
        <button ref={yesRef} type="button" className="btn btn-primary" onClick={() => answerAiAsk(true)}>
          Yes, use AI
        </button>
      </div>
    </dialog>
  );
}

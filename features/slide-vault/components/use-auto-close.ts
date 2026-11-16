'use client';

import { useCallback, useRef } from 'react';

/**
 * A filter card that closes a beat after a single choice (so the tick shows first). If the page is busy that beat can run
 * late, so it only counts while nothing else has happened to the cards since: `cancelAutoClose` (called when a card is
 * opened or closed by hand) cancels it, and a card opened again is never closed by an old beat.
 */
export function useAutoClose(close: (returnFocus: boolean) => void) {
  const ticket = useRef(0);
  const cancelAutoClose = useCallback(() => {
    ticket.current++;
  }, []);
  const closeSoon = useCallback(() => {
    const mine = ++ticket.current;
    setTimeout(() => {
      if (ticket.current === mine) close(true);
    }, 160);
  }, [close]);
  return { cancelAutoClose, closeSoon };
}

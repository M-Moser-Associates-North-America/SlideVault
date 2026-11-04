'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Back and Forward for the app. The browser's history does the real moving; this only remembers where
 * we have been, because a page cannot ask the browser whether Back or Forward has anywhere to go.
 * The trail is kept for the browser tab, so a reload does not grey the buttons out.
 */
const STORE = 'slidevault:trail';
type Trail = { urls: string[]; at: number };

function load(): Trail | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(STORE) ?? 'null') as Trail | null;
    return t && Array.isArray(t.urls) && typeof t.at === 'number' && t.urls[t.at] ? t : null;
  } catch {
    return null;
  }
}

/* When our own navigate() last started a move to another page. The address changes only once the new page is
   ready, which can take a while, so a pop-up that closes meanwhile must not step back and cancel it. */
let moveStarted = 0;
let moveDone = true;

export function useAppHistory(pathname: string, go: { back(): void; forward(): void }) {
  const [trail, setTrail] = useState<Trail>({ urls: [pathname], at: 0 });
  /* Set by our own navigate(), so a trip back to an earlier page by link still counts as a new step. */
  const pushing = useRef(false);

  useEffect(() => {
    moveDone = true; /* the address changed: any move that was on its way has arrived */
    setTrail((cur) => {
      const base = cur.urls.length === 1 && cur.urls[0] === pathname ? (load() ?? cur) : cur;
      let next = base;
      if (base.urls[base.at] !== pathname) {
        if (!pushing.current && base.urls[base.at - 1] === pathname) next = { urls: base.urls, at: base.at - 1 };
        else if (!pushing.current && base.urls[base.at + 1] === pathname) next = { urls: base.urls, at: base.at + 1 };
        else next = { urls: [...base.urls.slice(0, base.at + 1), pathname], at: base.at + 1 };
      }
      pushing.current = false;
      try {
        sessionStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        // Private browsing: the trail lasts until the page reloads.
      }
      return next;
    });
  }, [pathname]);

  const notePush = useCallback(() => {
    moveStarted = Date.now();
    moveDone = false;
    pushing.current = true;
    setTimeout(() => (pushing.current = false), 1500); // in case the address does not change
  }, []);
  const canGoBack = trail.at > 0;
  const canGoForward = trail.at < trail.urls.length - 1;
  const back = useCallback(() => canGoBack && go.back(), [canGoBack, go]);
  const forward = useCallback(() => canGoForward && go.forward(), [canGoForward, go]);
  return { canGoBack, canGoForward, back, forward, notePush };
}

/**
 * An open pop-up (slide preview, download, and so on) closes before Back leaves the page, whether the
 * person used the buttons, the keyboard, a mouse button or the phone's back swipe. While any <dialog>
 * is open, one extra history step with the same address stands in front of the real page; Back
 * lands on it and we close the dialog instead.
 */
export function useDialogBack() {
  useEffect(() => {
    let held = false; // our extra step is in the history
    let heldUrl = '';
    let skipPop = false; // the next popstate is us removing our own step
    const open = () => Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));

    const sync = () => {
      const any = open().length > 0;
      if (any && !held) {
        held = true;
        heldUrl = location.href;
        history.pushState({ ...(history.state ?? {}), svDialog: true }, '', location.href);
      } else if (!any && held) {
        held = false;
        /* Only take our step back out if we are still on it. After a link (Open deck, Open slide page) the app
           is about to move on, but the address changes a moment after the pop-up closes, so look again for
           a short while before deciding. Stepping back too early cancels the move. */
        const settle = (tries: number) => {
          if (held || location.href !== heldUrl) return; // another pop-up opened, or the page moved on
          if (!moveDone && Date.now() - moveStarted < 10_000) {
            setTimeout(() => settle(0), 150); // a move to another page is on its way: wait for it
          } else if (tries < 8) { // about 1.2 seconds of quiet before the step is taken out
            setTimeout(() => settle(tries + 1), 150);
          } else if (history.state?.svDialog) {
            skipPop = true;
            history.back();
          }
        };
        settle(0);
      }
    };
    const onPop = () => {
      if (skipPop) {
        skipPop = false;
        return;
      }
      if (held) {
        held = false;
        open().forEach((d) => d.close());
      } else if (history.state?.svDialog && open().length === 0) {
        history.back(); // a leftover step from a dialog that closed while we moved on: step over it
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    window.addEventListener('popstate', onPop);
    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', onPop);
    };
  }, []);
}

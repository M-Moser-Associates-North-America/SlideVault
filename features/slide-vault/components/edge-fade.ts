'use client';

import { useEffect, type RefObject } from 'react';

/**
 * A row that scrolls sideways (chips, tags) shows a soft fade on the side where more is hidden. This keeps
 * `data-fade` on the element up to date: "end", "start", "start end" or empty. The CSS does the rest.
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      // Only a row that really scrolls sideways fades. A row that wraps has nothing hidden, and a card hanging out of its
      // right edge (a filter card) would otherwise count as hidden content and be masked away.
      const scrolls = /auto|scroll/.test(getComputedStyle(el).overflowX);
      const max = el.scrollWidth - el.clientWidth;
      const parts = scrolls ? [el.scrollLeft > 2 ? 'start' : '', el.scrollLeft < max - 2 ? 'end' : ''].filter(Boolean).join(' ') : '';
      if ((el.dataset.fade ?? '') !== parts) el.dataset.fade = parts;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const change = new MutationObserver(() => {
      update();
      [...el.children].forEach((c) => resize.observe(c));
    });
    change.observe(el, { childList: true });
    [...el.children].forEach((c) => resize.observe(c));
    return () => {
      el.removeEventListener('scroll', update);
      resize.disconnect();
      change.disconnect();
    };
  }, [ref]);
}

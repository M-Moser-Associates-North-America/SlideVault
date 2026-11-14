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
      const max = el.scrollWidth - el.clientWidth;
      const parts = [el.scrollLeft > 2 ? 'start' : '', el.scrollLeft < max - 2 ? 'end' : ''].filter(Boolean).join(' ');
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

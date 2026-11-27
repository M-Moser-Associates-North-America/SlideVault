'use client';

import { useEffect, type RefObject } from 'react';

/**
 * A bottom sheet with a text box in it opens the phone's keyboard at once, and on many phones the keyboard covers the part of the screen the sheet is
 * fixed to. While the sheet is open this follows the visible area above the keyboard: it sets `--sv-kb` (how much the keyboard covers, in px) and
 * `--sv-vvh` (how tall the visible area is) on the sheet, and `data-keyboard` while a keyboard is up, and the CSS lifts the sheet and fits it into
 * what is left. Without a keyboard (a computer, a tablet with a keyboard attached) nothing changes.
 */
export function useKeyboardLift(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !el || !vv) return;
    const apply = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      el.style.setProperty('--sv-kb', `${covered}px`);
      el.style.setProperty('--sv-vvh', `${Math.round(vv.height)}px`);
      el.toggleAttribute('data-keyboard', covered > 80);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      el.style.removeProperty('--sv-kb');
      el.style.removeProperty('--sv-vvh');
      el.removeAttribute('data-keyboard');
    };
  }, [ref, active]);
}

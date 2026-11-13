import { useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';

/**
 * How much room the workspace has, measured on its own root (not the window), so it adapts the same
 * way when the host puts it in a narrow panel on a wide screen. The CSS reads it as
 * `.sv-app[data-size="compact" | "medium" | "wide"]`, with `--sv-w` and `--sv-h` holding the measured size.
 */
export type WorkspaceSize = 'compact' | 'medium' | 'wide';

/**
 * compact: a phone. medium: a tablet held upright (narrow and taller than wide).
 * wide: everything with room for a side column, including a tablet on its side.
 */
/** A phone held on its side is short (about 400 high) and not very wide: it gets the phone layout, with the tabs in a rail down the left. */
export const isPhoneLandscape = (width: number, height: number) => width > height && height <= 520 && width <= 1000;
/** A tablet on its side (or any small window wider than tall): a wide layout, but short of room beside a draft deck panel. */
export const isTabletLandscape = (width: number, height: number) => width > height && width <= 1200 && height > 520;
export const sizeForBox = (width: number, height: number): WorkspaceSize =>
  width <= 700 || isPhoneLandscape(width, height) ? 'compact' : width <= 1100 && height > width ? 'medium' : 'wide';

/** Keeps `data-size` on the root up to date while `active` (the root is on screen). `onChange` hears the size after the first measurement and whenever it changes (`previous` is null the first time). */
export function useWorkspaceSize(ref: RefObject<HTMLElement | null>, active: boolean, onChange?: (size: WorkspaceSize, previous: WorkspaceSize | null, tabletLandscape: boolean, previousTabletLandscape: boolean | null) => void) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let last: WorkspaceSize | null = null;
    let lastTl: boolean | null = null;
    const apply = () => {
      const box = el.getBoundingClientRect();
      const size = sizeForBox(box.width, box.height);
      if (el.dataset.size !== size) el.dataset.size = size;
      if (isPhoneLandscape(box.width, box.height)) el.dataset.land = '';
      else delete el.dataset.land;
      if (size === 'wide' && isTabletLandscape(box.width, box.height)) el.dataset.tl = '';
      else delete el.dataset.tl;
      if (box.width >= 1360) el.dataset.xl = '';
      else delete el.dataset.xl;
      // Pixel sizes of this workspace, for CSS that needs a length (gutters, panel widths, heights).
      el.style.setProperty('--sv-w', `${Math.round(box.width)}px`);
      el.style.setProperty('--sv-h', `${Math.round(box.height)}px`);
      return size;
    };
    apply();
    const observer = new ResizeObserver(() => {
      const size = apply();
      const tl = el.dataset.tl !== undefined;
      if (size !== last || tl !== lastTl) {
        const previous = last;
        const previousTl = lastTl;
        last = size;
        lastTl = tl;
        onChange?.(size, previous, tl, previousTl);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measured once per mount; the latest onChange is not needed to re-subscribe
  }, [ref, active]);
}

/** The current size of the workspace that contains `from`, for code that cannot use CSS. */
export function workspaceSizeOf(from: Element | null): WorkspaceSize | null {
  return (from?.closest('.sv-app')?.getAttribute('data-size') as WorkspaceSize | null) ?? null;
}

const rootEl = () => document.querySelector('.slidevault .sv-app');
function subscribeToSize(onChange: () => void) {
  const el = rootEl();
  if (!el) return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(el, { attributes: true, attributeFilter: ['data-size', 'data-tl'] });
  return () => observer.disconnect();
}

/** True while the workspace is in its narrow (phone) layout. */
export function useWorkspaceCompact(): boolean {
  return useSyncExternalStore(subscribeToSize, () => rootEl()?.getAttribute('data-size') === 'compact', () => false);
}

/**
 * True for a phone (either way up) and for a tablet held upright: the screens that share the phone's page layouts
 * (one-row filters, one-row tags, the compact deck and slide pages). The slide preview and the tabs are decided separately.
 */
export function useWorkspacePhoneLike(): boolean {
  return useSyncExternalStore(subscribeToSize, () => { const s = rootEl()?.getAttribute('data-size'); return s === 'compact' || s === 'medium'; }, () => false);
}

/**
 * True where the filter row folds into one Filters button: a phone, a tablet held upright, and a tablet on its side
 * (where the draft deck panel leaves too little width for six separate pills).
 */
export function useWorkspaceFiltersRolled(): boolean {
  return useSyncExternalStore(
    subscribeToSize,
    () => {
      const el = rootEl();
      const s = el?.getAttribute('data-size');
      return s === 'compact' || s === 'medium' || el?.hasAttribute('data-tl') === true;
    },
    () => false,
  );
}

/** True on a tablet on its side (wide layout with limited width). */
export function useWorkspaceTabletLandscape(): boolean {
  return useSyncExternalStore(subscribeToSize, () => rootEl()?.hasAttribute('data-tl') === true, () => false);
}

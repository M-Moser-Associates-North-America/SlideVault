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
export const sizeForBox = (width: number, height: number): WorkspaceSize => (width <= 700 ? 'compact' : width <= 1100 && height > width ? 'medium' : 'wide');

/** Keeps `data-size` on the root up to date while `active` (the root is on screen). `onChange` hears the size after the first measurement and whenever it changes (`previous` is null the first time). */
export function useWorkspaceSize(ref: RefObject<HTMLElement | null>, active: boolean, onChange?: (size: WorkspaceSize, previous: WorkspaceSize | null) => void) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let last: WorkspaceSize | null = null;
    const apply = () => {
      const box = el.getBoundingClientRect();
      const size = sizeForBox(box.width, box.height);
      if (el.dataset.size !== size) el.dataset.size = size;
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
      if (size !== last) {
        const previous = last;
        last = size;
        onChange?.(size, previous);
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
  observer.observe(el, { attributes: true, attributeFilter: ['data-size'] });
  return () => observer.disconnect();
}

/** True while the workspace is in its narrow (phone) layout. */
export function useWorkspaceCompact(): boolean {
  return useSyncExternalStore(subscribeToSize, () => rootEl()?.getAttribute('data-size') === 'compact', () => false);
}

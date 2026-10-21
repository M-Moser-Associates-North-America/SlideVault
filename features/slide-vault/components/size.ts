import { useLayoutEffect, type RefObject } from 'react';

/**
 * How much room the workspace has, measured on its own root (not the window), so it adapts the same
 * way when the host puts it in a narrow panel on a wide screen. The CSS reads it as
 * `.sv-app[data-size="compact" | "medium" | "wide"]`.
 */
export type WorkspaceSize = 'compact' | 'medium' | 'wide';

export const sizeForWidth = (width: number): WorkspaceSize => (width <= 700 ? 'compact' : width <= 1100 ? 'medium' : 'wide');

/** Keeps `data-size` on the root up to date while `active` (the root is on screen). `onFirst` hears the size once, after the first measurement. */
export function useWorkspaceSize(ref: RefObject<HTMLElement | null>, active: boolean, onFirst?: (size: WorkspaceSize) => void) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let first = true;
    const apply = () => {
      const size = sizeForWidth(el.getBoundingClientRect().width);
      if (el.dataset.size !== size) el.dataset.size = size;
      return size;
    };
    apply();
    const observer = new ResizeObserver(() => {
      const size = apply();
      if (first) {
        first = false;
        onFirst?.(size);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measured once per mount; onFirst only matters on the first call
  }, [ref, active]);
}

/** The current size of the workspace that contains `from`, for code that cannot use CSS. */
export function workspaceSizeOf(from: Element | null): WorkspaceSize | null {
  return (from?.closest('.sv-app')?.getAttribute('data-size') as WorkspaceSize | null) ?? null;
}

import { createContext, useContext, type RefObject } from 'react';

/**
 * The workspace's own elements, so nothing has to reach for the window or the document:
 * `app` is the root that fills whatever space the host gives it, and `scroll` is the one area
 * inside it that scrolls. Scroll listeners, observers and "scroll to top" all use `scroll`.
 */
export type WorkspaceRoot = {
  app: RefObject<HTMLDivElement | null>;
  scroll: RefObject<HTMLDivElement | null>;
};

export const RootContext = createContext<WorkspaceRoot | null>(null);

export function useRoot(): WorkspaceRoot {
  const root = useContext(RootContext);
  if (!root) throw new Error('useRoot must be used inside the SlideVault workspace');
  return root;
}

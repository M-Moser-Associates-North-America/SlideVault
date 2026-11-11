import { useSyncExternalStore } from 'react';

/**
 * What the results page is showing (how many slides, and how they are sorted), so the bar that stays at the top
 * of a phone screen while you scroll can show it and change the sort. The results page sets it; it is cleared when
 * that page goes away.
 */
export type ResultsSummary = { count: number; sort: 'best' | 'popular' | 'newest'; setSort: (s: 'best' | 'popular' | 'newest') => void };
let summary: ResultsSummary | null = null;
const listeners = new Set<() => void>();

export function setResultsSummary(next: ResultsSummary | null) {
  if (summary && next && summary.count === next.count && summary.sort === next.sort && summary.setSort === next.setSort) return;
  summary = next;
  listeners.forEach((l) => l());
}

export function useResultsSummary(): ResultsSummary | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => summary,
    () => null,
  );
}

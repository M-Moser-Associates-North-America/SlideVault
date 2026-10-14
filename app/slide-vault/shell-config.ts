import type { Location, View } from '@/features/slide-vault';

/**
 * Where the standalone app mounts the workspace and its API.
 * Both are configurable by design (docs/INTEGRATION_CONTRACT.md, "Portability demonstration").
 */
export const UI_BASE = '/slide-vault';
export const API_ROOT = '/api/slide-vault/v1';

const VIEWS: readonly View[] = ['home', 'library', 'pages', 'browse', 'create', 'upload', 'deck', 'slide'];
export const DEFAULT_LOCATION: Location = { view: 'pages' };

/** URL path segments after UI_BASE → workspace Location. Unknown paths fall back to the default. */
export function locationFromSegments(segments: string[] = []): Location {
  const [view, id] = segments;
  if (!view) return DEFAULT_LOCATION;
  if (!(VIEWS as readonly string[]).includes(view)) return DEFAULT_LOCATION;
  if ((view === 'deck' || view === 'slide' || view === 'browse') && !id) return DEFAULT_LOCATION;
  return id ? { view: view as View, id } : { view: view as View };
}

/**
 * Workspace Location → URL path. Search text is deliberately left out of the URL so it
 * doesn't end up in shared links or history (docs/INTEGRATION_CONTRACT.md).
 */
export function pathFromLocation(location: Location): string {
  return location.id ? `${UI_BASE}/${location.view}/${encodeURIComponent(location.id)}` : `${UI_BASE}/${location.view}`;
}

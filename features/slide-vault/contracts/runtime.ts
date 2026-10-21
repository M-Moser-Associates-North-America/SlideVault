import type { ReactNode } from 'react';
/**
 * The runtime contract between the SlideVault workspace and whatever hosts it
 * (the standalone app today; possibly an internal system later).
 * Source: docs/INTEGRATION_CONTRACT.md, "Browser entry point" (contract v0.1).
 *
 * Addition to the published sketch, recorded in docs/DECISIONS.md (FD-04):
 *   assetUrl() resolves media paths (slide previews) for <img>, which cannot go through request().
 */

export const CONTRACT_VERSION = '0.1' as const;

export type Capability =
  | 'library.read'
  | 'source.upload'
  | 'source.download'
  | 'metadata.edit'
  | 'content.review'
  | 'content.retire'
  | 'source.delete'
  | 'collection.write'
  | 'export.create'
  | 'library.manage';

/** 'pages' is the Home screen (library rows and search). 'browse' (id = row key) and 'create' were added for the v3 design (FD-13). */
export type View = 'home' | 'library' | 'pages' | 'browse' | 'create' | 'upload' | 'deck' | 'slide' | 'profile' | 'settings';

export type Location = {
  view: View;
  id?: string;
  query?: string;
};

export type RuntimeRequest = {
  /** Relative to the configured SlideVault API v1 root, e.g. "/search?q=chart" */
  path: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** JSON for ordinary requests; FormData passes through untouched for file uploads. */
  body?: unknown | FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export interface SlideVaultRuntime {
  contractVersion: typeof CONTRACT_VERSION;
  /** Opaque value the host changes on sign-out, identity or access-scope changes */
  sessionScopeKey: string;
  capabilities: ReadonlySet<Capability>;
  theme: 'light' | 'dark';
  location: Location;
  navigate(next: Location, options?: { replace?: boolean }): void;
  request(input: RuntimeRequest): Promise<Response>;
  /** Resolve an API-relative media path (e.g. "/slides/sld_1/preview") to a URL for <img src>. */
  assetUrl(path: string): string;
  /** Optional: the host's URL for a location, so links can open in a new tab. Falls back to "#". */
  hrefFor?(location: Location): string;
  onSessionExpired(): void;
  requestFullscreen?: (enabled: boolean) => void;
  projectContext?: { id: string; label: string };
}

export interface SlideVaultWorkspaceProps {
  runtime: SlideVaultRuntime;
  /** Shown at the top of the workspace's scrolling area (the standalone app puts its header here). A host with its own header leaves it out. */
  header?: ReactNode;
}

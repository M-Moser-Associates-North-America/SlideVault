'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { CONTRACT_VERSION, SlideVaultWorkspace, type Capability, type RuntimeRequest, type SlideVaultRuntime } from '@/features/slide-vault';
import { API_ROOT, locationFromSegments, pathFromLocation, UI_BASE } from './shell-config';
import { useAccess } from './access';
import { useTheme } from './theme';

// Prototype (decision FD-01): no sign-in yet. One fixed session scope; the Access switch in the header
// stands in for login and decides whether upload is allowed.
const SESSION_SCOPE = 'local-dev';
const READ_EXPORT: Capability[] = ['library.read', 'collection.write', 'export.create'];
const CAPABILITIES: Record<'viewer' | 'editor' | 'curator', ReadonlySet<Capability>> = {
  viewer: new Set(READ_EXPORT),
  editor: new Set([...READ_EXPORT, 'source.upload', 'metadata.edit']),
  curator: new Set([...READ_EXPORT, 'source.upload', 'metadata.edit', 'content.review', 'content.retire']),
};

/** Only relative, same-API paths: no schemes, no host, no path traversal (docs/INTEGRATION_CONTRACT.md). */
function assertFeaturePath(path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || /^[a-z]+:/i.test(path) || path.split(/[?#]/)[0].split('/').includes('..')) {
    throw new Error(`Blocked request path: ${path}`);
  }
}

/**
 * The standalone app's runtime bridge: turns the contract's navigate/request/assetUrl into
 * Next.js routing and same-origin fetch. A host system would supply its own version of this.
 */
export function StandaloneWorkspace({ header }: { header?: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const segments = useMemo(() => pathname.slice(UI_BASE.length).split('/').filter(Boolean).map(decodeURIComponent), [pathname]);

  // Connection functions stay stable across navigation, so data isn't refetched when only the location changes.
  const services = useMemo(
    () => ({
      navigate: ((next, options) => (options?.replace ? router.replace : router.push)(pathFromLocation(next), { scroll: false })) satisfies SlideVaultRuntime['navigate'],
      request: (({ path, method, body, headers, signal }: RuntimeRequest) => {
        assertFeaturePath(path);
        // FormData passes through untouched (decision FD-10): the browser sets its own
        // multipart boundary, and JSON.stringify would corrupt the file bytes.
        const isFormData = body instanceof FormData;
        return fetch(`${API_ROOT}${path}`, {
          method,
          signal,
          headers: body === undefined || isFormData ? headers : { 'Content-Type': 'application/json', ...headers },
          body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
          credentials: 'same-origin',
        });
      }) satisfies SlideVaultRuntime['request'],
      assetUrl: ((path: string) => {
        assertFeaturePath(path);
        return `${API_ROOT}${path}`;
      }) satisfies SlideVaultRuntime['assetUrl'],
      hrefFor: pathFromLocation satisfies SlideVaultRuntime['hrefFor'],
      onSessionExpired: () => router.refresh(),
    }),
    [router],
  );

  const { theme } = useTheme();
  const { access } = useAccess();
  const runtime = useMemo<SlideVaultRuntime>(
    () => ({
      contractVersion: CONTRACT_VERSION,
      sessionScopeKey: SESSION_SCOPE,
      capabilities: CAPABILITIES[access],
      theme,
      location: locationFromSegments(segments),
      ...services,
    }),
    [segments, services, theme, access],
  );

  // The shell owns theme: the workspace renders inside the .slidevault token scope.
  return (
    <div className="slidevault" data-theme={runtime.theme} style={{ flex: '1 1 0', minHeight: 0 }}>
      <SlideVaultWorkspace runtime={runtime} header={header} />
    </div>
  );
}

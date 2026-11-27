import type { NextConfig } from 'next';

/**
 * Browser security headers on every page and API response (docs/DECISIONS.md FD-93; docs/SECURITY_AND_OPERATIONS.md).
 * No script policy here on purpose: Next's own inline scripts need one written with nonces, which is the host
 * app's job at integration. What is set can't break the app: no sniffing file types, no leaking full addresses
 * to other sites, HTTPS only once served over HTTPS, the microphone (talk to search) only for this site and no
 * camera or location, and only this site (or SV_FRAME_ANCESTORS, for M Moser's internal system) may embed it.
 */
const frameAncestors = process.env.SV_FRAME_ANCESTORS?.trim() || "'self'";
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)' },
  { key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors}; object-src 'none'; base-uri 'self'; form-action 'self'` },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  cacheComponents: true,
  partialPrefetching: true,

  // Hides the "N" developer badge in local dev (errors still show). Never appears in production.
  devIndicators: false,

  // Local dev convenience: lets hot-reload work when testing from a phone on the same Wi-Fi
  // via this Mac's LAN IP, instead of only localhost. Dev-only, has no effect on a real build.
  allowedDevOrigins: ['192.168.4.37'],

  // The library and data folders are read at runtime from configurable paths
  // (SLIDEVAULT_LIBRARY_DIR / SLIDEVAULT_DATA_DIR), so the bundler can't know which files they
  // need and would otherwise trace the whole project into a deployment. Keep client reference
  // material, fixtures, generated data and tooling out of every server bundle; deployments
  // provide the library and data folders themselves.
  outputFileTracingExcludes: {
    '/*': ['reference/**/*', 'tests/**/*', '.data/**/*', '.venv/**/*', 'docs/**/*', 'scripts/**/*'],
  },
  turbopack: {
    ignoreIssue: [{ path: '**/features/slide-vault/server/config.ts', title: /Dynamic filesystem access/ }],
  },
};

export default nextConfig;

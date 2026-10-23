import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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

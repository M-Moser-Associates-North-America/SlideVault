import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,

  // Hides the "N" developer badge in local dev (errors still show). Never appears in production.
  devIndicators: false,

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

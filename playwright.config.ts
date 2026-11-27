import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests (docs/DELIVERY_PLAN.md: "browser tests" in the verification matrix).
 * Runs against a production build on port 3100. Needs the library index: run `npm run ingest` first.
 */
const PORT = 3100;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/slide-vault/pages`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

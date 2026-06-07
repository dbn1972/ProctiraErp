import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for ProctiraERP Web E2E tests.
 *
 * The Next.js dev server for `@proctira/web` runs on port 3001 (see
 * `package.json` `dev` script). The base URL can be overridden with
 * `PLAYWRIGHT_BASE_URL` if you point the suite at a deployed environment.
 *
 * Most specs gate themselves on `E2E_BACKEND_READY=1` so that the suite can
 * be checked in and only run when an end-to-end backend is available.
 */
const PORT = process.env.PORT ?? '3001';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Desktop browsers (Volume 12 §3.3 — Chrome, Edge, Safari, Firefox)
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Mobile devices (Volume 12 §3.2 — iPhone-size, Android phone)
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
    // Tablet (Volume 12 §3.2 — iPad-size)
    {
      name: 'tablet',
      use: { ...devices['iPad (gen 7)'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @proctira/web dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});

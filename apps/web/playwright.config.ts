import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

import { resolveWebServerCommand } from './e2e/web-server-command';

/**
 * Playwright configuration for ProctiraERP Web E2E tests.
 *
 * The web server runs on port 3001 — `next start` when CI has already built it,
 * `next dev` otherwise (see `e2e/web-server-command.ts`). The base URL can be
 * overridden with `PLAYWRIGHT_BASE_URL` to point the suite at a deployed environment.
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
  // Kept at 90s for the CI jobs that still serve `next dev` — `E2E Backend Ready` and
  // `Visual Regression` build nothing, so first visits there compile routes and server
  // actions on a 2-core runner shared with the gateway, Postgres and Redis. The
  // turbo-driven Integration Tests job serves a prebuilt app and does not need this
  // headroom; the budget stays uniform rather than branching a second time on the same
  // condition.
  timeout: process.env.CI ? 90_000 : 30_000,
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // `pnpm test:e2e` only installs Chromium. Keep the full matrix available
  // locally via PLAYWRIGHT_ALL_BROWSERS=1; CI stays Chromium-only so we
  // don't fail hundreds of specs on missing Firefox/WebKit binaries.
  projects: process.env.PLAYWRIGHT_ALL_BROWSERS
    ? [
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
        // Tablet (Volume 12 §3.2 — iPad-size). Force Chromium so CI does not
        // need a WebKit install (device preset defaults to webkit).
        {
          name: 'tablet',
          use: {
            ...devices['iPad (gen 7)'],
            defaultBrowserType: 'chromium',
            browserName: 'chromium',
          },
        },
      ]
    : [
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
        // G-723 — always register tablet + Pixel so visual-regression.yml can
        // capture iPad / phone baselines without PLAYWRIGHT_ALL_BROWSERS.
        {
          name: 'mobile-chrome',
          use: { ...devices['Pixel 5'] },
        },
        {
          name: 'tablet',
          use: {
            ...devices['iPad (gen 7)'],
            defaultBrowserType: 'chromium',
            browserName: 'chromium',
          },
        },
      ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // `next start` when CI has already built, `next dev` otherwise. The decision and
        // the reasoning live in `./e2e/web-server-command.ts` — including why gating on
        // `process.env.CI` alone was wrong and took two CI gates down.
        command: resolveWebServerCommand({
          ci: Boolean(process.env.CI),
          // Resolved from this file, not `process.cwd()`: Playwright loads the config
          // as an ES module (so `__dirname` does not exist) and the working directory
          // differs between a turbo-driven run and a direct `playwright test`.
          hasProductionBuild: existsSync(new URL('.next/BUILD_ID', import.meta.url)),
          port: PORT,
        }),
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});

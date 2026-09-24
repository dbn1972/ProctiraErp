import { existsSync } from 'node:fs';

import { defineConfig } from '@playwright/test';

import { resolveProjects } from './e2e/qa-matrix';
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
  // The Volume 12 §3 test-environment matrix lives in `./e2e/qa-matrix.ts` as data, and
  // `e2e/55-responsive-layout.spec.ts` asserts every class the specification names
  // resolves to a project that launches the intended engine. It used to be a comment
  // here claiming "Chrome, Edge, Safari, Firefox" above a list with no Edge in it.
  //
  // `pnpm test:e2e` installs Chromium only, so the Firefox / WebKit / Edge projects stay
  // behind PLAYWRIGHT_ALL_BROWSERS=1 rather than failing every spec on a missing binary.
  // G-723 — `tablet` and `mobile-chrome` are always registered so visual-regression.yml
  // can capture iPad / phone baselines without that flag.
  projects: resolveProjects(process.env.PLAYWRIGHT_ALL_BROWSERS),
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

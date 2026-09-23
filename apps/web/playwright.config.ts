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
  // CI runs `next dev` on a 2-core runner shared with the gateway, Postgres and
  // Redis: first visits compile routes and server actions, so a chain of 5–7
  // page loads regularly needs more than the 30s local budget.
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
        // `next start` in CI, `next dev` locally.
        //
        // CI already builds before this runs — the Integration Tests job invokes
        // `pnpm turbo run test:e2e`, and `test:e2e` declares `dependsOn: ["build"]`
        // (turbo.json). Under `next dev` that build is thrown away and every route is
        // recompiled on first visit, so the first browser project to reach a route pays
        // the compile cost inside a 90s navigation timeout. That is the mechanism behind
        // the intermittent `page.goto: Test timeout of 90000ms exceeded` failures on
        // routes that have nothing to do with the change under test, and behind
        // `logout-oauth-redirect.spec.ts`'s fixed `waitForTimeout(500)` running out.
        // `next start` serves the build that was already paid for.
        // `e2e-next-start-precondition.test.ts` pins the `dependsOn` this relies on.
        //
        // Next warns that `next start` "does not work with output: standalone". It does
        // serve correctly — `next build` still emits the normal `.next/` server next to
        // `.next/standalone/`. The sanctioned `node .next/standalone/server.js` was
        // rejected because Next does not copy `.next/static` or `public/` into the
        // standalone directory, so it needs a per-app copy step whose failure mode is an
        // unstyled page that still returns 200 — tests would pass against a broken
        // render. If a future Next makes `next start` a hard error, switch to the
        // standalone server *and* add the static/public copy.
        //
        // Not applied to the five secondary Next apps: `tools/scripts/run-secondary-apps-e2e.sh`
        // calls `playwright test` directly rather than through turbo, so no build runs
        // and `next start` would fail outright there.
        //
        // Locally `next dev` is kept, so running a single spec needs no build first.
        command: process.env.CI
          ? `pnpm --filter @proctira/web exec next start --port ${PORT}`
          : `pnpm --filter @proctira/web exec next dev --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});

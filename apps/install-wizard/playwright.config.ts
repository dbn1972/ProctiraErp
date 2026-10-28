import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Install Wizard.
 * First-run UI smoke always runs; live configure/finalize gates on E2E_BACKEND_READY.
 */
const PORT = process.env.PORT ?? '3100';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next dev --port ${PORT}`,
        // PRC-M467: operator bootstrap secret + a per-run global install lock file.
        env: {
          INSTALL_BOOTSTRAP_SECRET:
            process.env.E2E_INSTALL_BOOTSTRAP_SECRET ?? 'e2e-install-bootstrap-secret',
          INSTALL_LOCK_FILE: join(tmpdir(), `proctira-install-e2e-${process.pid}.lock`),
        },
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});

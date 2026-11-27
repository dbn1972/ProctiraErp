import { readFileSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-driven aitest suites (`*.aitest.spec.ts`), started by `aitest run`.
 * baseURL comes from the stack state file (web app URL), so specs never
 * hard-code a port. Workers default to 2 (host capacity, program plan D11).
 */
function stackWebUrl(): string | undefined {
  const file = process.env['AITEST_STACK_STATE'];
  if (!file) return undefined;
  const state = JSON.parse(readFileSync(file, 'utf8')) as {
    urls?: { web?: Record<string, string> };
  };
  return state.urls?.web?.['web'] ?? Object.values(state.urls?.web ?? {})[0];
}

export default defineConfig({
  testDir: 'src',
  testMatch: /.*\.aitest\.spec\.ts/,
  fullyParallel: false,
  workers: Number(process.env['AITEST_PW_WORKERS'] ?? 2),
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  outputDir: process.env['AITEST_OUT_DIR']
    ? `${process.env['AITEST_OUT_DIR']}/playwright`
    : 'test-results',
  use: {
    baseURL: stackWebUrl(),
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

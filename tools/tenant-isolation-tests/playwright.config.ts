import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the tenant isolation E2E suite.
 *
 * The suite drives HTTP traffic against a small Fastify app that registers
 * the *real* `@proctira/tenant` plugin. Playwright's `webServer` option
 * spawns that app via `tsx` so the server runs in its own Node process and
 * Playwright only needs to do HTTP — keeping the gate fast (no browser),
 * deterministic, and free of any cross-package TS-loader friction.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */
const PORT = process.env['TENANT_E2E_PORT'] ?? '4711';
const BASE_URL = process.env['TENANT_E2E_BASE_URL'] ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  reporter: process.env['CI']
    ? [['list'], ['junit', { outputFile: 'test-results/tenant-isolation-e2e-junit.xml' }]]
    : 'list',
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: { 'content-type': 'application/json' },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'tenant-isolation-e2e',
    },
  ],
  webServer: process.env['TENANT_E2E_BASE_URL']
    ? undefined
    : {
        command: `tsx e2e/server-bin.ts`,
        url: `${BASE_URL}/health`,
        env: { TENANT_E2E_PORT: PORT },
        reuseExistingServer: !process.env['CI'],
        timeout: 30_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});

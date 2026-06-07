import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for tenant isolation verification suite.
 *
 * The suite is split into seven independently-runnable categories:
 *   - src/unit         (tenant scoping in queries)
 *   - src/integration  (auth/authz boundaries)
 *   - src/queue        (queue/event routing isolation)
 *   - src/search       (search result trimming)
 *   - src/cache        (cache namespace collision)
 *   - src/report       (report/export isolation)
 *
 * E2E (cross-tenant access prevention) lives under `e2e/` and is driven by
 * Playwright (see playwright.config.ts).
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    passWithNoTests: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: process.env['CI']
      ? { junit: './test-results/tenant-isolation-junit.xml' }
      : undefined,
  },
});

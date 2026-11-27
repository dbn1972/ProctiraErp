import { defineConfig } from 'vitest/config';

/**
 * Unit tests of the aitest foundation and track harnesses (PR CI unit job).
 *
 * Live suites are named `*.aitest.ts` and run only through
 * vitest.aitest.config.ts (nightly/weekly `aitest run`), so they never match
 * this include, the live gate (`tools/**\/*.live.test.ts`) or the pg gate.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.aitest.ts', 'src/**/*.aitest.spec.ts'],
    passWithNoTests: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.aitest.ts',
        'src/**/*.aitest.spec.ts',
        'src/**/index.ts',
      ],
      reporter: ['text-summary', 'json-summary', 'json'],
    },
  },
});

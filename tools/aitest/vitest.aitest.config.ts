import { defineConfig } from 'vitest/config';

/**
 * Live aitest suites (`*.aitest.ts`). Started by `aitest run <suite>`, which
 * brings up the throwaway stack and passes AITEST_STACK_STATE / AITEST_OUT_DIR.
 * Never collected by PR CI (see vitest.config.ts).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.aitest.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    pool: 'forks',
    passWithNoTests: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});

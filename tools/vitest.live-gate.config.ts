import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * W3-TEST-03 — dedicated runner for `*.live.test.ts` suites so CI can emit a
 * Vitest JSON report and assert a minimum executed-test count.
 */
export default defineConfig({
  root,
  test: {
    include: [
      'packages/**/*.live.test.ts',
      'apps/**/*.live.test.ts',
      'tools/tenant-isolation-tests/src/integration/rls-live.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Live suites talk to one Postgres; keep concurrency modest.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

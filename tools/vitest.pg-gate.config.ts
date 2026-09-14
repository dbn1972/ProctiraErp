import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * W3-TEST-04 — dedicated runner for backend Postgres repository suites
 * (`pg-*.test.ts`, integration tests) so CI can emit Vitest JSON and assert
 * that no pg-backed case silently skipped when DATABASE_URL is set.
 *
 * Complements W3-TEST-03 (`*.live.test.ts`) without overlapping file patterns.
 */
export default defineConfig({
  root,
  test: {
    include: [
      'packages/backend/**/pg-*.test.ts',
      'packages/backend/**/*.integration.test.ts',
      'packages/backend/**/create-admissions-pipeline-store.test.ts',
      'packages/backend/**/bed-assignment.test.ts',
    ],
    exclude: ['**/*.live.test.ts', '**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

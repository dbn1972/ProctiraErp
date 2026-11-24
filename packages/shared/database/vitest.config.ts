import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    root: path.resolve(__dirname),
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // PR B1: the 307 migration cases in academic-tenant-parent-fks.live.test.ts take
    // ACCESS EXCLUSIVE on ~38 academic tables (rolled back); keep files serial so they
    // never deadlock with the other live suites that write the same tables.
    fileParallelism: false,
  },
});

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname),
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // PRC-L470: fail when no test files are discovered (glob/path regressions).
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['src/result-publication-service.ts', 'src/examination-access.ts'],
      thresholds: { lines: 70, functions: 70, branches: 60, statements: 70 },
    },
  },
});

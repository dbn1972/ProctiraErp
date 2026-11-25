import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname),
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
    // PRC-L472 (topic 7 Option A): PHI coverage floors, enforced whenever the
    // suite runs with --coverage (CI unit job). Package floors sit just under
    // the measured baseline (lines 65.3, branches 71.7, functions 63.9); the
    // PHI crypto / field-ACL / read-audit modules and the access-control
    // service carry higher floors.
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 60,
        branches: 65,
        'src/phi-*.ts': { lines: 70, statements: 70, functions: 80, branches: 70 },
        'src/health-service.ts': { lines: 75, statements: 75, functions: 75, branches: 75 },
      },
    },
  },
});

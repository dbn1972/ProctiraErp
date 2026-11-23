import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname),
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // UAT-API-005: pg-audit-repository.test.ts and pg-audit-chain-tamper.live.test.ts both
    // DISABLE/ENABLE trg_audit_log_append_only in autocommit (owner role) and both assert
    // that the trigger rejects owner UPDATE/DELETE. Run files serially so one file's
    // disable window cannot reach the other file's assertion (as in tools/vitest.*-gate.config.ts).
    fileParallelism: false,
    passWithNoTests: true,
  },
});

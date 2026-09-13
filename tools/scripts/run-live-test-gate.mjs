#!/usr/bin/env node
/**
 * W3-TEST-03 — run all *.live.test.ts suites, write Vitest JSON, assert counts.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main as assertMain } from './assert-live-test-execution.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const reportDir = mkdtempSync(join(tmpdir(), 'live-gate-'));
const reportPath = join(reportDir, 'vitest-live.json');

const env = {
  ...process.env,
  CI: process.env.CI ?? 'true',
  REQUIRE_LIVE_TESTS: process.env.REQUIRE_LIVE_TESTS ?? '1',
};

if (!env.DATABASE_URL?.trim()) {
  console.error('[W3-TEST-03] DATABASE_URL is required for the live gate');
  process.exit(1);
}

const vitest = spawnSync(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--config',
    'tools/vitest.live-gate.config.ts',
    '--reporter=json',
    '--reporter=default',
    `--outputFile=${reportPath}`,
  ],
  { cwd: root, env, encoding: 'utf8', stdio: 'inherit' },
);

if (vitest.status !== 0 && vitest.status !== null) {
  // Still assert — skipped-as-pass must fail the gate even if vitest exited 0,
  // and a real failure should remain visible.
  console.error(`[W3-TEST-03] vitest exited ${vitest.status}`);
}

try {
  readFileSync(reportPath, 'utf8');
} catch {
  console.error(`[W3-TEST-03] missing report at ${reportPath}`);
  process.exit(1);
}

const code = assertMain([reportPath], env);
process.exit(code === 0 && (vitest.status === 0 || vitest.status === null) ? 0 : code || vitest.status || 1);

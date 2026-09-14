#!/usr/bin/env node
/**
 * W3-TEST-04 — run backend pg repository suites, write Vitest JSON, assert skips.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main as assertMain } from './assert-vitest-skips.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const reportDir = mkdtempSync(join(tmpdir(), 'pg-gate-'));
const reportPath = join(reportDir, 'vitest-pg.json');

const env = {
  ...process.env,
  CI: process.env.CI ?? 'true',
  FORBID_TEST_SKIPS: process.env.FORBID_TEST_SKIPS ?? '1',
};

if (!env.DATABASE_URL?.trim()) {
  console.error('[W3-TEST-04] DATABASE_URL is required for the pg gate');
  process.exit(1);
}

const vitest = spawnSync(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--config',
    'tools/vitest.pg-gate.config.ts',
    '--reporter=json',
    '--reporter=default',
    `--outputFile=${reportPath}`,
  ],
  { cwd: root, env, encoding: 'utf8', stdio: 'inherit' },
);

if (vitest.status !== 0 && vitest.status !== null) {
  console.error(`[W3-TEST-04] vitest exited ${vitest.status}`);
}

try {
  readFileSync(reportPath, 'utf8');
} catch {
  console.error(`[W3-TEST-04] missing report at ${reportPath}`);
  process.exit(1);
}

const code = assertMain(['--profile', 'pg', reportPath], env);
process.exit(code === 0 && (vitest.status === 0 || vitest.status === null) ? 0 : code || vitest.status || 1);

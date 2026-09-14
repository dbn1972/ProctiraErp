#!/usr/bin/env node
/**
 * Unit tests for W1-DATA-17 lock-contention recovery drill helpers.
 * Live drill runs when DATABASE_URL / MIGRATOR_DATABASE_URL is set.
 *
 *   node --test tools/scripts/migration-lock-recovery-drill.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseDrillArgs,
  runLockRecoveryDrill,
} from './migration-lock-recovery-drill.mjs';

test('parseDrillArgs reads --url and --skip-if-no-db', () => {
  const parsed = parseDrillArgs(['--url=postgresql://x', '--skip-if-no-db']);
  assert.equal(parsed.url, 'postgresql://x');
  assert.equal(parsed.skipIfNoDb, true);
});

test('runLockRecoveryDrill fails closed when blocked apply unexpectedly succeeds', async () => {
  const report = await runLockRecoveryDrill({
    url: 'postgresql://unused',
    delayMs: 0,
    psqlFn: () => ({ status: 0, stdout: '0', stderr: '' }),
    holdFn: () => ({ killed: false, kill() { this.killed = true; } }),
    runApplyFn: () => ({ status: 0, stdout: 'applied=1', stderr: '' }),
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => /expected apply-sql to fail/i.test(i)));
});

test('runLockRecoveryDrill passes when fail-then-resume path is clean', async () => {
  let applyCalls = 0;
  const report = await runLockRecoveryDrill({
    url: 'postgresql://unused',
    delayMs: 0,
    psqlFn: (_url, sql) => {
      if (/count\(\*\) FROM schema_migrations/.test(sql)) {
        // first ledger check during failure → 0; after resume → 1
        return { status: 0, stdout: applyCalls >= 2 ? '1' : '0', stderr: '' };
      }
      if (/SELECT recovered/.test(sql)) {
        return { status: 0, stdout: 't', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    holdFn: () => ({ killed: false, kill() { this.killed = true; } }),
    runApplyFn: () => {
      applyCalls += 1;
      if (applyCalls === 1) {
        return {
          status: 1,
          stdout: '',
          stderr: 'ERROR:  canceling statement due to lock timeout',
        };
      }
      return {
        status: 0,
        stdout: '==> Applying /tmp/x/sql/001_w1_data17_lock_probe.sql (per-file transaction)\napplied=1',
        stderr: '',
      };
    },
  });
  assert.equal(report.ok, true, report.issues.join('; '));
});

const LIVE_URL =
  process.env.MIGRATOR_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || '';

test(
  'live lock-contention recovery drill',
  { skip: !LIVE_URL ? 'DATABASE_URL unset' : false },
  async () => {
    const report = await runLockRecoveryDrill({ url: LIVE_URL, delayMs: 500 });
    assert.equal(report.ok, true, report.issues.join('; '));
  },
);

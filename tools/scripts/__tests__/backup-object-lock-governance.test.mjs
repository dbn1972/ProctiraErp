/**
 * PRC-M624 — S3 Object Lock GOVERNANCE for the first 30 days, then COMPLIANCE,
 * with a 35-day retention floor (DECISION_REGISTER ## 41).
 *
 * Contract:
 *   1. pg-backup.sh resolves the effective BACKUP_S3_OBJECT_LOCK_MODE from
 *      BACKUP_S3_OBJECT_LOCK_GOVERNANCE_UNTIL: before that UTC date -> GOVERNANCE,
 *      on/after it -> COMPLIANCE. A malformed anchor fails closed. With no anchor
 *      an explicit BACKUP_S3_OBJECT_LOCK_MODE is left untouched.
 *   2. check-backup-prod-gate.sh enforces a 35-day floor on both
 *      dr.backup.retentionDays and objectLock.retainDays in production.
 *
 * All PATH-stubbed; no database, no network, no live S3.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = resolve(here, '..');
const root = resolve(here, '..', '..', '..');
const crypto = resolve(scripts, 'backup-crypto.sh');
const pgBackup = resolve(scripts, 'pg-backup.sh');

function withSandbox(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'm624-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- pg-backup.sh object-lock mode resolver ---------------------------------

/**
 * Source only the `resolve_object_lock_mode` function out of pg-backup.sh (so we
 * never run pg_dump) plus backup-crypto.sh, then observe the --object-lock-mode
 * a stubbed `aws` receives.
 */
function runLockResolver(dir, env) {
  const log = join(dir, 'aws.log');
  const aws = join(dir, 'aws');
  writeFileSync(aws, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${log}"\n`);
  chmodSync(aws, 0o755);
  const file = join(dir, 'x.dump.age');
  writeFileSync(file, 'cipher');
  const snippet = `
    source "${crypto}"
    eval "$(sed -n '/^resolve_object_lock_mode()/,/^}/p' "${pgBackup}")"
    resolve_object_lock_mode
    backup_offsite_sync "${file}"
  `;
  const r = spawnSync('bash', ['-c', `set -euo pipefail; ${snippet}`], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: dir,
      BACKUP_OFFSITE_URI: 's3://bucket/prefix/',
      BACKUP_ENCRYPT: '1',
      BACKUP_S3_OBJECT_LOCK_RETAIN_DAYS: '35',
      ...env,
    },
  });
  let mode = null;
  if (r.status === 0) {
    const argv = readFileSync(log, 'utf8').trim().split('\n');
    const idx = argv.indexOf('--object-lock-mode');
    mode = idx >= 0 ? argv[idx + 1] : null;
  }
  return { status: r.status, stderr: r.stderr, mode };
}

test('before governanceUntil the pipeline uses GOVERNANCE', () =>
  withSandbox((dir) => {
    const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const r = runLockResolver(dir, { BACKUP_S3_OBJECT_LOCK_GOVERNANCE_UNTIL: future });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.mode, 'GOVERNANCE', r.stderr);
  }));

test('on/after governanceUntil the pipeline switches to COMPLIANCE', () =>
  withSandbox((dir) => {
    const past = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const r = runLockResolver(dir, { BACKUP_S3_OBJECT_LOCK_GOVERNANCE_UNTIL: past });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.mode, 'COMPLIANCE', r.stderr);
  }));

test('a malformed governanceUntil anchor fails closed', () =>
  withSandbox((dir) => {
    const r = runLockResolver(dir, { BACKUP_S3_OBJECT_LOCK_GOVERNANCE_UNTIL: 'not-a-date' });
    assert.notEqual(r.status, 0, 'malformed anchor must fail closed');
    assert.match(r.stderr, /GOVERNANCE_UNTIL/);
  }));

test('no anchor leaves an explicit BACKUP_S3_OBJECT_LOCK_MODE untouched', () =>
  withSandbox((dir) => {
    const r = runLockResolver(dir, { BACKUP_S3_OBJECT_LOCK_MODE: 'COMPLIANCE' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.mode, 'COMPLIANCE', r.stderr);
  }));

// ---- check-backup-prod-gate.sh 35-day floor ---------------------------------

/**
 * Build a hermetic ROOT with a copy of the gate and every file it requires,
 * substituting only the production retention/objectLock numbers under test.
 */
function runProdGate({ retentionDays, retainDays }) {
  return withSandbox((dir) => {
    const relScripts = 'tools/scripts';
    const relHelm = 'infrastructure/helm/proctira-platform';
    const relCron = `${relHelm}/templates/dr`;
    for (const d of [relScripts, join(relScripts, '__tests__'), relCron, 'docs/audits', 'docs']) {
      mkdirSync(join(dir, d), { recursive: true });
    }

    copyFileSync(
      join(scripts, 'check-backup-prod-gate.sh'),
      join(dir, relScripts, 'check-backup-prod-gate.sh'),
    );
    chmodSync(join(dir, relScripts, 'check-backup-prod-gate.sh'), 0o755);
    copyFileSync(crypto, join(dir, relScripts, 'backup-crypto.sh'));
    copyFileSync(
      join(root, relCron, 'backup-cronjob.yaml'),
      join(dir, relCron, 'backup-cronjob.yaml'),
    );
    copyFileSync(join(root, 'docs/BACKUP_RESTORE.md'), join(dir, 'docs/BACKUP_RESTORE.md'));
    copyFileSync(
      join(root, 'docs/audits/OPS_W1_OPS_04_COMPLETE.md'),
      join(dir, 'docs/audits/OPS_W1_OPS_04_COMPLETE.md'),
    );

    writeFileSync(join(dir, relHelm, 'values.yaml'), 'dr:\n  backup:\n    retentionDays: 35\n');
    writeFileSync(
      join(dir, relHelm, 'values-production.yaml'),
      [
        'global:',
        '  environment: production',
        'dr:',
        '  backup:',
        `    retentionDays: ${retentionDays}`,
        '    encrypt:',
        '      enabled: true',
        '    offsite:',
        '      enabled: true',
        '      uri: s3://proctira-prod-pg-backups/logical/',
        '      sse: AES256',
        '      objectLock:',
        '        mode: GOVERNANCE',
        `        retainDays: ${retainDays}`,
        '',
      ].join('\n'),
    );

    const r = spawnSync('bash', [join(dir, relScripts, 'check-backup-prod-gate.sh')], {
      encoding: 'utf8',
      cwd: dir,
      env: process.env,
    });
    return { status: r.status, stderr: r.stderr, stdout: r.stdout };
  });
}

test('prod gate rejects a retention floor below 35 days', () => {
  const r = runProdGate({ retentionDays: 30, retainDays: 30 });
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr + r.stdout, /35/);
});

test('prod gate accepts a 35-day retention and objectLock floor', () => {
  const r = runProdGate({ retentionDays: 35, retainDays: 35 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

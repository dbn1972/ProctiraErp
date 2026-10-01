/**
 * PRC-L383 — backup-crypto.sh must not silently keep plaintext dumps, and the
 * offsite upload must tolerate empty SSE/Object Lock arrays under `set -u`.
 * Uses PATH stubs; no database, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const crypto = resolve(here, 'backup-crypto.sh');

function withSandbox(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'l383-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function bash(dir, snippet, env = {}) {
  const r = spawnSync('bash', ['-c', `set -euo pipefail; source "${crypto}"; ${snippet}`], {
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, ...env },
  });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

test('no recipient and no opt-in refuses and removes the plaintext dump', () =>
  withSandbox((dir) => {
    const dump = join(dir, 'x.dump');
    writeFileSync(dump, 'plain');
    const r = bash(dir, `backup_encrypt_if_configured "${dump}"`);
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /refusing to keep an unencrypted dump/);
    assert.equal(existsSync(dump), false, 'plaintext dump must not be left behind');
  }));

test('BACKUP_ALLOW_PLAINTEXT=1 keeps the dump with a warning', () =>
  withSandbox((dir) => {
    const dump = join(dir, 'x.dump');
    writeFileSync(dump, 'plain');
    const r = bash(dir, `backup_encrypt_if_configured "${dump}"`, { BACKUP_ALLOW_PLAINTEXT: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, dump);
    assert.match(r.stderr, /WARNING: BACKUP_ALLOW_PLAINTEXT=1/);
  }));

test('BACKUP_ENCRYPT=1 without recipient still fails even with plaintext opt-in', () =>
  withSandbox((dir) => {
    const dump = join(dir, 'x.dump');
    writeFileSync(dump, 'plain');
    const r = bash(dir, `backup_encrypt_if_configured "${dump}"`, {
      BACKUP_ENCRYPT: '1',
      BACKUP_ALLOW_PLAINTEXT: '1',
    });
    assert.notEqual(r.status, 0);
  }));

test('offsite s3 upload passes no empty args when SSE/Object Lock are unset', () =>
  withSandbox((dir) => {
    const log = join(dir, 'aws.log');
    const aws = join(dir, 'aws');
    writeFileSync(aws, `#!/usr/bin/env bash\nprintf '%s\\n' "$#" "$@" > "${log}"\n`);
    chmodSync(aws, 0o755);
    const file = join(dir, 'x.dump.age');
    writeFileSync(file, 'cipher');
    const r = bash(dir, `backup_offsite_sync "${file}"`, {
      BACKUP_OFFSITE_URI: 's3://bucket/prefix/',
      BACKUP_ENCRYPT: '1',
    });
    assert.equal(r.status, 0, r.stderr);
    const [argc, ...argv] = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(argc, '4', `argv=${argv.join(' ')}`);
    assert.deepEqual(argv, ['s3', 'cp', file, 's3://bucket/prefix/x.dump.age']);
  }));

/**
 * PRC-L388 — setup-live-db-and-onboard.sh is certification-only: it must exit
 * before any DB work under NODE_ENV=production or against a non-local host
 * (unless ALLOW_DEMO_SEED=1).
 *
 * A PATH-stub `psql` records any invocation; no database is contacted. The
 * "passes the guard" cases point ARTIFACT_DIR beneath a regular file so the
 * script stops at the very next step (mkdir) without touching apply-sql.sh.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, 'setup-live-db-and-onboard.sh');

function runSetup(env, { blockArtifacts = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'l388-'));
  try {
    const log = join(dir, 'psql.log');
    const psql = join(dir, 'psql');
    writeFileSync(psql, `#!/usr/bin/env bash\necho "psql $*" >>"${log}"\nexit 0\n`);
    chmodSync(psql, 0o755);
    let artifactDir = join(dir, 'artifacts');
    if (blockArtifacts) {
      const blocker = join(dir, 'blocker');
      writeFileSync(blocker, '');
      artifactDir = join(blocker, 'artifacts');
    }
    const res = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        HOME: dir,
        ARTIFACT_DIR: artifactDir,
        ...env,
      },
    });
    return {
      status: res.status,
      stderr: res.stderr,
      psqlCalls: existsSync(log) ? readFileSync(log, 'utf8') : '',
      artifactsCreated: existsSync(artifactDir),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('NODE_ENV=production exits before seeding', () => {
  const r = runSetup({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
    ALLOW_DEMO_SEED: '1',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /certification-only and refuses NODE_ENV=production/);
  assert.equal(r.psqlCalls, '');
  assert.equal(r.artifactsCreated, false);
});

for (const url of [
  'postgresql://u:p@db.prod.example.com:5432/proctira',
  'postgres://u@[2001:db8::1]:5432/proctira',
  'postgresql://10.0.0.5/proctira?sslmode=require',
]) {
  test(`non-local host is refused without ALLOW_DEMO_SEED: ${url}`, () => {
    const r = runSetup({ DATABASE_URL: url });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to seed the 3000-student demo tenant/);
    assert.equal(r.psqlCalls, '');
    assert.equal(r.artifactsCreated, false);
  });
}

test('ALLOW_DEMO_SEED=1 lets a non-local disposable host past the guard', () => {
  const r = runSetup(
    { DATABASE_URL: 'postgresql://u:p@cert-db.internal:5432/x', ALLOW_DEMO_SEED: '1' },
    { blockArtifacts: true },
  );
  assert.doesNotMatch(r.stderr, /refusing/);
  assert.match(r.stderr, /ALLOW_DEMO_SEED=1/);
  assert.notEqual(r.status, 0, 'stops at mkdir of the blocked ARTIFACT_DIR');
  assert.equal(r.psqlCalls, '');
});

for (const url of [
  'postgresql://proctira:pw@localhost:5432/proctira_test',
  'postgresql://proctira:pw@127.0.0.1/proctira',
  'postgresql://proctira:pw@postgres:5432/proctira',
  'postgresql:///proctira',
]) {
  test(`local/CI host passes the guard without opt-in: ${url}`, () => {
    const r = runSetup({ DATABASE_URL: url }, { blockArtifacts: true });
    assert.doesNotMatch(r.stderr, /refusing|refuses/);
    assert.notEqual(r.status, 0, 'stops at mkdir of the blocked ARTIFACT_DIR');
    assert.equal(r.psqlCalls, '');
  });
}

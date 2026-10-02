/**
 * PRC-L382 — bootstrap-db-roles.sh must keep secrets off the psql argv and
 * must fail in production mode when the migrator keeps SUPERUSER/BYPASSRLS.
 *
 * Uses a PATH-stub `psql` that records argv, env and stdin; no database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, 'bootstrap-db-roles.sh');

const SUPER_PW = 'sup3r-S3cret';
const MIGRATOR_PW = "mig'rator-S3cret";
const APP_PW = 'app-S3cret';

const FAKE_PSQL = `#!/usr/bin/env bash
log="$FAKE_PSQL_LOG"
{ printf 'ARGV:'; printf ' %s' "$@"; printf '\\n'; printf 'PGPASSWORD=%s PGUSER=%s PGHOST=%s PGDATABASE=%s\\n' "$PGPASSWORD" "$PGUSER" "$PGHOST" "$PGDATABASE"; } >>"$log"
input=""
if [[ ! -t 0 ]]; then input="$(cat)"; fi
printf 'STDIN:%s\\n' "$input" >>"$log"
case "$input" in
  *"proctira_app OK"*) echo "proctira_app OK" ;;
  *ELEVATED*) echo "\${FAKE_MIGRATOR:-OK}" ;;
  *pg_database*) echo "1" ;;
esac
exit 0
`;

function runBootstrap(extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'l382-'));
  try {
    const psql = join(dir, 'psql');
    writeFileSync(psql, FAKE_PSQL);
    chmodSync(psql, 0o755);
    const log = join(dir, 'psql.log');
    writeFileSync(log, '');
    const env = {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: process.env.HOME ?? dir,
      FAKE_PSQL_LOG: log,
      BOOTSTRAP_DATABASE_URL: `postgresql://postgres:${SUPER_PW}@db.internal:5432/postgres?sslmode=require`,
      MIGRATOR_PASSWORD: MIGRATOR_PW,
      APP_ROLE_PASSWORD: APP_PW,
      BOOTSTRAP_DB_NAME: 'proctira',
      ...extraEnv,
    };
    const r = spawnSync('bash', [script], { encoding: 'utf8', env });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, log: readFileSync(log, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function argvLines(log) {
  return log.split('\n').filter((l) => l.startsWith('ARGV:'));
}

test('passwords and connection URL never appear on the psql argv', () => {
  const r = runBootstrap();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const argv = argvLines(r.log).join('\n');
  assert.ok(argvLines(r.log).length > 0, 'psql stub was invoked');
  for (const secret of [SUPER_PW, MIGRATOR_PW, APP_PW, 'postgresql://']) {
    assert.ok(!argv.includes(secret), `argv leaked ${secret}: ${argv}`);
  }
  // Credentials arrive through libpq env, passwords through stdin.
  assert.match(r.log, new RegExp(`PGPASSWORD=${SUPER_PW} PGUSER=postgres PGHOST=db.internal`));
  assert.match(r.log, /STDIN:ALTER ROLE proctira PASSWORD 'mig''rator-S3cret';/);
  assert.match(r.log, /STDIN:ALTER ROLE proctira_app PASSWORD 'app-S3cret';/);
  assert.match(r.log, /PGDATABASE=proctira\n/);
});

test('unsupported connection URL parameters fail closed', () => {
  const r = runBootstrap({
    BOOTSTRAP_DATABASE_URL: `postgresql://postgres:${SUPER_PW}@db:5432/postgres?bogus=1`,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unsupported connection URL parameter: bogus/);
  assert.equal(argvLines(r.log).length, 0, 'no psql call before validation');
});

test('production mode fails when the migrator keeps SUPERUSER/BYPASSRLS', () => {
  const r = runBootstrap({ NODE_ENV: 'production', FAKE_MIGRATOR: 'ELEVATED' });
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, /SUPERUSER or BYPASSRLS/);
});

test('explicit BOOTSTRAP_REQUIRE_PINNED_MIGRATOR=1 also fails on elevated migrator', () => {
  const r = runBootstrap({ BOOTSTRAP_REQUIRE_PINNED_MIGRATOR: '1', FAKE_MIGRATOR: 'ELEVATED' });
  assert.notEqual(r.status, 0, r.stdout);
});

test('non-production run warns loudly but succeeds on elevated migrator', () => {
  const r = runBootstrap({ FAKE_MIGRATOR: 'ELEVATED' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING: migrator role proctira/);
});

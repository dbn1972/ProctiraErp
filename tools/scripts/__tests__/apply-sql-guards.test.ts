/**
 * PRC-L380: apply-sql.sh run-level guards, exercised with a PATH psql stub so
 * no database is touched.
 *  - APPLY_SEEDS=1 with NODE_ENV/ENVIRONMENT=production exits 2.
 *  - A second run fails fast (exit 3) while another run holds the advisory lock.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, '..', 'apply-sql.sh');
const tmp = mkdtempSync(join(tmpdir(), 'apply-sql-guards-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// Lock probe answers $STUB_LOCK; every other psql call is logged so the test
// can prove nothing ran after a refused lock.
const bin = join(tmp, 'bin');
const calls = join(tmp, 'psql-calls.log');
spawnSync('mkdir', ['-p', bin]);
writeFileSync(
  join(bin, 'psql'),
  `#!/usr/bin/env bash
while IFS= read -r line; do
  if [[ "$line" == *pg_try_advisory_lock* ]]; then echo "\${STUB_LOCK:-f}"; continue; fi
  echo "$line" >> "${calls}"
done
`,
);
chmodSync(join(bin, 'psql'), 0o755);

function run(env: NodeJS.ProcessEnv) {
  const r = spawnSync('bash', [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: 'postgresql://stub/db',
      MIGRATOR_DATABASE_URL: '',
      BOOTSTRAP_DATABASE_URL: '',
      APPLY_SEEDS: '0',
      APPLY_STRICT_FKS: '1',
      ...env,
    },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('apply-sql.sh production seed guard (PRC-L380)', () => {
  it('APPLY_SEEDS=1 ENVIRONMENT=production exits 2', () => {
    const r = run({ APPLY_SEEDS: '1', ENVIRONMENT: 'production' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/APPLY_SEEDS=1 refused/);
  });

  it('APPLY_SEEDS=1 NODE_ENV=production exits 2 even for --dry-run', () => {
    const r = spawnSync('bash', [scriptPath, '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, APPLY_SEEDS: '1', NODE_ENV: 'production' },
    });
    expect(r.status).toBe(2);
  });
});

describe('apply-sql.sh advisory lock (PRC-L380)', () => {
  it('fails fast with a clear message when another run holds the lock', () => {
    rmSync(calls, { force: true });
    const r = run({ STUB_LOCK: 'f', APPLY_SQL_LOCK_WAIT_SECONDS: '0' });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/another apply-sql run holds the migration advisory lock/);
    // Nothing (ledger bootstrap or file apply) ran after the refused lock.
    expect(existsSync(calls) ? readFileSync(calls, 'utf8') : '').toBe('');
  });

  it('fails closed when the lock session gives no answer', () => {
    const r = run({ STUB_LOCK: 'ERROR: permission denied', APPLY_SQL_LOCK_WAIT_SECONDS: '0' });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/could not take the apply-sql advisory lock/);
  });

  it('proceeds past the lock when it is granted', () => {
    const r = run({ STUB_LOCK: 't', APPLY_SQL_LOCK_WAIT_SECONDS: '0' });
    expect(r.stdout).toMatch(/Holding migration advisory lock/);
    expect(r.stdout).toMatch(/Ensuring schema_migrations/);
  });
});

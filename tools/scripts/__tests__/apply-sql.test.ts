/**
 * Smoke + W1-DATA-05 ledger-safe resume tests for tools/scripts/apply-sql.sh.
 *
 * Live Postgres cases need DATABASE_URL (or MIGRATOR_DATABASE_URL). They create
 * objects only under APPLY_SQL_DIR fixtures — never against production db/sql.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const scriptPath = resolve(here, '..', 'apply-sql.sh');
const sqlDir = resolve(repoRoot, 'db/sql');
const scriptSource = readFileSync(scriptPath, 'utf8');

const LIVE_URL =
  process.env.MIGRATOR_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || '';

function dryRun(env: NodeJS.ProcessEnv = {}): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('bash', [scriptPath, '--dry-run'], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, ...env },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runApply(env: NodeJS.ProcessEnv): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('bash', [scriptPath], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, ...env },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function psql(url: string, sql: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], {
    encoding: 'utf8',
  });
  return {
    status: result.status ?? -1,
    stdout: (result.stdout ?? '').trim(),
    stderr: result.stderr ?? '',
  };
}

describe('apply-sql.sh', () => {
  it('dry-run lists expected numbered SQL files in LC_ALL=C order', () => {
    const expected = readdirSync(sqlDir)
      .filter((name) => /^[0-9].*\.sql$/.test(name))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // JS default is code-unit / C-like

    expect(expected.length).toBeGreaterThanOrEqual(15);
    expect(expected.some((n) => n.startsWith('001_'))).toBe(true);
    expect(expected.some((n) => n.startsWith('014_'))).toBe(true);
    expect(expected.some((n) => n.startsWith('016_'))).toBe(true);

    // Schema must precede colocated *b* seed for the same number prefix.
    const idx006 = expected.indexOf('006_transport_schema.sql');
    const idx006b = expected.indexOf('006b_transport_seed.sql');
    expect(idx006).toBeGreaterThanOrEqual(0);
    expect(idx006b).toBeGreaterThanOrEqual(0);
    expect(idx006).toBeLessThan(idx006b);

    const { status, stdout, stderr } = dryRun();
    expect(status, stderr).toBe(0);
    expect(stdout).toMatch(/Dry run only/);
    expect(stdout).toMatch(/W1-DATA-05/);

    for (const name of expected) {
      expect(stdout).toContain(`db/sql/${name}`);
    }

    // Only the apply-order section (before "==> Skipped") — skipped seeds/FKs
    // also print as "  - db/sql/..." and must not be compared to readdir().
    const applySection = stdout.split('==> Skipped')[0] ?? stdout;
    const listed = [...applySection.matchAll(/^\s*-\s*(db\/sql\/[^\s]+)/gm)].map((m) => m[1]);
    const expectedApplied = expected.filter((n) => {
      if (/^[0-9]+b_.*_seed\.sql$/.test(n) && process.env.APPLY_SEEDS !== '1') return false;
      // W1-DATA-06: 021a prerequisite tenants + 021b NOT VALID FKs are opt-in.
      if (
        (n === '021a_strict_fk_prerequisite_tenants.sql' ||
          n === '021b_tenant_fk_constraints.sql') &&
        process.env.APPLY_STRICT_FKS !== '1'
      ) {
        return false;
      }
      return true;
    });
    expect(listed).toEqual(expectedApplied.map((n) => `db/sql/${n}`));
  });

  it('W1-DATA-05 static contract: ledger skip, checksum fail-closed, per-file TX', () => {
    expect(scriptSource).toMatch(/W1-DATA-05/);
    expect(scriptSource).toMatch(/schema_migrations/);
    expect(scriptSource).toMatch(/checksum mismatch/);
    expect(scriptSource).toMatch(/--single-transaction/);
    expect(scriptSource).toMatch(/Multi-statement limits/);
    expect(scriptSource).toMatch(/APPLY_SQL_NO_TX/);
    expect(scriptSource).toMatch(/CREATE TABLE IF NOT EXISTS schema_migrations/);
    // Must not blindly overwrite drifted checksums at end-of-run.
    expect(scriptSource).not.toMatch(
      /Recording \$\{#SQL_FILES\[@\]\} files in schema_migrations[\s\S]*ON CONFLICT \(filename\) DO UPDATE SET checksum = EXCLUDED\.checksum/,
    );
  });

  it('W1-DATA-10 static contract: optional role bootstrap before ledger apply', () => {
    expect(scriptSource).toMatch(/W1-DATA-10/);
    expect(scriptSource).toMatch(/bootstrap-db-roles\.sh/);
    expect(scriptSource).toMatch(/BOOTSTRAP_DATABASE_URL/);
    expect(scriptSource).toMatch(/maybe_bootstrap_roles/);
  });

  it('W1-DATA-17 static contract: lock_timeout + statement_timeout on every session', () => {
    expect(scriptSource).toMatch(/W1-DATA-17/);
    expect(scriptSource).toMatch(/migration-timeouts\.sh/);
    expect(scriptSource).toMatch(/SET lock_timeout TO/);
    expect(scriptSource).toMatch(/SET statement_timeout TO/);
    expect(scriptSource).toMatch(/APPLY_SQL_LOCK_TIMEOUT/);
    expect(scriptSource).toMatch(/APPLY_SQL_STATEMENT_TIMEOUT/);
    expect(dryRun().stdout).toMatch(/W1-DATA-17/);
    expect(dryRun().stdout).toMatch(/lock_timeout=/);
  });
});

describe.skipIf(!LIVE_URL)('apply-sql.sh W1-DATA-05 ledger (live Postgres)', () => {
  let fixtureRoot = '';
  let fixtureSql = '';

  function writeFixture(name: string, body: string): string {
    const path = join(fixtureSql, name);
    writeFileSync(path, body, 'utf8');
    return path;
  }

  function resetLedgerAndArtifacts() {
    const r = psql(
      LIVE_URL,
      `DROP TABLE IF EXISTS w1_data05_probe CASCADE;
       DROP TABLE IF EXISTS schema_migrations CASCADE;`,
    );
    expect(r.status, r.stderr).toBe(0);
  }

  it('applies, records checksum, skips on resume, fails on checksum mismatch', () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'w1-data05-'));
    fixtureSql = join(fixtureRoot, 'sql');
    mkdirSync(fixtureSql, { recursive: true });
    chmodSync(scriptPath, 0o755);

    try {
      resetLedgerAndArtifacts();

      const f1 = writeFixture(
        '001_probe.sql',
        `CREATE TABLE w1_data05_probe (id int PRIMARY KEY);
INSERT INTO w1_data05_probe (id) VALUES (1);`,
      );
      writeFixture(
        '002_probe.sql',
        `INSERT INTO w1_data05_probe (id) VALUES (2);`,
      );

      const env = {
        DATABASE_URL: LIVE_URL,
        MIGRATOR_DATABASE_URL: LIVE_URL,
        APPLY_SQL_DIR: fixtureSql,
        APPLY_SEEDS: '0',
        APPLY_STRICT_FKS: '0',
      };

      const first = runApply(env);
      expect(first.status, first.stderr + first.stdout).toBe(0);
      expect(first.stdout).toMatch(/Applying .*001_probe\.sql/);
      expect(first.stdout).toMatch(/Applying .*002_probe\.sql/);
      expect(first.stdout).toMatch(/applied=2/);

      const sum1 = sha256(f1);
      const ledger1 = psql(
        LIVE_URL,
        `SELECT checksum FROM schema_migrations WHERE filename = '001_probe.sql'`,
      );
      expect(ledger1.status, ledger1.stderr).toBe(0);
      expect(ledger1.stdout).toBe(sum1);

      const count1 = psql(LIVE_URL, `SELECT count(*) FROM w1_data05_probe`);
      expect(count1.stdout).toBe('2');

      // Resume: both skipped, no duplicate insert of id=2.
      const second = runApply(env);
      expect(second.status, second.stderr + second.stdout).toBe(0);
      expect(second.stdout).toMatch(/Skip .*001_probe\.sql \(ledger checksum match\)/);
      expect(second.stdout).toMatch(/Skip .*002_probe\.sql \(ledger checksum match\)/);
      expect(second.stdout).toMatch(/applied=0/);
      expect(second.stdout).toMatch(/ledger_skipped=2/);

      const count2 = psql(LIVE_URL, `SELECT count(*) FROM w1_data05_probe`);
      expect(count2.stdout).toBe('2');

      // Drift: change 001 content → fail closed.
      writeFileSync(
        f1,
        `CREATE TABLE IF NOT EXISTS w1_data05_probe (id int PRIMARY KEY);
INSERT INTO w1_data05_probe (id) VALUES (99) ON CONFLICT DO NOTHING;
-- drifted`,
        'utf8',
      );
      const drifted = runApply(env);
      expect(drifted.status).not.toBe(0);
      expect(`${drifted.stderr}${drifted.stdout}`).toMatch(/checksum mismatch/);

      // Partial resume: only 002 recorded, 001 missing → applies 001 only.
      resetLedgerAndArtifacts();
      writeFileSync(
        f1,
        `CREATE TABLE w1_data05_probe (id int PRIMARY KEY);
INSERT INTO w1_data05_probe (id) VALUES (1);`,
        'utf8',
      );
      const seedPartial = runApply(env);
      expect(seedPartial.status, seedPartial.stderr + seedPartial.stdout).toBe(0);
      psql(LIVE_URL, `DELETE FROM schema_migrations WHERE filename = '002_probe.sql'`);
      psql(LIVE_URL, `DELETE FROM w1_data05_probe WHERE id = 2`);

      const resumePartial = runApply(env);
      expect(resumePartial.status, resumePartial.stderr + resumePartial.stdout).toBe(0);
      expect(resumePartial.stdout).toMatch(/Skip .*001_probe\.sql/);
      expect(resumePartial.stdout).toMatch(/Applying .*002_probe\.sql/);
      expect(psql(LIVE_URL, `SELECT count(*) FROM w1_data05_probe`).stdout).toBe('2');
    } finally {
      resetLedgerAndArtifacts();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('adopts legacy NULL checksum without re-applying', () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'w1-data05-null-'));
    fixtureSql = join(fixtureRoot, 'sql');
    mkdirSync(fixtureSql, { recursive: true });

    try {
      resetLedgerAndArtifacts();
      const f1 = writeFixture(
        '001_null_legacy.sql',
        `CREATE TABLE w1_data05_probe (id int PRIMARY KEY);
INSERT INTO w1_data05_probe (id) VALUES (7);`,
      );

      const env = {
        DATABASE_URL: LIVE_URL,
        MIGRATOR_DATABASE_URL: LIVE_URL,
        APPLY_SQL_DIR: fixtureSql,
      };

      const first = runApply(env);
      expect(first.status, first.stderr + first.stdout).toBe(0);

      psql(
        LIVE_URL,
        `UPDATE schema_migrations SET checksum = NULL WHERE filename = '001_null_legacy.sql'`,
      );

      const adopt = runApply(env);
      expect(adopt.status, adopt.stderr + adopt.stdout).toBe(0);
      expect(adopt.stdout).toMatch(/Adopt NULL checksum/);
      expect(adopt.stdout).toMatch(/applied=0/);

      const sum = sha256(f1);
      expect(
        psql(
          LIVE_URL,
          `SELECT checksum FROM schema_migrations WHERE filename = '001_null_legacy.sql'`,
        ).stdout,
      ).toBe(sum);
      // Still a single row — file was not re-applied.
      expect(psql(LIVE_URL, `SELECT count(*) FROM w1_data05_probe`).stdout).toBe('1');
    } finally {
      resetLedgerAndArtifacts();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

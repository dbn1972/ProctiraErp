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
const splitPhasesPath = resolve(here, '..', 'split-sql-phases.mjs');
const sqlDir = resolve(repoRoot, 'db/sql');
const scriptSource = readFileSync(scriptPath, 'utf8');

const LIVE_URL =
  process.env.MIGRATOR_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || '';

function dryRun(env: NodeJS.ProcessEnv = {}): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  const result = spawnSync('bash', [scriptPath, '--dry-run'], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: merged,
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

    // Pin APPLY_STRICT_FKS=0 so CI=true agent environments do not flip the
    // production default and change which files appear in the apply list.
    const { status, stdout, stderr } = dryRun({ APPLY_STRICT_FKS: '0' });
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
    const strictFkFiles = new Set([
      '021a_strict_fk_prerequisite_tenants.sql',
      '021b_tenant_fk_constraints.sql',
      '068_validate_tenant_fk_constraints.sql',
      '082_repair_strict_tenant_fk_validate.sql',
      // 100 finishes the text→uuid migration for the last 23 tables and closes
      // with a repo-wide assertion over FKs that 021b creates and 068/082
      // validate. Ungated it asserted a state this very configuration skips
      // producing, so a bare apply on a clean database failed after 100+ files.
      '100_tenant_id_uuid_fks.sql',
    ]);
    const expectedApplied = expected.filter((n) => {
      if (/^[0-9]+b_.*_seed\.sql$/.test(n) && process.env.APPLY_SEEDS !== '1') return false;
      // W1-DATA-06: create + VALIDATE + repair + uuid completion are
      // gated together.
      if (strictFkFiles.has(n)) return false;
      return true;
    });
    expect(listed).toEqual(expectedApplied.map((n) => `db/sql/${n}`));
  });

  it('W1-DATA-06: CI/production default ON includes strict FK files', () => {
    const { status, stdout, stderr } = dryRun({
      CI: 'true',
      // Unset explicit flag so the script's CI default path is exercised.
      APPLY_STRICT_FKS: undefined,
    });
    expect(status, stderr).toBe(0);
    const applySection = stdout.split('==> Skipped')[0] ?? stdout;
    expect(applySection).toContain('021b_tenant_fk_constraints.sql');
    expect(applySection).toContain('068_validate_tenant_fk_constraints.sql');
    expect(applySection).toContain('082_repair_strict_tenant_fk_validate.sql');
    expect(applySection).toContain('100_tenant_id_uuid_fks.sql');
    // Asserting "100 is applied under CI=true" alone is vacuous: it holds whether
    // or not 100 is gated, because an ungated file is always applied. What makes
    // it meaningful is that the same file moves to the skip side when the flag is
    // off — the pair below, not either half.
    const off = dryRun({ CI: undefined, NODE_ENV: undefined, APPLY_STRICT_FKS: undefined });
    expect(off.status, off.stderr).toBe(0);
    expect(off.stdout.split('==> Skipped')[1] ?? '').toContain('100_tenant_id_uuid_fks.sql');
  });
  it('W1-DATA-06: the developer default skips 100 rather than failing on it', () => {
    // The configuration a developer gets from a bare `bash apply-sql.sh`. 100
    // must be on the skip side of the ledger, not the apply side: its closing
    // assertion covers FKs that 021b/068/082 create and validate, and those are
    // skipped here too, so applying 100 alone fails on a clean database.
    const { status, stdout, stderr } = dryRun({
      CI: undefined,
      NODE_ENV: undefined,
      APPLY_STRICT_FKS: undefined,
    });
    expect(status, stderr).toBe(0);
    const [applySection, skippedSection = ''] = stdout.split('==> Skipped');
    expect(applySection).not.toContain('100_tenant_id_uuid_fks.sql');
    expect(skippedSection).toContain('100_tenant_id_uuid_fks.sql');
    // The rest of the family travels with it — otherwise 100 would be gated
    // while its prerequisites applied, which is a different broken state.
    for (const name of [
      '021a_strict_fk_prerequisite_tenants.sql',
      '021b_tenant_fk_constraints.sql',
      '068_validate_tenant_fk_constraints.sql',
      '082_repair_strict_tenant_fk_validate.sql',
    ]) {
      expect(skippedSection, name).toContain(name);
    }
  });

  it('W1-DATA-06 static contract: default ON + gated validate/repair', () => {
    expect(scriptSource).toMatch(/W1-DATA-06/);
    expect(scriptSource).toMatch(/NODE_ENV/);
    expect(scriptSource).toMatch(/068_validate_tenant_fk_constraints\.sql/);
    expect(scriptSource).toMatch(/082_repair_strict_tenant_fk_validate\.sql/);
    expect(scriptSource).toMatch(/APPLY_STRICT_FKS\s*=\s*1/);
  });

  it('W1-DATA-05 static contract: ledger skip, checksum fail-closed, per-file TX', () => {
    expect(scriptSource).toMatch(/W1-DATA-05/);
    expect(scriptSource).toMatch(/schema_migrations/);
    expect(scriptSource).toMatch(/schema_migration_phases/);
    expect(scriptSource).toMatch(/checksum mismatch/);
    expect(scriptSource).toMatch(/--single-transaction/);
    expect(scriptSource).toMatch(/Multi-statement limits/);
    expect(scriptSource).toMatch(/APPLY_SQL_NO_TX/);
    expect(scriptSource).toMatch(/CREATE TABLE IF NOT EXISTS schema_migrations/);
    expect(scriptSource).toMatch(/CREATE TABLE IF NOT EXISTS schema_migration_phases/);
    expect(scriptSource).toMatch(/apply_file_with_phases/);
    expect(scriptSource).toMatch(/APPLY_SQL_ALLOW_FAIL_INJECT/);
    expect(scriptSource).toMatch(/split-sql-phases\.mjs/);
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
    expect(scriptSource).toMatch(/lock_not_available|lock_timeout/);
    expect(scriptSource).toMatch(/migration-lock-recovery-drill/);
    expect(dryRun().stdout).toMatch(/W1-DATA-17/);
    expect(dryRun().stdout).toMatch(/lock_timeout=/);
  });
});

describe('splitSqlPhases (W1-DATA-05)', () => {
  it('splits statements and preserves dollar-quoted bodies via CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'w1-data05-split-'));
    const input = join(dir, 'in.sql');
    const out = join(dir, 'out');
    writeFileSync(
      input,
      `
CREATE TABLE t (id int);
-- comment only line should not become a phase alone after prior ;
CREATE OR REPLACE FUNCTION f() RETURNS void AS $$
BEGIN
  PERFORM 1;
END;
$$ LANGUAGE plpgsql;
CREATE INDEX CONCURRENTLY IF NOT EXISTS t_id_idx ON t (id);
`,
      'utf8',
    );
    try {
      const result = spawnSync('node', [splitPhasesPath, input, out], {
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('3');
      const files = readdirSync(out).sort();
      expect(files).toEqual(['000.sql', '001.sql', '002.sql']);
      expect(readFileSync(join(out, '000.sql'), 'utf8')).toMatch(/CREATE TABLE t/);
      expect(readFileSync(join(out, '001.sql'), 'utf8')).toMatch(/CREATE OR REPLACE FUNCTION/);
      expect(readFileSync(join(out, '001.sql'), 'utf8')).toMatch(/PERFORM 1;/);
      expect(readFileSync(join(out, '002.sql'), 'utf8')).toMatch(/CREATE INDEX CONCURRENTLY/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores comment-only trailing chunks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'w1-data05-split2-'));
    const input = join(dir, 'in.sql');
    const out = join(dir, 'out');
    writeFileSync(input, `SELECT 1;\n-- done\n`, 'utf8');
    try {
      const result = spawnSync('node', [splitPhasesPath, input, out], {
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
       DROP TABLE IF EXISTS w1_data05_phase_probe CASCADE;
       DROP INDEX IF EXISTS w1_data05_phase_probe_v_idx;
       DROP TABLE IF EXISTS schema_migration_phases CASCADE;
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
      writeFixture('002_probe.sql', `INSERT INTO w1_data05_probe (id) VALUES (2);`);

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

  it('non-txn phase ledger: mid-fail after phase record resumes deterministically', () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'w1-data05-phases-'));
    fixtureSql = join(fixtureRoot, 'sql');
    mkdirSync(fixtureSql, { recursive: true });
    chmodSync(scriptPath, 0o755);

    try {
      resetLedgerAndArtifacts();
      writeFixture(
        '001_phases_concurrent.sql',
        `-- Idempotent compensating-forward phases (non-txn / CONCURRENTLY path)
CREATE TABLE IF NOT EXISTS w1_data05_phase_probe (
  id int PRIMARY KEY,
  v text NOT NULL
);
INSERT INTO w1_data05_phase_probe (id, v) VALUES (1, 'a')
  ON CONFLICT (id) DO UPDATE SET v = EXCLUDED.v;
CREATE INDEX CONCURRENTLY IF NOT EXISTS w1_data05_phase_probe_v_idx
  ON w1_data05_phase_probe (v);
INSERT INTO w1_data05_phase_probe (id, v) VALUES (2, 'b')
  ON CONFLICT (id) DO UPDATE SET v = EXCLUDED.v;
`,
      );

      const envBase = {
        DATABASE_URL: LIVE_URL,
        MIGRATOR_DATABASE_URL: LIVE_URL,
        APPLY_SQL_DIR: fixtureSql,
        APPLY_SEEDS: '0',
        APPLY_STRICT_FKS: '0',
        APPLY_SQL_ALLOW_FAIL_INJECT: '1',
      };

      // Fail after phase 1 is recorded (table + first insert done; index not yet).
      const injected = runApply({
        ...envBase,
        APPLY_SQL_FAIL_AFTER_PHASE: '1',
      });
      expect(injected.status).not.toBe(0);
      expect(`${injected.stderr}${injected.stdout}`).toMatch(
        /fail-inject APPLY_SQL_FAIL_AFTER_PHASE=1/,
      );
      expect(injected.stdout).toMatch(/Phase ledger/);
      expect(injected.stdout).toMatch(/Applying phase 0/);
      expect(injected.stdout).toMatch(/Applying phase 1/);

      const midPhases = psql(
        LIVE_URL,
        `SELECT phase_idx::text FROM schema_migration_phases
         WHERE filename = '001_phases_concurrent.sql' ORDER BY phase_idx`,
      );
      expect(midPhases.stdout).toBe('0\n1');
      expect(psql(LIVE_URL, `SELECT count(*) FROM schema_migrations`).stdout).toBe('0');
      expect(psql(LIVE_URL, `SELECT count(*) FROM w1_data05_phase_probe`).stdout).toBe('1');

      // Resume: skip phases 0–1, apply 2–3, record file ledger.
      const resumed = runApply(envBase);
      expect(resumed.status, resumed.stderr + resumed.stdout).toBe(0);
      expect(resumed.stdout).toMatch(/Skip phase 0/);
      expect(resumed.stdout).toMatch(/Skip phase 1/);
      expect(resumed.stdout).toMatch(/Applying phase 2/);
      expect(resumed.stdout).toMatch(/Applying phase 3/);
      expect(resumed.stdout).toMatch(/applied=1/);

      expect(
        psql(
          LIVE_URL,
          `SELECT checksum IS NOT NULL FROM schema_migrations
           WHERE filename = '001_phases_concurrent.sql'`,
        ).stdout,
      ).toBe('t');
      expect(psql(LIVE_URL, `SELECT count(*) FROM w1_data05_phase_probe`).stdout).toBe('2');
      expect(
        psql(
          LIVE_URL,
          `SELECT count(*) FROM pg_class WHERE relname = 'w1_data05_phase_probe_v_idx'`,
        ).stdout,
      ).toBe('1');

      // Second resume: file-level skip.
      const again = runApply(envBase);
      expect(again.status, again.stderr + again.stdout).toBe(0);
      expect(again.stdout).toMatch(/Skip .*001_phases_concurrent\.sql \(ledger checksum match\)/);
      expect(again.stdout).toMatch(/applied=0/);
    } finally {
      resetLedgerAndArtifacts();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('non-txn phase ledger: fail after DDL before phase row, resume re-runs idempotent phase', () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'w1-data05-phases-ddl-'));
    fixtureSql = join(fixtureRoot, 'sql');
    mkdirSync(fixtureSql, { recursive: true });

    try {
      resetLedgerAndArtifacts();
      writeFixture(
        '001_idempotent_phases.sql',
        `CREATE TABLE IF NOT EXISTS w1_data05_phase_probe (id int PRIMARY KEY);
INSERT INTO w1_data05_phase_probe (id) VALUES (10) ON CONFLICT DO NOTHING;
INSERT INTO w1_data05_phase_probe (id) VALUES (20) ON CONFLICT DO NOTHING;
`,
      );

      const envBase = {
        DATABASE_URL: LIVE_URL,
        MIGRATOR_DATABASE_URL: LIVE_URL,
        APPLY_SQL_DIR: fixtureSql,
        APPLY_SQL_NO_TX: '1',
        APPLY_SQL_ALLOW_FAIL_INJECT: '1',
      };

      const injected = runApply({
        ...envBase,
        APPLY_SQL_FAIL_AFTER_PHASE_DDL: '1',
      });
      expect(injected.status).not.toBe(0);
      expect(`${injected.stderr}${injected.stdout}`).toMatch(
        /fail-inject APPLY_SQL_FAIL_AFTER_PHASE_DDL=1/,
      );

      // Phase 0 recorded; phase 1 DDL applied but not recorded; phase 2 pending.
      expect(
        psql(
          LIVE_URL,
          `SELECT phase_idx::text FROM schema_migration_phases
           WHERE filename = '001_idempotent_phases.sql' ORDER BY phase_idx`,
        ).stdout,
      ).toBe('0');
      expect(psql(LIVE_URL, `SELECT count(*) FROM w1_data05_phase_probe`).stdout).toBe('1');

      const resumed = runApply({
        DATABASE_URL: LIVE_URL,
        MIGRATOR_DATABASE_URL: LIVE_URL,
        APPLY_SQL_DIR: fixtureSql,
        APPLY_SQL_NO_TX: '1',
      });
      expect(resumed.status, resumed.stderr + resumed.stdout).toBe(0);
      expect(resumed.stdout).toMatch(/Skip phase 0/);
      expect(resumed.stdout).toMatch(/Applying phase 1/);
      expect(resumed.stdout).toMatch(/Applying phase 2/);
      expect(psql(LIVE_URL, `SELECT count(*) FROM w1_data05_phase_probe`).stdout).toBe('2');
      expect(
        psql(
          LIVE_URL,
          `SELECT count(*) FROM schema_migrations
           WHERE filename = '001_idempotent_phases.sql'`,
        ).stdout,
      ).toBe('1');
    } finally {
      resetLedgerAndArtifacts();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

// PRC-L556: the seed-checksum re-baseline allow-list. A reviewed exact-triple
// entry re-baselines a *seed* file's ledger checksum without re-applying; every
// other mismatch still fails closed, and a numbered migration can never be
// re-baselined.
describe('apply-sql.sh seed checksum re-baseline (PRC-L556, static contract)', () => {
  const seedFiles = [
    '006b_transport_seed.sql',
    '007b_communication_seed.sql',
    '008b_hostel_seed.sql',
    '009b_library_seed.sql',
    '010b_parent_portal_seed.sql',
    '077b_guardian_custody_demo_seed.sql',
  ];

  it('is_seed_file gates the allow-list; the branch lives inside the mismatch path', () => {
    // The lookup is only reachable from the fail-closed txn-path mismatch branch.
    // (There is an earlier "phase checksum mismatch" message on the non-txn path;
    // use the exact per-file error line to anchor the comparison.)
    const mismatchIdx = scriptSource.indexOf('error: W1-DATA-05 checksum mismatch for $name"');
    const lookupIdx = scriptSource.indexOf('seed_rebaseline_lookup "$name"');
    expect(lookupIdx).toBeGreaterThan(0);
    expect(mismatchIdx).toBeGreaterThan(0);
    // The re-baseline call precedes (guards) the fail-closed error in the block.
    expect(lookupIdx).toBeLessThan(mismatchIdx);
    // Helper rejects non-seed files via is_seed_file before reading the file.
    expect(scriptSource).toMatch(/is_seed_file "\$name" \|\| return 1/);
    // Seeds-only regex is re-checked on the entry's own filename.
    expect(scriptSource).toMatch(/\^\[0-9\]\+b_\.\*_seed/);
  });

  it('the shipped allow-list names only seed files with the current file checksum', () => {
    const list = JSON.parse(
      readFileSync(resolve(here, '..', 'seed-checksum-rebaseline.json'), 'utf8'),
    ) as Array<{ filename: string; oldChecksum: string; newChecksum: string; prcId: string }>;
    expect(Array.isArray(list)).toBe(true);
    for (const e of list) {
      expect(e.filename, `${e.filename} must be a seed file`).toMatch(/^[0-9]+b_.*_seed\.sql$/);
      expect(e.oldChecksum).toMatch(/^[0-9a-f]{64}$/);
      expect(e.newChecksum).toMatch(/^[0-9a-f]{64}$/);
      // newChecksum must equal the checksum of the file as shipped on this branch.
      const current = sha256(resolve(sqlDir, e.filename));
      expect(current, `${e.filename} newChecksum must match the shipped file`).toBe(e.newChecksum);
      // A re-baseline is only meaningful when the content actually changed.
      expect(e.newChecksum).not.toBe(e.oldChecksum);
    }
    // Every edited colocated seed is covered.
    for (const f of seedFiles) {
      expect(
        list.some((e) => e.filename === f),
        `${f} missing from allow-list`,
      ).toBe(true);
    }
  });

  it('each colocated seed binds the tenant GUC and RAISEs on a zero-row RLS no-op', () => {
    for (const f of seedFiles) {
      const body = readFileSync(resolve(sqlDir, f), 'utf8');
      // Cert-seed pattern: bind the canonical tenant GUC before writes.
      expect(body, `${f} must bind set_app_tenant_id`).toMatch(/set_app_tenant_id\(/);
      // Fail closed on a zero-row no-op (RLS filtered insert).
      expect(body, `${f} must RAISE on zero rows`).toMatch(
        /RAISE EXCEPTION 'PRC-L556:[\s\S]*zero rows/,
      );
    }
  });
});

describe.skipIf(!LIVE_URL)('apply-sql.sh seed re-baseline (live Postgres, PRC-L556)', () => {
  let fixtureRoot = '';
  let fixtureSql = '';
  let allowListPath = '';

  function writeFixture(name: string, body: string): string {
    const p = join(fixtureSql, name);
    writeFileSync(p, body, 'utf8');
    return p;
  }

  function resetLedger() {
    const r = psql(
      LIVE_URL,
      `DROP TABLE IF EXISTS schema_migration_phases CASCADE;
       DROP TABLE IF EXISTS schema_migrations CASCADE;`,
    );
    expect(r.status, r.stderr).toBe(0);
  }

  function baseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      DATABASE_URL: LIVE_URL,
      MIGRATOR_DATABASE_URL: LIVE_URL,
      APPLY_SQL_DIR: fixtureSql,
      SEED_REBASELINE_FILE: allowListPath,
      APPLY_SEEDS: '1',
      APPLY_STRICT_FKS: '0',
      CI: '',
      ...extra,
    };
  }

  it('re-baselines only a listed exact triple; every other mismatch fails closed', () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'l556-'));
    fixtureSql = join(fixtureRoot, 'sql');
    mkdirSync(fixtureSql, { recursive: true });
    allowListPath = join(fixtureRoot, 'rebaseline.json');
    chmodSync(scriptPath, 0o755);

    try {
      resetLedger();

      // A seed fixture and a numbered-migration fixture.
      const seedV1 = `CREATE TABLE IF NOT EXISTS l556_probe (id int PRIMARY KEY);
INSERT INTO l556_probe (id) VALUES (1) ON CONFLICT DO NOTHING;`;
      const seed = writeFixture('900b_demo_seed.sql', seedV1);
      const mig = writeFixture(
        '901_demo_migration.sql',
        `INSERT INTO l556_probe (id) VALUES (2) ON CONFLICT DO NOTHING;`,
      );
      const oldSeedSum = sha256(seed);

      // First apply records both checksums.
      writeFileSync(allowListPath, '[]', 'utf8');
      const first = runApply(baseEnv());
      expect(first.status, first.stderr + first.stdout).toBe(0);
      expect(
        psql(
          LIVE_URL,
          `SELECT checksum FROM schema_migrations WHERE filename = '900b_demo_seed.sql'`,
        ).stdout,
      ).toBe(oldSeedSum);

      // (1) Modify the seed but DO NOT list it → re-apply still fails closed.
      writeFileSync(seed, `${seedV1}\n-- drift (unlisted)`, 'utf8');
      const unlisted = runApply(baseEnv());
      expect(unlisted.status, 'unlisted drift must fail').not.toBe(0);
      expect(`${unlisted.stderr}${unlisted.stdout}`).toMatch(/checksum mismatch/);

      // (2) List the exact {filename, oldChecksum, newChecksum} triple → re-baseline.
      const newSeedSum = sha256(seed);
      writeFileSync(
        allowListPath,
        JSON.stringify([
          {
            filename: '900b_demo_seed.sql',
            oldChecksum: oldSeedSum,
            newChecksum: newSeedSum,
            prcId: 'PRC-L556',
          },
        ]),
        'utf8',
      );
      const rebaselined = runApply(baseEnv());
      expect(rebaselined.status, rebaselined.stderr + rebaselined.stdout).toBe(0);
      expect(rebaselined.stdout).toMatch(/Re-baseline seed .*900b_demo_seed\.sql/);
      expect(
        psql(
          LIVE_URL,
          `SELECT checksum FROM schema_migrations WHERE filename = '900b_demo_seed.sql'`,
        ).stdout,
      ).toBe(newSeedSum);
      // Not re-applied: row count unchanged (id=1 only).
      expect(psql(LIVE_URL, `SELECT count(*) FROM l556_probe WHERE id = 1`).stdout).toBe('1');

      // (3a) A listed entry whose oldChecksum no longer matches the ledger fails.
      writeFileSync(seed, `${seedV1}\n-- drift again`, 'utf8');
      writeFileSync(
        allowListPath,
        JSON.stringify([
          {
            filename: '900b_demo_seed.sql',
            oldChecksum: 'deadbeef'.repeat(8), // wrong old value
            newChecksum: sha256(seed),
            prcId: 'PRC-L556',
          },
        ]),
        'utf8',
      );
      const wrongOld = runApply(baseEnv());
      expect(wrongOld.status, 'wrong oldChecksum must fail').not.toBe(0);
      expect(`${wrongOld.stderr}${wrongOld.stdout}`).toMatch(/checksum mismatch/);

      // (3b) A listed NON-seed migration can never be re-baselined.
      // Start from a clean ledger so 900b applies cleanly and the mismatch is
      // reached on the numbered migration alone.
      resetLedger();
      const seedClean = `CREATE TABLE IF NOT EXISTS l556_probe (id int PRIMARY KEY);
INSERT INTO l556_probe (id) VALUES (1) ON CONFLICT DO NOTHING;`;
      const migV1 = `INSERT INTO l556_probe (id) VALUES (2) ON CONFLICT DO NOTHING;`;
      writeFileSync(seed, seedClean, 'utf8');
      writeFileSync(mig, migV1, 'utf8');
      writeFileSync(allowListPath, '[]', 'utf8');
      const clean = runApply(baseEnv());
      expect(clean.status, clean.stderr + clean.stdout).toBe(0);

      // Drift ONLY the numbered migration and list it for re-baseline → rejected
      // by is_seed_file; the apply still fails closed on that migration.
      const migDrift = `${migV1}\n-- drift`;
      writeFileSync(mig, migDrift, 'utf8');
      writeFileSync(
        allowListPath,
        JSON.stringify([
          {
            filename: '901_demo_migration.sql',
            oldChecksum: sha256(join(fixtureSql, '901_demo_migration.sql')), // = new file sum
            newChecksum: sha256(join(fixtureSql, '901_demo_migration.sql')),
            prcId: 'PRC-L556',
          },
        ]),
        'utf8',
      );
      const nonSeed = runApply(baseEnv());
      expect(nonSeed.status, 'listed non-seed migration must still fail').not.toBe(0);
      expect(`${nonSeed.stderr}${nonSeed.stdout}`).toMatch(
        /checksum mismatch for 901_demo_migration\.sql/,
      );
    } finally {
      resetLedger();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

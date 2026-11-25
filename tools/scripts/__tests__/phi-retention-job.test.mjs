/**
 * G-503 / W1-OPS-19 PHI retention helpers — runnable via:
 *   node --test tools/scripts/__tests__/phi-retention-job.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRetentionPlan,
  buildRetentionPredicate,
  buildEligibleFrom,
  classifyRetentionBucket,
  resolveRetentionDryRun,
  retentionCutoffIso,
} from '../phi-retention-job.mjs';
import * as job from '../phi-retention-job.mjs';

describe('G-503 PHI retention helpers', () => {
  it('computes cutoff ISO from retention days', () => {
    const now = new Date('2026-09-08T00:00:00.000Z');
    const cutoff = retentionCutoffIso(10, now);
    assert.equal(cutoff, '2026-08-29T00:00:00.000Z');
  });

  it('uses longer window for minor-linked PHI', () => {
    assert.equal(classifyRetentionBucket({ isMinor: true, phiDays: 2555, minorDays: 3650 }), 3650);
    assert.equal(classifyRetentionBucket({ isMinor: false, phiDays: 2555, minorDays: 3650 }), 2555);
  });

  it('builds a dry-run plan with candidate counts', () => {
    const plan = buildRetentionPlan({
      counsellingCount: 3,
      specialNeedsCount: 1,
      dryRun: true,
      phiDays: 2555,
      minorDays: 3650,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.gap, 'G-503');
    assert.equal(plan.dryRun, true);
    assert.equal(plan.candidates.counsellingSessions, 3);
    assert.equal(plan.applied.counsellingDeleted, 0);
  });
});

describe('W1-OPS-19 RETENTION_DRY_RUN fail-closed', () => {
  it('treats explicit "1" as sandbox dry-run', () => {
    assert.equal(resolveRetentionDryRun({ RETENTION_DRY_RUN: '1' }), true);
  });

  it('treats explicit "0" as enforce/apply', () => {
    assert.equal(resolveRetentionDryRun({ RETENTION_DRY_RUN: '0' }), false);
  });

  it('refuses unset mode (no silent dry-run default)', () => {
    assert.throws(() => resolveRetentionDryRun({}), /RETENTION_DRY_RUN must be explicitly set/);
    assert.throws(
      () => resolveRetentionDryRun({ RETENTION_DRY_RUN: '' }),
      /RETENTION_DRY_RUN must be explicitly set/,
    );
  });

  it('refuses non-binary values', () => {
    assert.throws(
      () => resolveRetentionDryRun({ RETENTION_DRY_RUN: 'true' }),
      /must be "0" or "1"/,
    );
  });
});

describe('PRC-H107 minor-aware retention predicate', () => {
  const adultCutoffIso = '2019-01-01T00:00:00.000Z'; // ~7y ago sample
  const minorCutoffIso = '2016-01-01T00:00:00.000Z'; // ~10y ago sample (older)

  it('gates minor rows by the longer minor cutoff, adults by the adult cutoff', () => {
    const sql = buildRetentionPredicate({
      table: 'counselling_sessions',
      adultCutoffIso,
      minorCutoffIso,
    });
    // Minor branch must compare against the minor cutoff, never the adult one.
    assert.match(sql, /date_of_birth \+ INTERVAL '18 years'/);
    const minorBranch = sql.slice(sql.indexOf('18 years'), sql.indexOf('WHEN (s.id IS NOT NULL'));
    assert.ok(minorBranch.includes(`r.created_at < '${minorCutoffIso}'::timestamptz`));
    assert.ok(!minorBranch.includes(`'${adultCutoffIso}'`));
    // Confirmed-adult branch uses the adult cutoff.
    assert.ok(sql.includes(`r.created_at < '${adultCutoffIso}'::timestamptz`));
  });

  it('fails SAFE: unresolved student falls back to the longer minor cutoff', () => {
    const sql = buildRetentionPredicate({
      table: 'health_special_needs_assessments',
      adultCutoffIso,
      minorCutoffIso,
    });
    // The ELSE (no student / no DOB) branch must use the minor cutoff, not adult.
    const elseBranch = sql.slice(sql.indexOf('ELSE'));
    assert.ok(elseBranch.includes(`'${minorCutoffIso}'::timestamptz`));
    assert.ok(!elseBranch.includes(`'${adultCutoffIso}'::timestamptz`));
  });

  it('buildEligibleFrom joins students on student_id and applies the predicate', () => {
    const frag = buildEligibleFrom({
      table: 'counselling_sessions',
      adultCutoffIso,
      minorCutoffIso,
    });
    assert.match(frag, /FROM "counselling_sessions" r/);
    assert.match(frag, /LEFT JOIN students s ON s\.id::text = r\.student_id/);
    assert.match(frag, /WHERE \(/);
    // Regression guard: must NOT be the old adult-only predicate.
    assert.ok(!/^FROM "counselling_sessions"\s+WHERE created_at <[^C]*$/.test(frag));
  });
});

const JOB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../phi-retention-job.mjs');

/**
 * Run the job with a PATH-stub `psql`. The stub records each invocation's argv
 * and stdin under `dir`, and either fails (exit 2) or prints `stubStdout`.
 */
function runJobWithStubPsql({ dryRun, fail = false, stubStdout = '' }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'phi-retention-'));
  const bin = path.join(dir, 'bin');
  const artifacts = path.join(dir, 'artifacts');
  writeFileSync(path.join(dir, 'stdout.txt'), stubStdout);
  spawnSync('mkdir', ['-p', bin]);
  writeFileSync(
    path.join(bin, 'psql'),
    `#!/usr/bin/env bash
n=$(ls "${dir}" | grep -c '^call-' || true)
printf '%s\\n' "$@" > "${dir}/call-$n.args"
cat > "${dir}/call-$n.stdin"
if [ "${fail ? '1' : '0'}" = "1" ]; then
  echo 'ERROR:  permission denied for table counselling_sessions' >&2
  exit 2
fi
cat "${dir}/stdout.txt"
`,
  );
  chmodSync(path.join(bin, 'psql'), 0o755);
  const result = spawnSync(process.execPath, [JOB], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: 'postgresql://stub.invalid/proctira',
      RETENTION_DRY_RUN: dryRun ? '1' : '0',
      ARTIFACT_DIR: artifacts,
    },
  });
  const calls = [];
  for (let n = 0; existsSync(path.join(dir, `call-${n}.args`)); n += 1) {
    calls.push({
      args: readFileSync(path.join(dir, `call-${n}.args`), 'utf8')
        .trim()
        .split('\n'),
      stdin: readFileSync(path.join(dir, `call-${n}.stdin`), 'utf8'),
    });
  }
  const summaryPath = path.join(artifacts, 'summary.json');
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
  return { status: result.status, stderr: result.stderr, calls, summary };
}

describe('PRC-M559 retention never reports success on a failed or partial run', () => {
  it('a psql failure while counting exits non-zero and writes no summary (dry-run)', () => {
    const run = runJobWithStubPsql({ dryRun: true, fail: true });
    assert.notEqual(run.status, 0, 'count failure must not be reported as success');
    assert.equal(run.summary, null);
  });

  it('a psql failure while applying exits non-zero and writes no summary', () => {
    const run = runJobWithStubPsql({ dryRun: false, fail: true });
    assert.notEqual(run.status, 0);
    assert.equal(run.summary, null);
  });

  it('counts and deletes for every tenant run in one psql session and one transaction', () => {
    const stubStdout = `${JSON.stringify({
      tenantsScanned: 2,
      rows: [
        { tenantId: 't1', table: 'counselling_sessions', eligible: 2, deleted: 2, audited: 2 },
        {
          tenantId: 't1',
          table: 'health_special_needs_assessments',
          eligible: 1,
          deleted: 1,
          audited: 1,
        },
        { tenantId: 't2', table: 'counselling_sessions', eligible: 3, deleted: 3, audited: 3 },
        {
          tenantId: 't2',
          table: 'health_special_needs_assessments',
          eligible: 0,
          deleted: 0,
          audited: 0,
        },
      ],
    })}\n`;
    const run = runJobWithStubPsql({ dryRun: false, stubStdout });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.calls.length, 1, 'exactly one psql session');
    assert.ok(run.calls[0].args.includes('--single-transaction'));
    assert.ok(run.calls[0].args.includes('ON_ERROR_STOP=1'));
    const script = run.calls[0].stdin;
    assert.match(script, /DELETE FROM "counselling_sessions"/);
    assert.match(script, /DELETE FROM "health_special_needs_assessments"/);
    assert.equal(run.summary.tenantsScanned, 2);
    assert.equal(run.summary.candidates.counsellingSessions, 5);
    assert.equal(run.summary.candidates.specialNeedsRecords, 1);
    assert.equal(run.summary.applied.counsellingDeleted, 5);
    assert.equal(run.summary.applied.specialNeedsDeleted, 1);
  });

  it('a psql session that prints no summary is a failure, not zero', () => {
    const run = runJobWithStubPsql({ dryRun: true, stubStdout: '' });
    assert.notEqual(run.status, 0);
    assert.equal(run.summary, null);
  });
});

describe('PRC-M559 retention script startup assertions', () => {
  const cutoffs = {
    adultCutoffIso: '2019-01-01T00:00:00.000Z',
    minorCutoffIso: '2016-01-01T00:00:00.000Z',
  };

  it('asserts the role privileges it needs; DELETE only when applying', () => {
    assert.equal(typeof job.buildRetentionScript, 'function');
    const apply = job.buildRetentionScript({ ...cutoffs, dryRun: false });
    const dry = job.buildRetentionScript({ ...cutoffs, dryRun: true });
    for (const table of ['counselling_sessions', 'health_special_needs_assessments']) {
      assert.ok(apply.includes(`has_table_privilege(current_user, '${table}', 'SELECT')`));
      assert.ok(apply.includes(`has_table_privilege(current_user, '${table}', 'DELETE')`));
      assert.ok(dry.includes(`has_table_privilege(current_user, '${table}', 'SELECT')`));
      assert.ok(!dry.includes(`has_table_privilege(current_user, '${table}', 'DELETE')`));
    }
    assert.ok(!/DELETE FROM/.test(dry), 'dry-run script must not delete');
  });

  it('fails when no tenant is visible and binds app.tenant_id per tenant', () => {
    const sql = job.buildRetentionScript({ ...cutoffs, dryRun: false });
    assert.match(sql, /IF cardinality\(v_tenants\) = 0 THEN\s+RAISE EXCEPTION/);
    assert.match(sql, /set_config\('app\.tenant_id', v_tenant, true\)/);
    assert.match(sql, /is not visible with app\.tenant_id bound/);
    assert.match(sql, /r\.tenant_id::text = v_tenant/);
  });

  it('raises when the deleted count differs from the eligible count', () => {
    const sql = job.buildRetentionScript({ ...cutoffs, dryRun: false });
    // PRC-M623: rows kept by a legal hold are subtracted from the expected count.
    assert.equal((sql.match(/IF v_deleted <> v_eligible - v_held THEN/g) ?? []).length, 2);
  });
});

describe('PRC-M435 every retention deletion is audited per tenant in the same transaction', () => {
  const cutoffs = {
    adultCutoffIso: '2019-01-01T00:00:00.000Z',
    minorCutoffIso: '2016-01-01T00:00:00.000Z',
  };

  it('each DELETE feeds a tenant-attributed audit_ingest_queue insert in the same statement', () => {
    const sql = job.buildRetentionScript({ ...cutoffs, dryRun: false });
    const statements = sql.split('WITH d AS (').slice(1);
    assert.equal(statements.length, 2, 'one delete+audit statement per PHI table');
    for (const statement of statements) {
      const body = statement.slice(0, statement.indexOf('INTO v_deleted, v_audited'));
      assert.match(body, /DELETE FROM "/);
      assert.match(body, /RETURNING t\.id, t\.student_id/);
      assert.match(body, /INSERT INTO audit_ingest_queue \(/);
      assert.match(body, /SELECT v_tenant::uuid, 'health_record', d\.id::text, 'DELETE'/);
      assert.ok(body.includes("'system:phi-retention'"));
    }
    assert.equal((sql.match(/IF v_audited <> v_deleted THEN/g) ?? []).length, 2);
    assert.ok(sql.includes("has_table_privilege(current_user, 'audit_ingest_queue', 'INSERT')"));
  });

  it('audit events carry ids and the policy, never PHI field values', () => {
    const sql = job.buildRetentionScript({ ...cutoffs, dryRun: false });
    assert.ok(
      sql.includes(
        "jsonb_build_object('counsellingSessionId', d.id::text, 'studentId', d.student_id)",
      ),
    );
    assert.ok(
      sql.includes(
        "jsonb_build_object('specialNeedsAssessmentId', d.id::text, 'studentId', d.student_id)",
      ),
    );
    for (const phiColumn of ['reason', 'case_notes', 'outcome', 'findings']) {
      assert.ok(!sql.includes(`d.${phiColumn}`), `audit must not copy ${phiColumn}`);
    }
  });

  it('a dry-run queues no audit events', () => {
    const sql = job.buildRetentionScript({ ...cutoffs, dryRun: true });
    assert.ok(!sql.includes('INSERT INTO audit_ingest_queue'));
  });

  it('the apply summary reports the queued audit events', () => {
    const stubStdout = `${JSON.stringify({
      tenantsScanned: 1,
      rows: [
        { tenantId: 't1', table: 'counselling_sessions', eligible: 2, deleted: 2, audited: 2 },
        {
          tenantId: 't1',
          table: 'health_special_needs_assessments',
          eligible: 1,
          deleted: 1,
          audited: 1,
        },
      ],
    })}\n`;
    const run = runJobWithStubPsql({ dryRun: false, stubStdout });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.summary.applied.auditEventsQueued, 3);
  });
});

describe('PRC-M623 retention runs as its own RLS-bound role and honours legal holds', () => {
  const cutoffs = {
    adultCutoffIso: '2019-01-01T00:00:00.000Z',
    minorCutoffIso: '2016-01-01T00:00:00.000Z',
  };

  it('refuses a SUPERUSER or BYPASSRLS role (the backup credential) before any check', () => {
    for (const dryRun of [true, false]) {
      const sql = job.buildRetentionScript({ ...cutoffs, dryRun });
      const guard = sql.indexOf('(rolsuper OR rolbypassrls)');
      assert.ok(guard > 0, 'role attribute assertion present');
      assert.ok(guard < sql.indexOf('has_table_privilege'), 'asserted first');
      assert.match(sql, /PRC-M623: role % is SUPERUSER or BYPASSRLS/);
    }
  });

  it('skips tenants on legal hold and rows of students under an active subject hold', () => {
    const sql = job.buildRetentionScript({ ...cutoffs, dryRun: false });
    assert.match(sql, /FILTER \(WHERE legal_hold\)/);
    assert.match(sql, /h\.active AND h\.scope = 'tenant'/);
    assert.ok(sql.includes("has_table_privilege(current_user, 'privacy_legal_holds', 'SELECT')"));
    const deletes = sql.split('WITH d AS (').slice(1);
    assert.equal(deletes.length, 2);
    for (const statement of deletes) {
      const where = statement.slice(0, statement.indexOf('RETURNING'));
      assert.match(where, /AND NOT EXISTS \(\s+SELECT 1 FROM privacy_legal_holds h/);
      assert.match(where, /h\.subject_type = 'student' AND h\.subject_id = r\.student_id/);
    }
    assert.equal((sql.match(/IF v_tenant_hold THEN\s+v_deleted := 0;/g) ?? []).length, 2);
  });

  it('reports rows held by legal hold in the summary', () => {
    const stubStdout = `${JSON.stringify({
      tenantsScanned: 1,
      rows: [
        {
          tenantId: 't1',
          table: 'counselling_sessions',
          eligible: 3,
          held: 2,
          deleted: 1,
          audited: 1,
        },
        {
          tenantId: 't1',
          table: 'health_special_needs_assessments',
          eligible: 0,
          held: 0,
          deleted: 0,
          audited: 0,
        },
      ],
    })}\n`;
    const run = runJobWithStubPsql({ dryRun: false, stubStdout });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.summary.heldByLegalHold, 2);
    assert.equal(run.summary.applied.counsellingDeleted, 1);
  });
});

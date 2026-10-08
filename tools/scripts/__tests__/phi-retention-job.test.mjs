/**
 * G-503 / W1-OPS-19 PHI retention helpers — runnable via:
 *   node --test tools/scripts/__tests__/phi-retention-job.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRetentionPlan,
  buildRetentionPredicate,
  buildEligibleFrom,
  classifyRetentionBucket,
  resolveRetentionDryRun,
  retentionCutoffIso,
} from '../phi-retention-job.mjs';

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

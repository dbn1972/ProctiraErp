/**
 * G-503 / W1-OPS-19 PHI retention helpers — runnable via:
 *   node --test tools/scripts/__tests__/phi-retention-job.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCandidateCountSql,
  buildDeleteSql,
  buildRetentionPlan,
  classifyRetentionBucket,
  legalHoldExclusionSql,
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
    assert.equal(
      classifyRetentionBucket({ isMinor: true, phiDays: 2555, minorDays: 3650 }),
      3650,
    );
    assert.equal(
      classifyRetentionBucket({ isMinor: false, phiDays: 2555, minorDays: 3650 }),
      2555,
    );
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
    assert.equal(plan.policy.legalHoldExclusion, true);
    assert.equal(plan.candidates.counsellingSessions, 3);
    assert.equal(plan.applied.counsellingDeleted, 0);
  });

  it('embeds legal-hold exclusion in count and delete SQL', () => {
    const hold = legalHoldExclusionSql('r');
    assert.match(hold, /privacy_legal_holds/);
    assert.match(hold, /legal_hold/);
    const countSql = buildCandidateCountSql(
      'counselling_sessions',
      '2020-01-01T00:00:00.000Z',
    );
    const deleteSql = buildDeleteSql(
      'counselling_sessions',
      '2020-01-01T00:00:00.000Z',
    );
    assert.match(countSql, /privacy_legal_holds/);
    assert.match(deleteSql, /DELETE FROM counselling_sessions/);
    assert.match(deleteSql, /privacy_legal_holds/);
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
    assert.throws(
      () => resolveRetentionDryRun({}),
      /RETENTION_DRY_RUN must be explicitly set/,
    );
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

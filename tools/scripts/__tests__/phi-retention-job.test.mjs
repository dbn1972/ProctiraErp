/**
 * G-503 PHI retention helpers — runnable via:
 *   node --test tools/scripts/__tests__/phi-retention-job.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRetentionPlan,
  classifyRetentionBucket,
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
    assert.equal(plan.candidates.counsellingSessions, 3);
    assert.equal(plan.applied.counsellingDeleted, 0);
  });
});

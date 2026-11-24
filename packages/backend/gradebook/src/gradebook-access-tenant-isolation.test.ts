/**
 * D2 CORRECTION (PRC-M015) — gradebook (grades / transcripts / board-export PII)
 * tenant-isolation proof.
 *
 * platform_admin (cross-tenant control-plane operator) was wrongly added to the gradebook
 * ADMIN_ROLES tier, granting it staff grade reads, transcript issue and board-export creation
 * for a tenant's students. The correction removes it; system_admin (per-tenant admin) stays.
 *
 * Failing-first: these assertions FAIL against the pre-correction over-grant and PASS after
 * platform_admin is removed.
 */
import { describe, expect, it } from 'vitest';

import {
  hasGradebookAccess,
  hasInstitutionWideGradeWriteRole,
  type GradebookAction,
} from './gradebook-access.js';

const ACTIONS: GradebookAction[] = [
  'grade.entry',
  'grade.moderate',
  'gpa.compute',
  'report_card.create',
  'transcript.issue',
  'credit_rule.write',
  'board_export.create',
  'grade.read.staff',
];

describe('gradebook-access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED every gradebook action; system_admin keeps them', () => {
    for (const action of ACTIONS) {
      expect(hasGradebookAccess(['platform_admin'], action), action).toBe(false);
      expect(hasGradebookAccess(['system_admin'], action), action).toBe(true);
    }
  });

  it('platform_admin is NOT an institution-wide grade writer; system_admin is', () => {
    expect(hasInstitutionWideGradeWriteRole([{ roleId: 'platform_admin' }])).toBe(false);
    expect(hasInstitutionWideGradeWriteRole([{ roleId: 'system_admin' }])).toBe(true);
  });
});

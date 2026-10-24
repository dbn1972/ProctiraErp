/**
 * D2 role-catalogue normalization (PRC-M015, PRC-M237) — privilege-preservation proof.
 *
 * Normalization applied to this module:
 *  - exam_officer -> examinations_officer in EXAM_STAFF_ROLES (examinations_officer already
 *    present, so the collapse only removes the dead synonym spelling).
 *
 * D2 CORRECTION: platform_admin (cross-tenant platform operator) is NOT a report manager on
 * this tenant-scoped surface; the per-tenant system_admin is unchanged.
 *
 * Proves the exam-report entitlement still admits the canonical examinations_officer and
 * board_officer, and that platform_admin does NOT manage tenant reports while system_admin does.
 */
import { describe, expect, it } from 'vitest';

import { canAccessReport, isReportManager, isReportStaff } from './report-access.js';

describe('report-access privilege preservation (D2)', () => {
  it('examinations_officer and board_officer can still generate exam_results', () => {
    expect(canAccessReport(['examinations_officer'], 'exam_results')).toBe(true);
    expect(canAccessReport(['board_officer'], 'exam_results')).toBe(true);
    expect(isReportStaff(['examinations_officer'])).toBe(true);
  });

  it('does NOT admit platform_admin as a report manager (tenant isolation); system_admin unchanged', () => {
    expect(isReportManager(['platform_admin'])).toBe(false);
    expect(canAccessReport(['platform_admin'], 'fee_dues')).toBe(false);
    expect(canAccessReport(['platform_admin'], 'exam_results')).toBe(false);
    // system_admin (per-tenant admin) unchanged
    expect(isReportManager(['system_admin'])).toBe(true);
    expect(canAccessReport(['system_admin'], 'fee_dues')).toBe(true);
  });

  it('every previously-admitted admin role still manages reports', () => {
    for (const role of [
      'admin',
      'super-admin',
      'super_admin',
      'system_admin',
      'system-admin',
      'principal',
      'school_admin',
      'school-admin',
    ]) {
      expect(isReportManager([role]), role).toBe(true);
    }
  });

  it('portal roles remain denied (fail-closed unchanged)', () => {
    expect(canAccessReport(['parent'], 'students_roster')).toBe(false);
    expect(canAccessReport(['guardian'], 'fee_dues')).toBe(false);
    expect(canAccessReport(['student'], 'exam_results')).toBe(false);
  });
});

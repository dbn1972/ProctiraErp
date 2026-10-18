/**
 * D2 role-catalogue normalization (PRC-M015, PRC-M237) — privilege-preservation proof.
 *
 * Normalization applied to this module:
 *  - exam_officer / exam-officer -> examinations_officer in ASSESSMENT_STAFF_ROLES and
 *    REPORT_CARD_OPERATOR_ROLES.
 *
 * D2 CORRECTION: platform_admin (cross-tenant platform operator) is NOT admitted to this
 * tenant-scoped academic (assessment) surface; the per-tenant system_admin is unchanged.
 *
 * Proves the canonical name grants exactly what the former synonyms did, and that
 * platform_admin does NOT hold tenant-scoped assessment access while system_admin still does.
 */
import { describe, expect, it } from 'vitest';

import {
  hasAssessmentAccess,
  isAssessmentAdmin,
  isReportCardOperator,
} from './assessment-access.js';

describe('assessment-access privilege preservation (D2)', () => {
  it('examinations_officer holds the assessment read/write the former exam_officer did', () => {
    expect(hasAssessmentAccess(['examinations_officer'], 'assessment.read')).toBe(true);
    expect(hasAssessmentAccess(['examinations_officer'], 'assessment.write')).toBe(true);
  });

  it('examinations_officer is a report-card operator (replacing exam_officer/exam-officer)', () => {
    expect(isReportCardOperator(['examinations_officer'])).toBe(true);
  });

  it('every previously-admitted staff role still has assessment access', () => {
    for (const role of [
      'teacher',
      'instructor',
      'faculty',
      'academic_coordinator',
      'academic-coordinator',
      'examinations_officer',
      'registrar',
      'admin',
      'super-admin',
      'super_admin',
      'system_admin',
      'system-admin',
      'administrator',
      'principal',
      'school_admin',
      'school-admin',
    ]) {
      expect(hasAssessmentAccess([role], 'assessment.write'), role).toBe(true);
    }
  });

  it('does NOT admit platform_admin (tenant isolation); system_admin unchanged', () => {
    expect(hasAssessmentAccess(['platform_admin'], 'assessment.write')).toBe(false);
    expect(hasAssessmentAccess(['platform_admin'], 'assessment.read')).toBe(false);
    expect(isAssessmentAdmin(['platform_admin'])).toBe(false);
    expect(isReportCardOperator(['platform_admin'])).toBe(false);
    // system_admin (per-tenant admin) unchanged
    expect(isAssessmentAdmin(['system_admin'])).toBe(true);
    expect(isReportCardOperator(['system_admin'])).toBe(true);
    expect(hasAssessmentAccess(['system_admin'], 'assessment.write')).toBe(true);
  });

  it('a plain teacher is still NOT a report-card operator (no widening)', () => {
    expect(isReportCardOperator(['teacher'])).toBe(false);
  });

  it('parents/viewers remain denied (fail-closed unchanged)', () => {
    expect(hasAssessmentAccess(['parent'], 'assessment.write')).toBe(false);
    expect(hasAssessmentAccess(['viewer'], 'assessment.read')).toBe(false);
  });
});

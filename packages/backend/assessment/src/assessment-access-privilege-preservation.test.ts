/**
 * D2 role-catalogue normalization (PRC-M015, PRC-M237) — privilege-preservation proof.
 *
 * Normalization applied to this module:
 *  - exam_officer / exam-officer -> examinations_officer in ASSESSMENT_STAFF_ROLES and
 *    REPORT_CARD_OPERATOR_ROLES.
 *  - system_admin -> platform_admin add in ADMIN_ROLES.
 *
 * Proves the canonical name grants exactly what the former synonyms did and that platform_admin
 * is now admitted alongside (never instead of) system_admin.
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

  it('adds platform_admin alongside system_admin (admin + operator, additive)', () => {
    expect(hasAssessmentAccess(['platform_admin'], 'assessment.write')).toBe(true);
    expect(isAssessmentAdmin(['platform_admin'])).toBe(true);
    expect(isReportCardOperator(['platform_admin'])).toBe(true);
    // system_admin unchanged
    expect(isAssessmentAdmin(['system_admin'])).toBe(true);
    expect(isReportCardOperator(['system_admin'])).toBe(true);
  });

  it('a plain teacher is still NOT a report-card operator (no widening)', () => {
    expect(isReportCardOperator(['teacher'])).toBe(false);
  });

  it('parents/viewers remain denied (fail-closed unchanged)', () => {
    expect(hasAssessmentAccess(['parent'], 'assessment.write')).toBe(false);
    expect(hasAssessmentAccess(['viewer'], 'assessment.read')).toBe(false);
  });
});

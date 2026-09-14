/**
 * W1-SEC-02 — assessment domain RBAC unit tests.
 */
import { describe, expect, it } from 'vitest';

import {
  assertAssessmentAccess,
  hasAssessmentAccess,
  normalizeAssessmentRoles,
} from './assessment-access.js';

describe('assessment-access (W1-SEC-02)', () => {
  it('normalizes string and object roles', () => {
    expect(normalizeAssessmentRoles(['Teacher', { roleName: 'Exam_Officer' }])).toEqual([
      'teacher',
      'exam_officer',
    ]);
  });

  it('allows teachers to write', () => {
    expect(hasAssessmentAccess(['teacher'], 'assessment.write')).toBe(true);
    expect(hasAssessmentAccess(['admin'], 'assessment.read')).toBe(true);
  });

  it('denies parents/empty roles (fail closed)', () => {
    expect(hasAssessmentAccess(['parent'], 'assessment.write')).toBe(false);
    expect(hasAssessmentAccess([], 'assessment.write')).toBe(false);
    expect(() => assertAssessmentAccess(['viewer'], 'assessment.write')).toThrow(/Forbidden/);
  });
});

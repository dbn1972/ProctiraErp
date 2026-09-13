import { describe, expect, it } from 'vitest';

import {
  assertStudentReadAccess,
  assertStudentWriteAccess,
  hasStudentReadAccess,
  hasStudentWriteAccess,
} from './student-access.js';

describe('student-access (PRD-005)', () => {
  it('allows registrar to update student PII', () => {
    expect(hasStudentWriteAccess(['registrar'], 'student.update')).toBe(true);
    expect(hasStudentWriteAccess([{ roleName: 'ADMISSIONS_OFFICER' }], 'student.update')).toBe(
      true,
    );
  });

  it('denies teacher / viewer PII updates', () => {
    expect(hasStudentWriteAccess(['teacher'], 'student.update')).toBe(false);
    expect(hasStudentWriteAccess(['viewer'], 'student.update')).toBe(false);
    expect(() => assertStudentWriteAccess(['teacher'], 'student.update')).toThrow(/Forbidden/);
  });

  it('allows teacher read but denies write/delete', () => {
    expect(hasStudentReadAccess(['teacher'])).toBe(true);
    expect(() => assertStudentReadAccess(['teacher'])).not.toThrow();
    expect(hasStudentWriteAccess(['teacher'], 'student.delete')).toBe(false);
  });

  it('denies unknown roles read access', () => {
    expect(hasStudentReadAccess(['billing_clerk'])).toBe(false);
    expect(hasStudentReadAccess([])).toBe(false);
  });
});

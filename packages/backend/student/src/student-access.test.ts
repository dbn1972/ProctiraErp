import { describe, expect, it } from 'vitest';

import { assertStudentWriteAccess, hasStudentWriteAccess } from './student-access.js';

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
});

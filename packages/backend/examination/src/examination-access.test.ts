import { describe, expect, it } from 'vitest';

import { assertExaminationAccess, hasExaminationAccess } from './examination-access.js';

describe('examination-access', () => {
  it('allows exam officers and admins to create/publish', () => {
    expect(hasExaminationAccess(['examinations_officer'], 'exam.create')).toBe(true);
    expect(hasExaminationAccess([{ roleName: 'REGISTRAR' }], 'exam.publish')).toBe(true);
    expect(hasExaminationAccess(['admin'], 'candidate.register')).toBe(true);
  });

  it('denies teacher / viewer mutations', () => {
    expect(hasExaminationAccess(['teacher'], 'exam.create')).toBe(false);
    expect(hasExaminationAccess(['viewer'], 'exam.publish')).toBe(false);
    expect(hasExaminationAccess([], 'exam.delete')).toBe(false);
    expect(() => assertExaminationAccess(['teacher'], 'exam.create')).toThrow(/Forbidden/);
  });

  // PRC-C004: examination read surfaces (results, marks, seating, PDFs, candidates) are
  // staff-only. Students/guardians hold gateway examination:read but must be denied here.
  it('allows staff (officer/teacher/admin) to read, denies student/guardian/parent', () => {
    expect(hasExaminationAccess(['examinations_officer'], 'exam.read.staff')).toBe(true);
    expect(hasExaminationAccess(['teacher'], 'exam.read.staff')).toBe(true);
    expect(hasExaminationAccess([{ roleName: 'PRINCIPAL' }], 'exam.read.staff')).toBe(true);
    expect(hasExaminationAccess(['student'], 'exam.read.staff')).toBe(false);
    expect(hasExaminationAccess(['guardian'], 'exam.read.staff')).toBe(false);
    expect(hasExaminationAccess(['parent'], 'exam.read.staff')).toBe(false);
    expect(() => assertExaminationAccess(['student'], 'exam.read.staff')).toThrow(/Forbidden/);
  });
});

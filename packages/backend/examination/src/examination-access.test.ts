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
});

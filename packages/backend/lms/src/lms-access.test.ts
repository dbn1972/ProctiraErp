import { describe, expect, it } from 'vitest';

import {
  assertLmsAccess,
  hasLmsAccess,
  isLmsLearnPath,
  lmsActionForRequest,
  normalizeLmsRoles,
} from './lms-access.js';

describe('lms-access (W1-SEC-02)', () => {
  it('normalizes roles', () => {
    expect(normalizeLmsRoles(['Teacher', { roleName: 'Instructor' }])).toEqual([
      'teacher',
      'instructor',
    ]);
  });

  it('allows staff writes; learners need user for learn/read', () => {
    expect(hasLmsAccess(['teacher'], 'lms.staff')).toBe(true);
    expect(hasLmsAccess(['parent'], 'lms.staff')).toBe(false);
    expect(hasLmsAccess(['student'], 'lms.learn', { hasUser: true })).toBe(true);
    expect(hasLmsAccess([], 'lms.learn', { hasUser: false })).toBe(false);
    expect(() => assertLmsAccess(['viewer'], 'lms.staff')).toThrow(/Forbidden/);
  });

  it('classifies learn paths and methods', () => {
    expect(isLmsLearnPath('/lms/assignments/x/submissions')).toBe(true);
    expect(isLmsLearnPath('/lms/skills')).toBe(false);
    expect(lmsActionForRequest('GET', '/lms/assignments')).toBe('lms.learn');
    expect(lmsActionForRequest('POST', '/lms/skills')).toBe('lms.staff');
    expect(lmsActionForRequest('POST', '/lms/assignments/1/submissions')).toBe('lms.learn');
  });
});

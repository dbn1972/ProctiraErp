/**
 * W1-SEC-02 — curriculum domain RBAC unit tests.
 */
import { describe, expect, it } from 'vitest';

import {
  assertCurriculumAccess,
  hasCurriculumAccess,
  normalizeCurriculumRoles,
} from './curriculum-access.js';

describe('curriculum-access (W1-SEC-02)', () => {
  it('normalizes roles', () => {
    expect(normalizeCurriculumRoles(['Teacher', { roleName: 'Curriculum_Coordinator' }])).toEqual([
      'teacher',
      'curriculum_coordinator',
    ]);
  });

  it('allows teachers to write', () => {
    expect(hasCurriculumAccess(['teacher'], 'curriculum.write')).toBe(true);
  });

  it('denies parents/empty roles (fail closed)', () => {
    expect(hasCurriculumAccess(['parent'], 'curriculum.write')).toBe(false);
    expect(hasCurriculumAccess([], 'curriculum.write')).toBe(false);
    expect(() => assertCurriculumAccess(['viewer'], 'curriculum.write')).toThrow(/Forbidden/);
  });
});

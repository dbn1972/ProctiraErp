/** PRC-M121 — the Health (PHI) tab is listed only for health-record roles. */
import { describe, expect, it } from 'vitest';
import { studentProfileTabs } from './student-profile-tabs';
const roles = (...names: string[]) => names.map((roleName) => ({ roleName }));
describe('studentProfileTabs (PRC-M121)', () => {
  it('omits the health tab for general student-read roles', () => {
    for (const name of ['teacher', 'registrar', 'staff', 'principal', 'school_admin']) {
      expect(studentProfileTabs(roles(name)), name).not.toContain('health');
    }
    expect(studentProfileTabs([])).not.toContain('health');
  });
  it('lists the health tab for health-record roles', () => {
    for (const name of ['nurse', 'school_nurse', 'health_officer', 'health_admin', 'counsellor']) {
      expect(studentProfileTabs(roles(name)), name).toContain('health');
    }
    expect(studentProfileTabs(roles('teacher', 'NURSE'))).toContain('health');
  });
  it('keeps every other tab in order', () => {
    expect(studentProfileTabs(roles('teacher'))).toEqual([
      'overview',
      'attendance',
      'assessments',
      'guardians',
      'fees',
      'lms',
      'history',
    ]);
  });
});

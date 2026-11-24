import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES } from './rbac.js';
import { canonicalRoleId } from './role-catalogue.js';

const CATALOGUE = new Set(DEFAULT_ROLES.map((role) => role.roleId));

describe('canonicalRoleId (PRC-M015)', () => {
  it('keeps an exact catalogue id, ignoring case and surrounding space', () => {
    expect(canonicalRoleId(' School_Nurse ', CATALOGUE)).toBe('school_nurse');
    expect(canonicalRoleId('super-admin', CATALOGUE)).toBe('super-admin');
  });

  it('maps the other -/_ spelling onto the catalogue id', () => {
    expect(canonicalRoleId('SUPER_ADMIN', CATALOGUE)).toBe('super-admin');
    expect(canonicalRoleId('hostel-warden', CATALOGUE)).toBe('hostel_warden');
    expect(canonicalRoleId('transport-officer', CATALOGUE)).toBe('transport_officer');
  });

  it('collapses only the D2-confirmed exam-officer synonyms', () => {
    expect(canonicalRoleId('exam-officer', CATALOGUE)).toBe('examinations_officer');
    expect(canonicalRoleId('EXAM_OFFICER', CATALOGUE)).toBe('examinations_officer');
    // D2 CORRECTION: distinct roles stay distinct.
    expect(canonicalRoleId('system_admin', CATALOGUE)).toBeUndefined();
    expect(canonicalRoleId('nurse', CATALOGUE)).toBe('nurse');
    expect(canonicalRoleId('parent', CATALOGUE)).toBe('parent');
  });

  it('never invents a role the catalogue lacks', () => {
    for (const raw of ['', '   ', 'offline_access', 'default-roles-proctira', 'admin-lookalike']) {
      expect(canonicalRoleId(raw, CATALOGUE)).toBeUndefined();
    }
  });

  it('every DEFAULT_ROLES id is already canonical', () => {
    for (const id of CATALOGUE) expect(canonicalRoleId(id, CATALOGUE)).toBe(id);
  });
});

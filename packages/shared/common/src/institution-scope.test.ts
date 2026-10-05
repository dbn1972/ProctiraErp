import { describe, expect, it } from 'vitest';
import { NotFoundError } from './exceptions/index.js';
import {
  assertInstitutionInScope,
  isSchoolBoundPrincipal,
  principalInstitutions,
} from './institution-scope.js';

describe('PRC-H004 assertInstitutionInScope', () => {
  const teacher = { institutions: ['school-a'], roles: [{ roleId: 'teacher' }] };
  const boardAdmin = { institutions: ['school-a'], roles: ['board_admin'] };

  it('school-bound principals: own school passes, other / missing school is a 404', () => {
    expect(() => assertInstitutionInScope(teacher, 'school-a')).not.toThrow();
    expect(() => assertInstitutionInScope(teacher, 'school-b')).toThrow(NotFoundError);
    expect(() => assertInstitutionInScope(teacher, null)).toThrow(NotFoundError);
    expect(() => assertInstitutionInScope(teacher, undefined)).toThrow(NotFoundError);
  });

  it('board/tenant admins (positive allowlist) and principals without schools are unaffected', () => {
    expect(() => assertInstitutionInScope(boardAdmin, 'school-b')).not.toThrow();
    expect(() => assertInstitutionInScope({ roles: ['teacher'] }, 'school-b')).not.toThrow();
    expect(() => assertInstitutionInScope(undefined, 'school-b')).not.toThrow();
  });

  it('an unknown role is not an admin; malformed claims never widen scope', () => {
    expect(isSchoolBoundPrincipal({ institutions: ['s'], roles: ['admin-ish'] })).toBe(true);
    expect(principalInstitutions({ institutions: ['s', 's', '', 7] })).toEqual(['s']);
    const malformed = { institutions: 'school-a', roles: [] };
    expect(isSchoolBoundPrincipal(malformed)).toBe(true);
    expect(() => assertInstitutionInScope(malformed, 'school-a')).toThrow(NotFoundError);
  });
});

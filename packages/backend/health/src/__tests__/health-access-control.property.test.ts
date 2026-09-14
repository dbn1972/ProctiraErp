/**
 * Property-Based Test: Health Record Access Control
 *
 * Invariant: Health record access is denied for any user without an
 * authorized health role OR a guardian relationship to the student.
 * School-bound health roles additionally require institution scope
 * (W1-SEC-04 COMPLETE — deny on missing scope).
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { hasHealthAccess } from '../health-service.js';
import type { HealthAccessContext } from '../health-service.js';

/** Roles that are NOT authorized for health access */
const UNAUTHORIZED_ROLES = [
  'teacher',
  'student',
  'parent',
  'principal',
  'clerk',
  'accountant',
  'librarian',
  'it_admin',
  'data_entry',
  'viewer',
];

const TENANT_WIDE_ROLES = ['health_admin', 'system_admin'] as const;
const SCHOOL_BOUND_ROLES = ['health_officer', 'school_nurse', 'counsellor'] as const;

describe('Health Service - Access Control (Property)', () => {
  it('should deny access for any user without health role and without guardian relationship', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.array(fc.constantFrom(...UNAUTHORIZED_ROLES), { minLength: 0, maxLength: 3 }),
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),
        (userId, studentId, roles, otherGuardianStudentIds) => {
          const guardianOfStudentIds = otherGuardianStudentIds.filter((id) => id !== studentId);

          const context: HealthAccessContext = {
            userId,
            roles,
            guardianOfStudentIds,
          };

          expect(hasHealthAccess(context, studentId)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should grant access for tenant-wide health admin roles without institution scope', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.constantFrom(...TENANT_WIDE_ROLES),
        fc.array(fc.constantFrom(...UNAUTHORIZED_ROLES), { minLength: 0, maxLength: 2 }),
        fc.array(fc.uuid(), { minLength: 0, maxLength: 3 }),
        (userId, studentId, authorizedRole, otherRoles, guardianOfStudentIds) => {
          const context: HealthAccessContext = {
            userId,
            roles: [authorizedRole, ...otherRoles],
            guardianOfStudentIds,
          };
          expect(hasHealthAccess(context, studentId)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should grant school-bound health roles only with matching institution scope', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        fc.constantFrom(...SCHOOL_BOUND_ROLES),
        (userId, studentId, institutionId, authorizedRole) => {
          const withScope: HealthAccessContext = {
            userId,
            roles: [authorizedRole],
            guardianOfStudentIds: [],
            institutionIds: [institutionId],
          };
          const missingScope: HealthAccessContext = {
            userId,
            roles: [authorizedRole],
            guardianOfStudentIds: [],
          };
          expect(
            hasHealthAccess(withScope, studentId, { studentInstitutionId: institutionId }),
          ).toBe(true);
          expect(
            hasHealthAccess(missingScope, studentId, { studentInstitutionId: institutionId }),
          ).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should grant access for a guardian of the specific student even without health role', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.array(fc.constantFrom(...UNAUTHORIZED_ROLES), { minLength: 0, maxLength: 3 }),
        fc.array(fc.uuid(), { minLength: 0, maxLength: 3 }),
        (userId, studentId, roles, additionalStudentIds) => {
          const guardianOfStudentIds = [studentId, ...additionalStudentIds];

          const context: HealthAccessContext = {
            userId,
            roles,
            guardianOfStudentIds,
          };

          expect(hasHealthAccess(context, studentId)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

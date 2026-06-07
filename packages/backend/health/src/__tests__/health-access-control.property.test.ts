/**
 * Property-Based Test: Health Record Access Control
 *
 * Invariant: Health record access is denied for any user without an
 * authorized health role OR a guardian relationship to the student.
 * Users with neither should always receive an access denied error.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';

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

/** Roles that ARE authorized for health access */
const AUTHORIZED_ROLES = [
  'health_officer',
  'school_nurse',
  'health_admin',
  'system_admin',
  'counsellor',
];

describe('Health Service - Access Control (Property)', () => {
  it('should deny access for any user without health role and without guardian relationship', () => {
    fc.assert(
      fc.property(
        // Generate a user ID
        fc.uuid(),
        // Generate a student ID
        fc.uuid(),
        // Generate 0-3 unauthorized roles
        fc.array(fc.constantFrom(...UNAUTHORIZED_ROLES), { minLength: 0, maxLength: 3 }),
        // Generate guardian-of student IDs that do NOT include the target student
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),
        (userId, studentId, roles, otherGuardianStudentIds) => {
          // Ensure the guardian list does NOT contain the target student
          const guardianOfStudentIds = otherGuardianStudentIds.filter(
            id => id !== studentId,
          );

          const context: HealthAccessContext = {
            userId,
            roles,
            guardianOfStudentIds,
          };

          // Access should be denied
          expect(hasHealthAccess(context, studentId)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should grant access for any user with at least one authorized health role', () => {
    fc.assert(
      fc.property(
        // Generate a user ID
        fc.uuid(),
        // Generate a student ID
        fc.uuid(),
        // Generate at least one authorized role mixed with optional unauthorized ones
        fc.tuple(
          fc.constantFrom(...AUTHORIZED_ROLES),
          fc.array(fc.constantFrom(...UNAUTHORIZED_ROLES), { minLength: 0, maxLength: 2 }),
        ),
        // Guardian list (irrelevant when role grants access)
        fc.array(fc.uuid(), { minLength: 0, maxLength: 3 }),
        (userId, studentId, [authorizedRole, otherRoles], guardianOfStudentIds) => {
          const context: HealthAccessContext = {
            userId,
            roles: [authorizedRole, ...otherRoles],
            guardianOfStudentIds,
          };

          // Access should be granted due to authorized role
          expect(hasHealthAccess(context, studentId)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should grant access for a guardian of the specific student even without health role', () => {
    fc.assert(
      fc.property(
        // Generate a user ID
        fc.uuid(),
        // Generate a student ID
        fc.uuid(),
        // Generate only unauthorized roles
        fc.array(fc.constantFrom(...UNAUTHORIZED_ROLES), { minLength: 0, maxLength: 3 }),
        // Generate additional guardian student IDs
        fc.array(fc.uuid(), { minLength: 0, maxLength: 3 }),
        (userId, studentId, roles, additionalStudentIds) => {
          // Include the target student in guardian list
          const guardianOfStudentIds = [studentId, ...additionalStudentIds];

          const context: HealthAccessContext = {
            userId,
            roles,
            guardianOfStudentIds,
          };

          // Access should be granted due to guardian relationship
          expect(hasHealthAccess(context, studentId)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
